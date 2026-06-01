// family-map-notifier — Cloudflare Worker
// Phase 3 (2026-06-02): server-side VAPID Web Push for scheduled event reminders.
//
// Cron trigger: every 1 minute  (wrangler.toml: crons = ["* * * * *"])
// Secrets (set via `wrangler secret put`):
//   VAPID_PRIVATE_KEY          — raw base64url P-256 private key (32 bytes)
//   FIREBASE_SERVICE_ACCOUNT_JSON — Firebase service account JSON (string)
//
// Algorithm:
//   1. Fetch Firebase OAuth token via service-account JWT
//   2. List all families in Firestore
//   3. For each family, query events whose startAt places notifyAt in the current minute
//   4. For each due event, send Web Push to every subscribed family member
//   5. Write notifiedAt = now to prevent duplicate sends
//
'use strict';

const VAPID_PUBLIC_KEY  = 'BA1Oe3SW7-pDxY9Ca0C0EbJaHxjJCAX0wl4Hf_9NmHcRhzwy6wHrxpiUrOUt5Z6y4qFcql1bBDoWCRDBPH-2Yrg';
const VAPID_SUBJECT     = 'mailto:admin@pictoria.co.jp';
const FIREBASE_PROJECT  = 'family-map-c5110';
// Look back 90 s to handle slightly late cron firings; look forward 90 s for next window.
const WINDOW_BEFORE_MS  = 90_000;
const WINDOW_AFTER_MS   = 90_000;

// ─── Entry points ─────────────────────────────────────────────────────────────

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(run(env));
  },
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    // GET /run — manual trigger for testing
    if (url.pathname === '/run') {
      const result = await run(env);
      return Response.json(result);
    }
    return new Response('family-map-notifier OK', { status: 200 });
  },
};

// ─── Main logic ───────────────────────────────────────────────────────────────

async function run(env) {
  const now = Date.now();
  const log  = [];
  let sent   = 0;

  try {
    const token = await getFirebaseToken(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    // FAMILY_IDS is a comma-separated env var (set in wrangler.toml [vars]).
    // Firestore families docs are implicit (no fields) so REST list returns {}.
    const familyIds = (env.FAMILY_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    log.push(`families: ${familyIds.length} [${familyIds.join(',')}]`);

    for (const familyId of familyIds) {
      const count = await processFamily(env, token, familyId, now, log);
      sent += count;
    }
  } catch (e) {
    log.push(`FATAL: ${e.message}`);
    console.error('run error', e);
  }

  console.log('notifier done', { sent, log });
  return { ts: now, sent, log };
}

async function processFamily(env, token, familyId, now, log) {
  // Query events whose startAt could place notifyAt in [now - WINDOW_BEFORE, now + WINDOW_AFTER].
  // Max notifyBefore is 1440 min = 86 400 000 ms (前日).
  const minStartAt = now - WINDOW_BEFORE_MS;
  const maxStartAt = now + WINDOW_AFTER_MS + 1440 * 60_000;

  const events = await queryEvents(token, familyId, minStartAt, maxStartAt);
  let sent = 0;

  for (const ev of events) {
    // Skip: no notification wanted, already notified, or recurring master (handled in Phase 4)
    if (ev.notifyBefore < 0)  continue;
    if (ev.notifiedAt != null) continue;
    if (ev.recurrenceType && ev.recurrenceType !== 'none') continue;

    const notifyAt = ev.startAt - ev.notifyBefore * 60_000;
    if (notifyAt < now - WINDOW_BEFORE_MS || notifyAt > now + WINDOW_AFTER_MS) continue;

    log.push(`due: ${familyId}/${ev.id} "${ev.title}" notifyBefore=${ev.notifyBefore}`);

    // Get push subscriptions for all family members
    const members  = await getFamilyMembers(token, familyId);
    const withSubs = members.filter(m => m.pushSub?.endpoint && m.pushSub?.keys);

    const body = notifyBody(ev);
    let familySent = 0;

    for (const m of withSubs) {
      try {
        await sendWebPush(env, m.pushSub, { title: ev.title || 'FAMILY MAP', body, eventId: ev.id });
        familySent++;
      } catch (e) {
        log.push(`push err ${m.uid}: ${e.message}`);
        // 410 Gone or 404 = subscription expired; clean up
        if (e.httpStatus === 410 || e.httpStatus === 404) {
          await removePushSub(token, familyId, m.uid).catch(() => {});
        }
      }
    }

    // Mark notified regardless of how many pushes succeeded (prevents spam on partial failure)
    await markNotified(token, familyId, ev.id, now).catch(e => log.push(`markNotified err: ${e.message}`));
    log.push(`  sent ${familySent}/${withSubs.length}`);
    sent += familySent;
  }

  return sent;
}

function notifyBody(ev) {
  if (ev.notifyBefore === 0)    return '予定の時刻になりました';
  if (ev.notifyBefore >= 1440)  return '明日の予定があります';
  if (ev.notifyBefore >= 60)    return `${Math.round(ev.notifyBefore / 60)}時間後に予定があります`;
  return `${ev.notifyBefore}分後に予定があります`;
}

// ─── Firestore REST API ────────────────────────────────────────────────────────

const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

async function queryEvents(token, familyId, minStartAt, maxStartAt) {
  const url  = `${FS_BASE}/families/${familyId}:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'events' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'startAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(minStartAt) } } },
            { fieldFilter: { field: { fieldPath: 'startAt' }, op: 'LESS_THAN_OR_EQUAL',    value: { integerValue: String(maxStartAt) } } },
          ],
        },
      },
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return [];
  const rows = await res.json();
  return rows.filter(r => r.document).map(r => fsDocToEvent(r.document));
}

function fsDocToEvent(doc) {
  const f = doc.fields || {};
  const nb = f.notifyBefore?.integerValue;
  const na = f.notifiedAt?.integerValue;
  const recType = f.recurrence?.mapValue?.fields?.type?.stringValue || 'none';
  return {
    id:             doc.name.split('/').pop(),
    title:          f.title?.stringValue || '',
    startAt:        Number(f.startAt?.integerValue || 0),
    notifyBefore:   nb != null ? Number(nb) : -1,
    notifiedAt:     na != null ? Number(na) : null,
    recurrenceType: recType,
  };
}

async function getFamilyMembers(token, familyId) {
  const res = await fetch(`${FS_BASE}/families/${familyId}/members?pageSize=50`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.documents || []).map(d => {
    const f = d.fields || {};
    let pushSub = null;
    const psf = f.pushSub?.mapValue?.fields;
    if (psf?.endpoint?.stringValue) {
      const keysF = psf.keys?.mapValue?.fields;
      pushSub = {
        endpoint: psf.endpoint.stringValue,
        keys: keysF ? {
          p256dh: keysF.p256dh?.stringValue || '',
          auth:   keysF.auth?.stringValue   || '',
        } : null,
      };
    }
    return { uid: d.name.split('/').pop(), pushSub };
  });
}

async function markNotified(token, familyId, eventId, ts) {
  const url = `${FS_BASE}/families/${familyId}/events/${eventId}?updateMask.fieldPaths=notifiedAt`;
  await fetch(url, {
    method:  'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ fields: { notifiedAt: { integerValue: String(ts) } } }),
  });
}

async function removePushSub(token, familyId, uid) {
  const url = `${FS_BASE}/families/${familyId}/members/${uid}?updateMask.fieldPaths=pushSub`;
  await fetch(url, {
    method:  'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ fields: { pushSub: { nullValue: null } } }),
  });
}

// ─── Firebase service-account auth (RS256 JWT → access token) ────────────────

async function getFirebaseToken(serviceAccountJson) {
  const sa  = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);

  const headerB64  = objectToB64url({ alg: 'RS256', typ: 'JWT' });
  const payloadB64 = objectToB64url({
    iss:   sa.client_email,
    sub:   sa.client_email,
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore',
  });
  const sigInput = `${headerB64}.${payloadB64}`;

  const privateKey = await importRsaPrivateKey(sa.private_key);
  const sigBytes   = new Uint8Array(
    await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, privateKey, enc(sigInput))
  );

  const jwt = `${sigInput}.${bytesToB64url(sigBytes)}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Firebase auth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function importRsaPrivateKey(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = b64ToBytes(b64);
  return crypto.subtle.importKey(
    'pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
}

// ─── VAPID JWT (ES256) ────────────────────────────────────────────────────────

async function createVapidJwt(endpoint, vapidPrivateKeyB64url) {
  const audience   = new URL(endpoint).origin;
  const now        = Math.floor(Date.now() / 1000);
  const headerB64  = objectToB64url({ typ: 'JWT', alg: 'ES256' });
  const payloadB64 = objectToB64url({ aud: audience, exp: now + 43200, sub: VAPID_SUBJECT });
  const sigInput   = `${headerB64}.${payloadB64}`;

  // Build JWK from raw P-256 private key + the matching public key bytes
  const pubBytes = b64urlToBytes(VAPID_PUBLIC_KEY); // 65 bytes: 04 || x(32) || y(32)
  const jwk = {
    kty: 'EC', crv: 'P-256', key_ops: ['sign'],
    d: vapidPrivateKeyB64url,
    x: bytesToB64url(pubBytes.slice(1, 33)),
    y: bytesToB64url(pubBytes.slice(33, 65)),
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig  = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, key, enc(sigInput))
  );
  return `${sigInput}.${bytesToB64url(sig)}`;
}

// ─── Web Push encryption (RFC 8291 aes128gcm) ────────────────────────────────

async function sendWebPush(env, subscription, data) {
  const encrypted = await encryptPushPayload(JSON.stringify(data), subscription.keys);
  const jwt       = await createVapidJwt(subscription.endpoint, env.VAPID_PRIVATE_KEY);

  const res = await fetch(subscription.endpoint, {
    method:  'POST',
    headers: {
      'Authorization':    `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,
      'Content-Type':     'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL':              '86400',
    },
    body: encrypted,
  });

  if (!res.ok) {
    const err = new Error(`push HTTP ${res.status}`);
    err.httpStatus = res.status;
    throw err;
  }
}

async function encryptPushPayload(plaintext, subscriptionKeys) {
  const clientPub  = b64urlToBytes(subscriptionKeys.p256dh); // 65 bytes
  const authSecret = b64urlToBytes(subscriptionKeys.auth);   // 16 bytes
  const salt       = crypto.getRandomValues(new Uint8Array(16));

  // Ephemeral ECDH server key pair
  const serverKP     = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKP.publicKey)); // 65 bytes

  // ECDH shared secret
  const clientKey    = await crypto.subtle.importKey('raw', clientPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedBits   = await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, serverKP.privateKey, 256);
  const sharedSecret = new Uint8Array(sharedBits);

  // IKM = HKDF(salt=authSecret, ikm=sharedSecret, info="WebPush: info\0" + clientPub + serverPub, len=32)
  const keyInfo = cat(enc('WebPush: info\x00'), clientPub, serverPubRaw);
  const ikm     = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  // CEK = HKDF(salt=salt, ikm=ikm, info="Content-Encoding: aes128gcm\0\1", len=16)
  // NONCE = HKDF(salt=salt, ikm=ikm, info="Content-Encoding: nonce\0\1",   len=12)
  const cek   = await hkdf(salt, ikm, enc('Content-Encoding: aes128gcm\x00\x01'), 16);
  const nonce = await hkdf(salt, ikm, enc('Content-Encoding: nonce\x00\x01'),     12);

  // Encrypt: plaintext + 0x02 record delimiter
  const record   = cat(enc(plaintext), new Uint8Array([0x02]));
  const encKey   = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, encKey, record);
  const cipher   = new Uint8Array(cipherBuf);

  // RFC 8188 header: salt(16) + rs(4, uint32BE) + idlen(1) + serverPub(65)
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false); // rs = 4096 (standard default)
  header[20] = 65; // idlen
  header.set(serverPubRaw, 21);

  return cat(header, cipher);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

// HKDF-SHA-256: Extract(salt, ikm) → Expand(PRK, info, length)
async function hkdf(salt, ikm, info, length) {
  const saltKey = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prk     = new Uint8Array(await crypto.subtle.sign('HMAC', saltKey, ikm));
  const prkKey  = await crypto.subtle.importKey('raw', prk,  { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const t1      = new Uint8Array(await crypto.subtle.sign('HMAC', prkKey, cat(info, new Uint8Array([0x01]))));
  return t1.slice(0, length);
}

const enc = (s) => new TextEncoder().encode(s);

function cat(...arrays) {
  const len = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + (4 - s.length % 4) % 4, '=');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

function b64ToBytes(s) {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

function bytesToB64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function objectToB64url(obj) {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
