/* ============================================================================
 * family-map-cal-worker.js
 * ----------------------------------------------------------------------------
 * Cloudflare Worker that proxies iCalendar (.ics) fetches for family-map.
 *
 * Why a Worker?
 *   Apple iCloud public-calendar URLs (webcal:// or https://p**-caldav.icloud.com/
 *   published/2/...) do NOT send Access-Control-Allow-Origin, so a browser
 *   cannot fetch them directly with `fetch()` from the GitHub Pages PWA.  This
 *   Worker fetches the ICS server-side and re-emits it as JSON wrapped with the
 *   correct CORS headers.
 *
 * Endpoint:
 *   POST /sync
 *     body: { "url": "webcal://..." | "https://..." }
 *     200:  { "ics": "...full ICS text...", "fetchedAt": <ms epoch> }
 *     4xx/5xx: { "error": "...human-readable..." }
 *
 * Setup (Cloudflare dashboard, ぐっち手動作業):
 *   1. Workers & Pages → 新規 Worker 作成（name: family-map-cal）
 *   2. Quick Edit → このファイルの中身を全部貼り付け → デプロイ
 *   3. Settings → Triggers → カスタムドメイン不要（family-map-cal.<sub>.workers.dev でOK）
 *   4. 発行された URL を index.html の ICAL_WORKER_URL に書き込む
 *
 * Security:
 *   - Origin チェック：ALLOWED_ORIGIN の家族 PWA からのみ受け付け
 *   - URL は webcal:// または https://（http:// は拒否、内部 IP はそのまま透過）
 *   - タイムアウト 10 秒
 *   - 最大レスポンスサイズ 5MB（巨大 ICS で Worker メモリ枯渇を防ぐ）
 * ============================================================================ */

const ALLOWED_ORIGIN = 'https://examrx79bd03-star.github.io';
const FETCH_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB

export default {
  /**
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  async fetch(request) {
    // ----- CORS preflight -----
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // ----- Origin check -----
    const origin = request.headers.get('Origin') || '';
    if (origin && origin !== ALLOWED_ORIGIN) {
      return jsonError(403, `Origin not allowed: ${origin}`);
    }

    const url = new URL(request.url);

    // ----- Only POST /sync is supported -----
    if (request.method !== 'POST' || url.pathname !== '/sync') {
      return jsonError(404, `Not Found: ${request.method} ${url.pathname}. Use POST /sync.`);
    }

    // ----- Parse body -----
    let body;
    try {
      body = await request.json();
    } catch (_) {
      return jsonError(400, 'Body must be JSON: { "url": "..." }');
    }
    const rawUrl = (body && typeof body.url === 'string') ? body.url.trim() : '';
    if (!rawUrl) {
      return jsonError(400, 'Missing "url" field in body.');
    }

    // ----- Normalize URL (webcal:// -> https://) -----
    let targetUrl = rawUrl;
    if (targetUrl.startsWith('webcal://')) {
      targetUrl = 'https://' + targetUrl.slice('webcal://'.length);
    } else if (targetUrl.startsWith('webcals://')) {
      targetUrl = 'https://' + targetUrl.slice('webcals://'.length);
    }
    if (!/^https:\/\//i.test(targetUrl)) {
      return jsonError(400, 'URL must be webcal:// or https://');
    }
    // Lightweight host sanity check (prevents accidental fetch of localhost-style targets).
    let parsedTarget;
    try {
      parsedTarget = new URL(targetUrl);
    } catch (_) {
      return jsonError(400, 'Invalid URL format.');
    }
    if (!parsedTarget.host || parsedTarget.host.length < 3) {
      return jsonError(400, 'Invalid URL host.');
    }

    // ----- Fetch the ICS with timeout -----
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetch(targetUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          // Pretend to be a calendar client so iCloud / Google return ICS.
          'User-Agent': 'family-map-cal-worker/1.0 (+https://examrx79bd03-star.github.io/25t-tracker/family-map/)',
          'Accept': 'text/calendar, text/plain, */*',
        },
      });
    } catch (e) {
      clearTimeout(timeoutId);
      if (e && e.name === 'AbortError') {
        return jsonError(504, `Upstream timeout after ${FETCH_TIMEOUT_MS}ms.`);
      }
      return jsonError(502, `Upstream fetch failed: ${e && e.message ? e.message : String(e)}`);
    }
    clearTimeout(timeoutId);

    if (!upstream.ok) {
      return jsonError(
        upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
        `Upstream returned ${upstream.status} ${upstream.statusText || ''}`.trim()
      );
    }

    // ----- Read body with a hard cap to protect Worker memory -----
    const reader = upstream.body && upstream.body.getReader ? upstream.body.getReader() : null;
    let ics;
    if (reader) {
      const chunks = [];
      let total = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > MAX_RESPONSE_BYTES) {
            try { reader.cancel(); } catch (_) {}
            return jsonError(413, `Response too large (>${MAX_RESPONSE_BYTES} bytes).`);
          }
          chunks.push(value);
        }
      }
      // Concatenate chunks into one Uint8Array and decode as UTF-8.
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) { merged.set(c, offset); offset += c.byteLength; }
      ics = new TextDecoder('utf-8').decode(merged);
    } else {
      // Fallback path for runtimes without streaming body.
      ics = await upstream.text();
      if (ics.length > MAX_RESPONSE_BYTES) {
        return jsonError(413, `Response too large (>${MAX_RESPONSE_BYTES} bytes).`);
      }
    }

    // ----- Sanity: must look like an ICS file -----
    if (!ics || ics.indexOf('BEGIN:VCALENDAR') === -1) {
      return jsonError(422, 'Response is not a valid iCalendar (no BEGIN:VCALENDAR found).');
    }

    // ----- Success -----
    return new Response(JSON.stringify({
      ics,
      fetchedAt: Date.now(),
    }), {
      status: 200,
      headers: {
        ...corsHeaders(),
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  },
};

/**
 * Build the common CORS headers reused by every response.
 * @returns {Record<string,string>}
 */
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

/**
 * Helper to emit a JSON error with the right CORS headers.
 * @param {number} status
 * @param {string} message
 */
function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
