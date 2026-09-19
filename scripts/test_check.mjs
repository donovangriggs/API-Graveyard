#!/usr/bin/env node
// probe(), the concurrency pool, and cache pruning — the parts of the nightly
// job that had no coverage.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { probe, pool } from './check.mjs';
import { pruneToEntries } from './enrich.mjs';

describe('probe (integration)', () => {
  let base;
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.url === '/ok') { res.writeHead(200); return res.end('hi'); }
    // Servers that reject HEAD but answer GET are common enough to warrant
    // the fallback; this is the case it exists for.
    if (req.url === '/head-hostile') {
      if (req.method === 'HEAD') { res.writeHead(405); return res.end(); }
      res.writeHead(200); return res.end('hi');
    }
    if (req.url === '/gone') { res.writeHead(404); return res.end(); }
    res.writeHead(200); res.end();
  });

  before(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  test('a plain HEAD is enough when the server allows it', async () => {
    seen.length = 0;
    const r = await probe(`${base}/ok`);
    assert.equal(r.httpStatus, 200);
    assert.deepEqual(seen, ['HEAD /ok'], 'should not spend a second request');
  });

  test('falls back to GET when HEAD is rejected', async () => {
    seen.length = 0;
    const r = await probe(`${base}/head-hostile`);
    assert.equal(r.httpStatus, 200);
    assert.deepEqual(seen, ['HEAD /head-hostile', 'GET /head-hostile']);
  });

  test('reports latency as a number', async () => {
    assert.ok(Number.isInteger((await probe(`${base}/ok`)).latencyMs));
  });

  test('a malformed URL is reported, never thrown', async () => {
    assert.equal((await probe('not a url')).errorCode, 'BAD_URL');
    assert.equal((await probe('ftp://example.com/')).errorCode, 'BAD_URL');
  });

  test('a refused connection is reported as an error code', async () => {
    const r = await probe('http://127.0.0.1:1/nope');
    assert.ok(r.errorCode);
    assert.equal(r.httpStatus, undefined);
  });
});

describe('pool', () => {
  test('preserves input order regardless of completion order', async () => {
    const out = await pool([30, 1, 20, 2], async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    }, 4);
    assert.deepEqual(out, [30, 1, 20, 2]);
  });

  test('never exceeds the concurrency limit', async () => {
    let live = 0, peak = 0;
    await pool(Array.from({ length: 20 }, (_, i) => i), async () => {
      peak = Math.max(peak, ++live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
    }, 3);
    assert.ok(peak <= 3, `peak concurrency ${peak} exceeded limit 3`);
  });

  test('handles an empty list without hanging', async () => {
    assert.deepEqual(await pool([], async () => 1, 5), []);
  });

  test('a limit larger than the list is harmless', async () => {
    assert.deepEqual(await pool([1, 2], async (x) => x * 2, 99), [2, 4]);
  });
});

describe('pruneToEntries', () => {
  // Both the nightly and weekly jobs need this, and each had its own copy.
  test('drops keys for entries upstream has removed', () => {
    const cache = { 'https://a/': 1, 'https://gone/': 2 };
    pruneToEntries(cache, [{ url: 'https://a/' }]);
    assert.deepEqual(Object.keys(cache), ['https://a/']);
  });

  test('keeps everything when nothing was removed', () => {
    const cache = { 'https://a/': 1, 'https://b/': 2 };
    pruneToEntries(cache, [{ url: 'https://a/' }, { url: 'https://b/' }]);
    assert.equal(Object.keys(cache).length, 2);
  });

  test('an empty entry list empties the cache rather than throwing', () => {
    const cache = { 'https://a/': 1 };
    pruneToEntries(cache, []);
    assert.deepEqual(cache, {});
  });
});
