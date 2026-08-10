/**
 * family-map-gcal — Google Calendar → family-map, near real time.
 *
 * WHY THIS EXISTS
 * The existing iCal path (family-map-cal) polls a .ics URL. That can never be
 * fast, because Google itself only regenerates the "secret iCal address" every
 * few hours — polling harder just re-downloads the same stale file. The only
 * way to get changes promptly is Google's own push channel, which is what this
 * worker wires up.
 *
 * FLOW
 *   1. /oauth/start?familyId=…&name=…   → redirect to Google consent
 *   2. /oauth/callback?code=…&state=…   → swap code for a refresh token,
 *                                          create a calendarSources doc,
 *                                          open a watch channel, first sync
 *   3. /notify                           → Google pings on every change; we do
 *                                          an incremental events.list and
 *                                          upsert into Firestore
 *   4. cron (every 15 min)               → renew channels nearing expiry and
 *                                          run a safety-net sync
 *
 * SECRET STORAGE
 * Refresh tokens live in families/{familyId}/gcalConnections/{connId}.
 * That collection is deliberately ABSENT from firestore.rules: the rules here
 * enumerate every collection with no catch-all, so an unlisted collection is
 * denied to every client — while this worker, holding a service account,
 * bypasses rules entirely. So the token is unreadable from the app even by
 * family members, with no extra infrastructure (no KV namespace to provision).
 *
 * THE 7-DAY TRAP
 * If the OAuth consent screen is left in "Testing", Google expires refresh
 * tokens after 7 days and this silently stops working — exactly what happened
 * to DailyDigest/WorkLogger on 2026-06-12. The consent screen MUST be
 * published to Production. See SETUP.md.
 *
 * Secrets (wrangler secret put …):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   FIREBASE_SERVICE_ACCOUNT_JSON
 */

const FIREBASE_PROJECT = 'family-map-c5110';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

const GOOGLE_AUTH  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GCAL_BASE    = 'https://www.googleapis.com/calendar/v3';
const SCOPES       = 'https://www.googleapis.com/auth/calendar.readonly openid email';

// Google caps calendar watch channels at ~1 week. Renew well before the edge
// so a failed renewal has several more cron ticks to retry.
const CHANNEL_RENEW_BEFORE_MS = 36 * 60 * 60 * 1000;
// Safety net: even with push working, re-sync anything untouched this long.
const SAFETY_SYNC_AFTER_MS    = 6 * 60 * 60 * 1000;

const ALLOWED_ORIGINS = [
  'https://examrx79bd03-star.github.io',
  'http://localhost:8912',
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      switch (url.pathname) {
        case '/oauth/start':    return oauthStart(request, env, url);
        case '/oauth/callback': return oauthCallback(request, env, url);
        case '/notify':         return notify(request, env, ctx);
        case '/status':         return status(request, env, url);
        case '/disconnect':     return disconnect(request, env, url);
        case '/sync-now':       return syncNow(request, env, url);
        default:
          return json({ error: 'not found', paths: ['/oauth/start', '/status', '/sync-now', '/disconnect'] }, 404);
      }
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(cronTick(env));
  },
};

/* ─── CORS ──────────────────────────────────────────────────────────────── */

function corsHeaders(request) {
  const origin = request ? request.headers.get('Origin') : null;
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(obj, statusCode = 200, request = null) {
  return new Response(JSON.stringify(obj), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request) },
  });
}

function htmlPage(title, body) {
  // The OAuth callback lands in a real browser tab, so it needs to say
  // something human — not JSON.
  return new Response(
    `<!doctype html><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${escapeHtml(title)}</title>
     <style>
       body{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;
            background:#f4f1eb;color:#2c2925;margin:0;
            display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
       .card{background:#fff;border-radius:16px;padding:28px 24px;max-width:420px;
             box-shadow:0 6px 24px rgba(0,0,0,.08);text-align:center}
       h1{font-size:19px;margin:0 0 12px}
       p{font-size:14px;line-height:1.7;color:#5c564e;margin:0 0 8px}
       .ok{color:#28a269;font-size:40px;margin-bottom:8px}
       .ng{color:#e0413f;font-size:40px;margin-bottom:8px}
       code{font-size:12px;background:#f4f1eb;padding:2px 5px;border-radius:4px}
     </style>
     <div class="card">${body}</div>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/* ─── OAuth ─────────────────────────────────────────────────────────────── */

function redirectUri(url) {
  return `${url.origin}/oauth/callback`;
}

async function oauthStart(request, env, url) {
  const familyId = (url.searchParams.get('familyId') || '').trim();
  if (!/^[A-Z0-9]{6,16}$/.test(familyId)) {
    return htmlPage('連携できません',
      `<div class="ng">✕</div><h1>家族コードが不正です</h1>
       <p>アプリの設定画面からやり直してください。</p>`);
  }
  if (!env.GOOGLE_CLIENT_ID) {
    return htmlPage('設定が未完了です',
      `<div class="ng">✕</div><h1>Worker の設定が未完了です</h1>
       <p><code>GOOGLE_CLIENT_ID</code> が設定されていません。SETUP.md を参照してください。</p>`);
  }

  // state carries the family to attach the connection to. It is not signed:
  // the family code IS the app's shared secret already (anyone holding it can
  // read and write the whole family), so passing it here adds no new exposure.
  // Worst case someone who knows the code attaches their OWN calendar to it,
  // which shows up as a removable source.
  const state = b64url(new TextEncoder().encode(JSON.stringify({
    familyId,
    name: (url.searchParams.get('name') || '').slice(0, 40),
    color: (url.searchParams.get('color') || '#28a269').slice(0, 9),
    n: crypto.randomUUID(),
  })));

  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(url),
    response_type: 'code',
    scope: SCOPES,
    // offline + consent is what actually returns a refresh_token. Without
    // prompt=consent Google omits it on re-authorisation, and the connection
    // dies as soon as the first access token expires.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return Response.redirect(`${GOOGLE_AUTH}?${p}`, 302);
}

async function oauthCallback(request, env, url) {
  const err = url.searchParams.get('error');
  if (err) {
    return htmlPage('連携をキャンセルしました',
      `<div class="ng">✕</div><h1>連携はキャンセルされました</h1>
       <p>アプリに戻って、必要ならもう一度お試しください。</p>`);
  }
  const code = url.searchParams.get('code');
  const rawState = url.searchParams.get('state') || '';
  let st;
  try { st = JSON.parse(new TextDecoder().decode(unb64url(rawState))); }
  catch { return htmlPage('連携できません', `<div class="ng">✕</div><h1>state が不正です</h1>`); }
  if (!code || !st || !st.familyId) {
    return htmlPage('連携できません', `<div class="ng">✕</div><h1>認可コードがありません</h1>`);
  }

  // 1. code → tokens
  const tokenRes = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(url),
      grant_type: 'authorization_code',
    }),
  });
  const tok = await tokenRes.json();
  if (!tok.access_token) {
    return htmlPage('連携できません',
      `<div class="ng">✕</div><h1>トークンを取得できませんでした</h1>
       <p><code>${escapeHtml(JSON.stringify(tok).slice(0, 200))}</code></p>`);
  }
  if (!tok.refresh_token) {
    // Almost always means prompt=consent was dropped, or the user had already
    // granted and Google reused the grant. Without it we cannot survive an
    // hour, so refuse rather than create a connection that dies quietly.
    return htmlPage('連携できません',
      `<div class="ng">✕</div><h1>更新用トークンが返りませんでした</h1>
       <p>Google アカウントの「サードパーティ アプリの接続」から family-map のアクセス権を削除して、
          もう一度連携してください。</p>`);
  }

  const email = await googleUserEmail(tok.access_token);
  const fsToken = await getFirebaseToken(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const familyId = st.familyId;

  // 2. Reuse an existing connection for the same Google account, so
  //    re-authorising doesn't pile up duplicate calendars.
  const existing = await findConnectionByEmail(fsToken, familyId, email);
  const connId   = existing ? existing.id : crypto.randomUUID();
  const sourceId = existing ? existing.sourceId : crypto.randomUUID();
  const now = Date.now();

  // 3. Client-visible source doc — this is what makes the calendar appear in
  //    the app's existing calendar bar / settings list, with no client changes
  //    beyond labelling. Same shape as an iCal source, provider swapped.
  await fsPatch(fsToken, `families/${familyId}/calendarSources/${sourceId}`, {
    provider:     { stringValue: 'gcal' },
    displayName:  { stringValue: st.name || (email ? `Google (${email})` : 'Google カレンダー') },
    color:        { stringValue: st.color || '#28a269' },
    googleEmail:  { stringValue: email || '' },
    calendarId:   { stringValue: 'primary' },
    syncEnabled:  { booleanValue: true },
    ownerUid:     { stringValue: '' },
    url:          { stringValue: '' },
    createdAt:    { integerValue: String(existing ? existing.createdAt || now : now) },
    updatedAt:    { integerValue: String(now) },
    lastSyncedAt: { nullValue: null },
  });

  // 4. Secret side. Absent from firestore.rules ⇒ no client can read this.
  await fsPatch(fsToken, `families/${familyId}/gcalConnections/${connId}`, {
    familyId:     { stringValue: familyId },
    sourceId:     { stringValue: sourceId },
    googleEmail:  { stringValue: email || '' },
    refreshToken: { stringValue: tok.refresh_token },
    calendarId:   { stringValue: 'primary' },
    syncToken:    { nullValue: null },
    channelId:    { nullValue: null },
    resourceId:   { nullValue: null },
    channelExpiration: { integerValue: '0' },
    createdAt:    { integerValue: String(now) },
    updatedAt:    { integerValue: String(now) },
    lastSyncAt:   { integerValue: '0' },
    lastError:    { stringValue: '' },
  });

  // 5. First sync + open the push channel.
  let note = '';
  try {
    await syncConnection(env, fsToken, familyId, connId, { full: true });
    await ensureChannel(env, fsToken, familyId, connId, url.origin);
  } catch (e) {
    note = `<p>初回同期でエラーが出ました：<code>${escapeHtml(String(e.message || e).slice(0, 160))}</code><br>
            数分後に自動で再試行されます。</p>`;
  }

  return htmlPage('連携しました',
    `<div class="ok">✓</div><h1>Google カレンダーを連携しました</h1>
     <p>${escapeHtml(email || '')}</p>
     <p>family-map に戻ってスケジュールを開いてください。<br>
        以後は Google 側の変更が数秒〜1分ほどで反映されます。</p>${note}`);
}

async function googleUserEmail(accessToken) {
  try {
    const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const d = await r.json();
    return d.email || '';
  } catch { return ''; }
}

async function accessTokenFor(env, refreshToken) {
  const r = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const d = await r.json();
  if (!d.access_token) {
    // invalid_grant here is the signature of the 7-day testing-mode expiry, or
    // the user revoking access. Surfaced to /status so it is diagnosable.
    throw new Error(`refresh failed: ${JSON.stringify(d).slice(0, 200)}`);
  }
  return d.access_token;
}

/* ─── Push channel ──────────────────────────────────────────────────────── */

async function ensureChannel(env, fsToken, familyId, connId, workerOrigin) {
  const conn = await getConnection(fsToken, familyId, connId);
  if (!conn) return;
  const now = Date.now();
  if (conn.channelId && conn.channelExpiration - now > CHANNEL_RENEW_BEFORE_MS) return;

  const at = await accessTokenFor(env, conn.refreshToken);

  // Drop the old channel first so Google doesn't keep pinging a stale id.
  if (conn.channelId && conn.resourceId) {
    try {
      await fetch(`${GCAL_BASE}/channels/stop`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: conn.channelId, resourceId: conn.resourceId }),
      });
    } catch (_) { /* best effort */ }
  }

  const channelId = crypto.randomUUID();
  const res = await fetch(`${GCAL_BASE}/calendars/${encodeURIComponent(conn.calendarId)}/events/watch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: channelId,
      type: 'web_hook',
      address: `${workerOrigin}/notify`,
      // token comes back on every ping, so /notify knows which connection to
      // sync without a lookup table.
      token: `${familyId}:${connId}`,
    }),
  });
  const d = await res.json();
  if (!res.ok || !d.resourceId) {
    throw new Error(`watch failed: ${JSON.stringify(d).slice(0, 200)}`);
  }
  await fsPatch(fsToken, `families/${familyId}/gcalConnections/${connId}`, {
    channelId:  { stringValue: channelId },
    resourceId: { stringValue: d.resourceId },
    channelExpiration: { integerValue: String(Number(d.expiration || 0)) },
    updatedAt:  { integerValue: String(Date.now()) },
  });
}

async function notify(request, env, ctx) {
  // Google's ping carries no payload — it just says "something changed".
  const state = request.headers.get('X-Goog-Resource-State');
  const token = request.headers.get('X-Goog-Channel-Token') || '';
  // Always 200 quickly: Google retries and eventually drops channels that
  // return errors, and the sync itself may take longer than the ping budget.
  if (state === 'sync' || !token.includes(':')) return new Response('ok');
  const [familyId, connId] = token.split(':');
  ctx.waitUntil((async () => {
    try {
      const fsToken = await getFirebaseToken(env.FIREBASE_SERVICE_ACCOUNT_JSON);
      await syncConnection(env, fsToken, familyId, connId, {});
    } catch (e) {
      console.log('notify sync failed', String(e));
    }
  })());
  return new Response('ok');
}

/* ─── Sync ──────────────────────────────────────────────────────────────── */

async function syncConnection(env, fsToken, familyId, connId, { full = false }) {
  const conn = await getConnection(fsToken, familyId, connId);
  if (!conn) throw new Error('connection not found');
  const at = await accessTokenFor(env, conn.refreshToken);

  let syncToken = full ? null : conn.syncToken;
  let pageToken = null;
  let items = [];
  let nextSyncToken = null;

  for (let guard = 0; guard < 20; guard++) {
    const p = new URLSearchParams({ maxResults: '250', showDeleted: 'true', singleEvents: 'true' });
    if (syncToken) p.set('syncToken', syncToken);
    else {
      // First run: don't drag in a decade of history.
      p.set('timeMin', new Date(Date.now() - 90 * 86400000).toISOString());
    }
    if (pageToken) p.set('pageToken', pageToken);

    const r = await fetch(`${GCAL_BASE}/calendars/${encodeURIComponent(conn.calendarId)}/events?${p}`, {
      headers: { Authorization: `Bearer ${at}` },
    });
    if (r.status === 410) {
      // syncToken expired — Google's documented signal to start over.
      return syncConnection(env, fsToken, familyId, connId, { full: true });
    }
    const d = await r.json();
    if (!r.ok) throw new Error(`events.list failed: ${JSON.stringify(d).slice(0, 200)}`);
    items = items.concat(d.items || []);
    if (d.nextPageToken) { pageToken = d.nextPageToken; continue; }
    nextSyncToken = d.nextSyncToken || null;
    break;
  }

  const now = Date.now();
  const writes = [];
  const deletes = [];
  for (const it of items) {
    const docId = gcalDocId(conn.sourceId, it.id);
    if (it.status === 'cancelled') { deletes.push(docId); continue; }
    writes.push({ docId, fields: gcalEventFields(it, conn.sourceId, now) });
  }

  for (const w of writes) {
    await fsPatch(fsToken, `families/${familyId}/events/${w.docId}`, w.fields);
  }
  for (const docId of deletes) {
    await fsDelete(fsToken, `families/${familyId}/events/${docId}`);
  }

  await fsPatch(fsToken, `families/${familyId}/gcalConnections/${connId}`, {
    syncToken:  nextSyncToken ? { stringValue: nextSyncToken } : { nullValue: null },
    lastSyncAt: { integerValue: String(now) },
    lastError:  { stringValue: '' },
    updatedAt:  { integerValue: String(now) },
  });
  await fsPatch(fsToken, `families/${familyId}/calendarSources/${conn.sourceId}`, {
    lastSyncedAt: { integerValue: String(now) },
    updatedAt:    { integerValue: String(now) },
  });
  return { written: writes.length, deleted: deletes.length };
}

// Firestore ids allow most characters but not '/', and Google event ids are
// [a-v0-9_-]. Prefix so these never collide with the app's own uuid ids.
// Deliberately NOT truncated: Firestore allows 1500 bytes, and clipping ids
// would let two events that share a long prefix (recurring instances share a
// base id and differ only in the trailing timestamp) collapse onto one doc and
// overwrite each other.
function gcalDocId(sourceId, googleEventId) {
  const safe = String(googleEventId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 1400);
  return `g-${String(sourceId).slice(0, 8)}-${safe}`;
}

// Mirrors the payload the in-app iCal sync writes, so every existing renderer
// picks these up with no new branches — they are just events with a sourceId.
function gcalEventFields(it, sourceId, now) {
  const allDay = !!(it.start && it.start.date);
  const startAt = gcalTs(it.start, false);
  const endAt   = gcalTs(it.end, allDay);
  return {
    title:    { stringValue: (it.summary || '無題').slice(0, 200) },
    startAt:  { integerValue: String(startAt) },
    endAt:    { integerValue: String(endAt) },
    allDay:   { booleanValue: allDay },
    isMemo:   { booleanValue: false },
    labelId:  { nullValue: null },
    body:     { stringValue: String(it.description || '').slice(0, 2000) },
    url:      { stringValue: '' },
    checklist:  { arrayValue: { values: [] } },
    members:    { arrayValue: { values: [] } },
    comments:   { arrayValue: { values: [] } },
    activities: { arrayValue: { values: [] } },
    recurrence: { mapValue: { fields: { type: { stringValue: 'none' }, until: { nullValue: null } } } },
    notifyBefore: { integerValue: '-1' },
    createdAt: { integerValue: String(now) },
    updatedAt: { integerValue: String(now) },
    sourceId:  { stringValue: sourceId },
    externalEventId: { stringValue: String(it.id || '') },
    externalSourceProvider: { stringValue: 'gcal' },
    calendarId: { nullValue: null },
    visibility: { stringValue: 'shared' },
    ownerUid:   { stringValue: '' },
    createdBy:  { stringValue: '' },
  };
}

function gcalTs(slot, isEndOfAllDay) {
  if (!slot) return 0;
  if (slot.dateTime) return Date.parse(slot.dateTime);
  if (slot.date) {
    const t = Date.parse(slot.date + 'T00:00:00');
    // Google's all-day end date is exclusive (same RFC 5545 rule the ICS path
    // already compensates for): 8/22 単日 arrives as end=8/23.
    return isEndOfAllDay ? t - 1 : t;
  }
  return 0;
}

/* ─── cron ──────────────────────────────────────────────────────────────── */

async function cronTick(env) {
  const familyIds = String(env.FAMILY_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!familyIds.length) return;
  const fsToken = await getFirebaseToken(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const origin = env.WORKER_ORIGIN || '';
  for (const familyId of familyIds) {
    let conns = [];
    try { conns = await listConnections(fsToken, familyId); } catch (_) { continue; }
    for (const c of conns) {
      try {
        if (origin) await ensureChannel(env, fsToken, familyId, c.id, origin);
        if (Date.now() - (c.lastSyncAt || 0) > SAFETY_SYNC_AFTER_MS) {
          await syncConnection(env, fsToken, familyId, c.id, {});
        }
      } catch (e) {
        await fsPatch(fsToken, `families/${familyId}/gcalConnections/${c.id}`, {
          lastError: { stringValue: String(e.message || e).slice(0, 300) },
          updatedAt: { integerValue: String(Date.now()) },
        }).catch(() => {});
      }
    }
  }
}

/* ─── client-facing helpers ─────────────────────────────────────────────── */

async function status(request, env, url) {
  const familyId = (url.searchParams.get('familyId') || '').trim();
  if (!familyId) return json({ error: 'familyId required' }, 400, request);
  const fsToken = await getFirebaseToken(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const conns = await listConnections(fsToken, familyId);
  return json({
    connections: conns.map(c => ({
      id: c.id,
      googleEmail: c.googleEmail,
      sourceId: c.sourceId,
      lastSyncAt: c.lastSyncAt || 0,
      channelExpiration: c.channelExpiration || 0,
      pushActive: !!c.channelId && (c.channelExpiration || 0) > Date.now(),
      lastError: c.lastError || '',
    })),
  }, 200, request);
}

async function syncNow(request, env, url) {
  const familyId = (url.searchParams.get('familyId') || '').trim();
  if (!familyId) return json({ error: 'familyId required' }, 400, request);
  const fsToken = await getFirebaseToken(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const conns = await listConnections(fsToken, familyId);
  const out = [];
  for (const c of conns) {
    try { out.push({ id: c.id, ...(await syncConnection(env, fsToken, familyId, c.id, {})) }); }
    catch (e) { out.push({ id: c.id, error: String(e.message || e).slice(0, 200) }); }
  }
  return json({ synced: out }, 200, request);
}

async function disconnect(request, env, url) {
  const familyId = (url.searchParams.get('familyId') || '').trim();
  const connId   = (url.searchParams.get('connId') || '').trim();
  if (!familyId || !connId) return json({ error: 'familyId and connId required' }, 400, request);
  const fsToken = await getFirebaseToken(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const conn = await getConnection(fsToken, familyId, connId);
  if (!conn) return json({ error: 'not found' }, 404, request);
  try {
    const at = await accessTokenFor(env, conn.refreshToken);
    if (conn.channelId && conn.resourceId) {
      await fetch(`${GCAL_BASE}/channels/stop`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: conn.channelId, resourceId: conn.resourceId }),
      });
    }
  } catch (_) { /* the token may already be dead; keep deleting anyway */ }
  await fsDelete(fsToken, `families/${familyId}/gcalConnections/${connId}`);
  // The app deletes the source doc and its events itself (deleteCalendarSource).
  return json({ ok: true, sourceId: conn.sourceId }, 200, request);
}

/* ─── Firestore REST ────────────────────────────────────────────────────── */

async function fsPatch(token, path, fields) {
  const mask = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const res = await fetch(`${FS_BASE}/${path}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    throw new Error(`fsPatch ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

async function fsDelete(token, path) {
  await fetch(`${FS_BASE}/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function fsGet(token, path) {
  const res = await fetch(`${FS_BASE}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fsGet ${path} HTTP ${res.status}`);
  return res.json();
}

async function listConnections(token, familyId) {
  const res = await fetch(`${FS_BASE}/families/${familyId}/gcalConnections?pageSize=50`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const d = await res.json();
  return (d.documents || []).map(docToConn);
}

async function getConnection(token, familyId, connId) {
  const d = await fsGet(token, `families/${familyId}/gcalConnections/${connId}`);
  return d ? docToConn(d) : null;
}

async function findConnectionByEmail(token, familyId, email) {
  if (!email) return null;
  const all = await listConnections(token, familyId);
  return all.find(c => c.googleEmail === email) || null;
}

function docToConn(doc) {
  const f = doc.fields || {};
  const s = k => (f[k] && f[k].stringValue) || '';
  const n = k => Number((f[k] && f[k].integerValue) || 0);
  return {
    id: String(doc.name || '').split('/').pop(),
    familyId: s('familyId'),
    sourceId: s('sourceId'),
    googleEmail: s('googleEmail'),
    refreshToken: s('refreshToken'),
    calendarId: s('calendarId') || 'primary',
    syncToken: (f.syncToken && f.syncToken.stringValue) || null,
    channelId: (f.channelId && f.channelId.stringValue) || null,
    resourceId: (f.resourceId && f.resourceId.stringValue) || null,
    channelExpiration: n('channelExpiration'),
    createdAt: n('createdAt'),
    lastSyncAt: n('lastSyncAt'),
    lastError: s('lastError'),
  };
}

/* ─── Firebase service-account auth (same pattern as family-map-notifier) ── */

async function getFirebaseToken(serviceAccountJson) {
  const sa = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  const headerB64 = objectToB64url({ alg: 'RS256', typ: 'JWT' });
  const payloadB64 = objectToB64url({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore',
  });
  const sigInput = `${headerB64}.${payloadB64}`;
  const key = await importRsaPrivateKey(sa.private_key);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, enc(sigInput)));
  const jwt = `${sigInput}.${bytesToB64url(sig)}`;
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Firebase auth failed: ${JSON.stringify(data).slice(0, 200)}`);
  return data.access_token;
}

async function importRsaPrivateKey(pem) {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '')
                 .replace(/-----END PRIVATE KEY-----/, '')
                 .replace(/\s+/g, '');
  return crypto.subtle.importKey('pkcs8', b64ToBytes(b64),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/* ─── tiny encoders ─────────────────────────────────────────────────────── */

const enc = s => new TextEncoder().encode(s);

function b64ToBytes(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64url(bytes) { return bytesToB64url(bytes); }
function unb64url(s) {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  return b64ToBytes(pad + '==='.slice((pad.length + 3) % 4));
}
function objectToB64url(obj) { return bytesToB64url(enc(JSON.stringify(obj))); }
