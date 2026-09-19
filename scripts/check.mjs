#!/usr/bin/env node
// entries.json -> docs/results.json, with strike state carried in history.json
import { readFile, writeFile } from 'node:fs/promises';
import { publishFields } from './enrich.mjs';

const CONCURRENCY = 20;
const TIMEOUT_MS = 10_000;
const STRIKES_TO_DIE = 3;
const HISTORY_DAYS = 30;
const UA = 'api-graveyard/1.0 (+https://github.com/public-apis-graveyard; nightly link health check)';

// Servers that mishandle HEAD are common enough to warrant one GET fallback.
// Timeouts are excluded: retrying them doubles the run's worst case for no signal.
const RETRY_WITH_GET = new Set([400, 403, 405, 406, 429, 500, 501, 503]);

function hostOf(url) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return null; }
}

export function classify({ httpStatus, finalUrl, url, errorCode }) {
  if (errorCode) {
    // A timeout is not evidence of death, just absence of evidence.
    if (errorCode === 'TIMEOUT') return 'unknown';
    return 'dead';
  }
  if (httpStatus >= 200 && httpStatus < 300) {
    const from = hostOf(url);
    const to = hostOf(finalUrl);
    return from && to && from !== to ? 'moved' : 'alive';
  }
  // Bot walls look exactly like death to a naive checker. They are not.
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) return 'blocked';
  if (httpStatus === 404 || httpStatus === 410) return 'dead';
  if (httpStatus >= 500) return 'dead';
  return 'unknown';
}

async function probeOnce(url, method) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: '*/*' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { httpStatus: res.status, finalUrl: res.url || url, latencyMs: Date.now() - started };
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    return {
      errorCode: timedOut ? 'TIMEOUT' : (err.cause?.code || err.code || 'FETCH_ERROR'),
      latencyMs: Date.now() - started,
    };
  }
}

export async function probe(url) {
  if (!hostOf(url)) return { url, errorCode: 'BAD_URL' };
  let result = await probeOnce(url, 'HEAD');
  if (result.errorCode === 'TIMEOUT') return { url, ...result };
  if (result.errorCode || RETRY_WITH_GET.has(result.httpStatus)) {
    result = await probeOnce(url, 'GET');
  }
  return { url, ...result };
}

// The heart of the thing: one bad night must never publish a graveyard.
export function applyProbe(prev, status, today) {
  const state = {
    strikes: prev?.strikes ?? 0,
    firstSeen: prev?.firstSeen ?? today,
    lastSeenAlive: prev?.lastSeenAlive ?? null,
    recent: prev?.recent ?? [],
  };

  if (status === 'alive' || status === 'moved') {
    state.strikes = 0;
    state.lastSeenAlive = today;
    state.status = status;
  } else if (status === 'blocked') {
    // Never accrues a strike: a guarded API is alive, just unfriendly to us.
    state.status = 'blocked';
  } else {
    state.strikes += 1;
    state.status = state.strikes >= STRIKES_TO_DIE ? 'dead' : 'unknown';
  }

  state.recent = [...state.recent, { d: today, s: state.status }].slice(-HISTORY_DAYS);
  return state;
}

async function pool(items, worker, limit) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i]);
      }
    })
  );
  return results;
}

async function main() {
  const entries = JSON.parse(await readFile('entries.json', 'utf8'));
  const history = await readFile('history.json', 'utf8').then(JSON.parse).catch(() => ({}));
  // Written by the weekly enrich pass; absent until it has run at least once.
  const endpoints = await readFile('endpoints.json', 'utf8').then(JSON.parse).catch(() => ({}));
  const today = new Date().toISOString().slice(0, 10);

  let done = 0;
  const probes = await pool(entries, async (entry) => {
    const result = await probe(entry.url);
    if (++done % 200 === 0) console.log(`  ...${done}/${entries.length}`);
    return result;
  }, CONCURRENCY);

  const results = entries.map((entry, i) => {
    const p = probes[i];
    const status = classify({ ...p, url: entry.url });
    const state = applyProbe(history[entry.url], status, today);
    history[entry.url] = state;
    return {
      ...entry,
      status: state.status,
      strikes: state.strikes,
      lastSeenAlive: state.lastSeenAlive,
      httpStatus: p.httpStatus ?? null,
      errorCode: p.errorCode ?? null,
      latencyMs: p.latencyMs ?? null,
      redirectedTo: status === 'moved' ? p.finalUrl : null,
      ...publishFields(entry, endpoints[entry.url]),
    };
  });

  // Drop history for entries upstream has already removed.
  for (const url of Object.keys(history)) {
    if (!entries.some((e) => e.url === url)) delete history[url];
  }

  const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  await writeFile('history.json', JSON.stringify(history));
  await writeFile('docs/results.json', JSON.stringify({ generatedAt: new Date().toISOString(), counts, entries: results }));
  console.log('check:', counts);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
