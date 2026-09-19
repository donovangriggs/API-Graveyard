#!/usr/bin/env node
// v2: find a real API endpoint behind a listed docs URL, then verify it.
//
// v1 can only say "the documentation page loads". That is why Kraken shows as
// a 404 there while api.kraken.com is perfectly healthy. Nothing here claims
// an endpoint unless it actually returned JSON.
const TIMEOUT_MS = 8_000;
const MAX_CANDIDATES = 6;
const PROBE_ORIGIN = 'https://api-graveyard.example';
const UA = 'api-graveyard/2.0 (+https://github.com/donovangriggs/API-Graveyard; endpoint discovery)';

const DOCS_HOSTS = ['docs', 'developer', 'developers', 'www', 'api-docs'];
const API_PATHS = ['/api', '/api/v1', '/v1'];

// Path already looks like someone's endpoint rather than a docs page.
const ENDPOINT_PATH = /\/(api|v\d+|rest|graphql)(\/|$)/i;

// 4xx codes that mean "you called me wrong", not "I do not exist".
const REJECTS_BUT_ALIVE = new Set([400, 401, 402, 403, 405, 415, 422, 429]);

export function candidateEndpoints(url) {
  let base;
  try { base = new URL(url); } catch { return []; }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') return [];

  const out = [url];
  const [first, ...rest] = base.hostname.split('.');

  // docs.kraken.com -> api.kraken.com
  if (DOCS_HOSTS.includes(first) && rest.length >= 2) {
    out.push(`${base.protocol}//api.${rest.join('.')}/`);
  }

  // A bare host gets the conventional guesses; a path that already looks like
  // an endpoint is left alone, since appending /api to it would be nonsense.
  if (!ENDPOINT_PATH.test(base.pathname)) {
    for (const path of API_PATHS) out.push(`${base.origin}${path}`);
  }

  return [...new Set(out)].slice(0, MAX_CANDIDATES);
}

export function corsFrom(headers, origin = PROBE_ORIGIN) {
  const allow = headers['access-control-allow-origin'] ?? headers.get?.('access-control-allow-origin');
  if (!allow) return 'no';
  return allow === '*' || allow === origin ? 'yes' : 'no';
}

export function looksLikeJson(contentType, body) {
  if (!body?.trim()) return false;
  // An explicit content-type is authoritative in both directions: a server
  // saying text/html is not serving an API, whatever the body happens to be.
  if (contentType) return /\bapplication\/([\w.\-]+\+)?json\b/i.test(contentType);
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

export async function discover(url) {
  for (const candidate of candidateEndpoints(url)) {
    const result = await verifyEndpoint(candidate);
    // Stop at the first confirmation: candidates are ordered by likelihood and
    // this runs across hundreds of third-party hosts.
    if (result.ok) {
      return { status: 'confirmed', endpoint: candidate, cors: result.cors, latencyMs: result.latencyMs, httpStatus: result.httpStatus };
    }
  }
  return { status: 'undiscovered', endpoint: null, cors: null, latencyMs: null, httpStatus: null };
}
