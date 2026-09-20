#!/usr/bin/env node
// Weekly pass: find and verify a real endpoint for the no-auth entries.
// Separate from the nightly link check because it is far heavier, and because
// a confirmed endpoint stays confirmed — the cache is the point.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { specCandidateUrls, endpointsFromSpec, urlsFromCodeBlocks } from './extract.mjs';
import { verifyEndpoint } from './discover.mjs';

const CONCURRENCY = 8;
const TIMEOUT_MS = 6_000;
const MAX_VERIFY = 6;            // candidates tried per entry
const CONFIRMED_TTL_DAYS = 30;   // re-check a known endpoint monthly
const MISS_TTL_DAYS = 14;        // retry a failure fortnightly, not weekly
const UA = 'api-graveyard/2.0 (+https://github.com/donovangriggs/API-Graveyard; endpoint discovery)';

const daysBetween = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);

export function needsDiscovery(entry, cached, today) {
  // No key means no way to call it, so there is nothing to verify.
  if (entry.auth !== 'No') return false;
  if (!cached?.checkedAt) return true;
  // Upstream edited the link; whatever we confirmed was for a different entry.
  if (cached.url && cached.url !== entry.url) return true;
  const age = daysBetween(today, cached.checkedAt);
  return age >= (cached.status === 'confirmed' ? CONFIRMED_TTL_DAYS : MISS_TTL_DAYS);
}

// Most entries were never testable. Reporting them as "no CORS" would publish
// a measurement we never made, so they are 'unverified' — a third state.
export function publishFields(entry, cached) {
  const confirmed = cached?.status === 'confirmed';
  const verifiedCors = confirmed ? cached.cors : 'unverified';
  return {
    endpoint: confirmed ? cached.endpoint : null,
    apiLatencyMs: confirmed ? (cached.latencyMs ?? null) : null,
    verifiedCors,
    claimedCors: entry.cors,
    corsDisagrees: confirmed && (verifiedCors === 'yes') !== (entry.cors === 'Yes'),
  };
}

// Both jobs keep a url-keyed cache and both must forget entries upstream has
// removed. One copy, used by check.mjs (history) and enrich.mjs (endpoints).
export function pruneToEntries(cache, entries) {
  const live = new Set(entries.map((e) => e.url));
  for (const url of Object.keys(cache)) {
    if (!live.has(url)) delete cache[url];
  }
  return cache;
}

// Bounded-concurrency map, preserving input order. Lives here beside the other
// shared helpers because check.mjs already imports from this module; the other
// direction would be a cycle.
export async function pool(items, worker, limit) {
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

async function getText(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.ok) return await res.text();
    // Same reason as check.mjs: an unread body holds its connection open.
    await res.body?.cancel().catch(() => {});
    return null;
  } catch { return null; }
}

async function discoverOne(entry) {
  const html = (await getText(entry.url)) ?? '';

  // Extractor A first: a spec is fact, the code blocks are inference.
  const candidates = [];
  for (const specUrl of specCandidateUrls(entry.url, html)) {
    const body = await getText(specUrl);
    if (!body) continue;
    try {
      const found = endpointsFromSpec(JSON.parse(body), specUrl);
      if (found.length) { candidates.push(...found); break; }
    } catch { /* not a spec */ }
  }
  candidates.push(...urlsFromCodeBlocks(html, entry.url));

  for (const candidate of candidates.slice(0, MAX_VERIFY)) {
    const result = await verifyEndpoint(candidate);
    if (result.ok) {
      return { status: 'confirmed', endpoint: candidate, cors: result.cors, latencyMs: result.latencyMs, confirmedBy: result.confirmedBy };
    }
  }
  return { status: 'undiscovered', endpoint: null, cors: null, latencyMs: null };
}

export async function enrich(entries, cache, today, { maxEntries = Infinity } = {}) {
  const due = entries.filter((e) => needsDiscovery(e, cache[e.url], today)).slice(0, maxEntries);
  await pool(due, async (entry) => {
    cache[entry.url] = { ...(await discoverOne(entry)), url: entry.url, checkedAt: today };
  }, CONCURRENCY);
  return due.length;
}

async function main() {
  const entries = JSON.parse(await readFile('entries.json', 'utf8'));
  const cache = await readFile('endpoints.json', 'utf8').then(JSON.parse).catch(() => ({}));
  const today = new Date().toISOString().slice(0, 10);

  const noAuth = entries.filter((e) => e.auth === 'No');
  const processed = await enrich(noAuth, cache, today);

  pruneToEntries(cache, entries);

  const confirmed = Object.values(cache).filter((c) => c.status === 'confirmed');
  await writeFile('endpoints.json', JSON.stringify(cache, null, 2));
  console.log(`enrich: ${processed} entries discovered this run; ${confirmed.length}/${noAuth.length} no-auth entries have a confirmed endpoint`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
