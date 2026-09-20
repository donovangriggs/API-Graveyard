#!/usr/bin/env node
// v2: verify that a candidate API endpoint is real.
//
// v1 can only say "the documentation page loads". That is why Kraken shows as
// a 404 there while api.kraken.com is perfectly healthy. Nothing here claims
// an endpoint unless it actually returned JSON.
//
// Candidates come from extract.mjs, which reads them out of the docs page. The
// original host-guessing pass (docs.x.com -> api.x.com, plus /api and /v1)
// lived here and was superseded by that: a spec or a curl example is evidence,
// a guessed hostname is not.
const TIMEOUT_MS = 8_000;
const PROBE_ORIGIN = 'https://api-graveyard.example';
const UA = 'api-graveyard/2.0 (+https://github.com/donovangriggs/API-Graveyard; endpoint discovery)';

// 4xx codes that mean "you called me wrong", not "I do not exist".
const REJECTS_BUT_ALIVE = new Set([400, 401, 402, 403, 405, 415, 422, 429]);

export function corsFrom(headers, origin = PROBE_ORIGIN) {
  const allow = headers['access-control-allow-origin'] ?? headers.get?.('access-control-allow-origin');
  if (!allow) return 'no';
  return allow === '*' || allow === origin ? 'yes' : 'no';
}

export function looksLikeJson(contentType, body) {
  if (!body?.trim()) return false;
  // An explicit content-type is authoritative in both directions: a server
  // saying text/html is not serving an API, whatever the body happens to be.
  if (contentType) return /\bapplication\/([\w.-]+\+)?json\b/i.test(contentType);
  try { JSON.parse(body); return true; } catch { return false; }
}

export async function verifyEndpoint(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, origin: PROBE_ORIGIN, accept: 'application/json,*/*' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.text();
    const latencyMs = Date.now() - started;
    const json = looksLikeJson(res.headers.get('content-type'), body);
    // A live API rejecting a malformed call proves the endpoint exists —
    // api.geoplugin.com answers 400 with a JSON body. 404/410 are excluded
    // because they say the opposite: this path is not there. Without that
    // exclusion an API gateway's JSON 404 would confirm any guess.
    const rejection = json && REJECTS_BUT_ALIVE.has(res.status);
    return {
      ok: (res.ok && json) || rejection,
      confirmedBy: res.ok && json ? 'success' : rejection ? 'rejection' : null,
      json,
      cors: corsFrom(res.headers),
      httpStatus: res.status,
      latencyMs,
    };
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    return {
      ok: false,
      errorCode: timedOut ? 'TIMEOUT' : (err.cause?.code || err.code || 'FETCH_ERROR'),
      latencyMs: Date.now() - started,
    };
  }
}
