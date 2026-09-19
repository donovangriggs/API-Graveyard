#!/usr/bin/env node
// Phase 1: the weekly enrichment pass. Written before scripts/enrich.mjs exists.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { needsDiscovery, publishFields, enrich } from './enrich.mjs';

const TODAY = '2026-09-19';
const entry = (over = {}) => ({ name: 'Thing', url: 'https://example.com/docs/', auth: 'No', cors: 'Yes', ...over });

describe('needsDiscovery — what the weekly pass is allowed to spend requests on', () => {
  test('an entry never seen before needs discovery', () => {
    assert.equal(needsDiscovery(entry(), undefined, TODAY), true);
  });

  test('a confirmed, fresh endpoint is left alone', () => {
    const cached = { status: 'confirmed', endpoint: 'https://api.example.com/v1', checkedAt: '2026-09-15' };
    assert.equal(needsDiscovery(entry(), cached, TODAY), false);
  });

  test('a confirmed endpoint is re-discovered once it goes stale', () => {
    const cached = { status: 'confirmed', endpoint: 'https://api.example.com/v1', checkedAt: '2026-07-01' };
    assert.equal(needsDiscovery(entry(), cached, TODAY), true);
  });

  test('an undiscovered entry is retried, but not every week', () => {
    assert.equal(needsDiscovery(entry(), { status: 'undiscovered', checkedAt: '2026-09-15' }, TODAY), false);
    assert.equal(needsDiscovery(entry(), { status: 'undiscovered', checkedAt: '2026-08-01' }, TODAY), true);
  });

  test('entries needing a key are never discovered — we have no key to send', () => {
    for (const auth of ['apiKey', 'OAuth']) {
      assert.equal(needsDiscovery(entry({ auth }), undefined, TODAY), false, auth);
    }
  });

  test('a cache entry whose docs URL changed upstream is re-discovered', () => {
    const cached = { status: 'confirmed', endpoint: 'https://api.old.com/v1', checkedAt: TODAY, url: 'https://old.example/docs/' };
    assert.equal(needsDiscovery(entry(), cached, TODAY), true);
  });
});

describe('publishFields — the honesty rule the plan commits to', () => {
  // 24% recall means most entries were never testable. Saying "no CORS" for
  // those would be a measurement we never made.
  test('an entry with no confirmed endpoint is unverified, never a failure', () => {
    const f = publishFields(entry(), undefined);
    assert.equal(f.verifiedCors, 'unverified');
    assert.equal(f.endpoint, null);
    assert.equal(f.apiLatencyMs, null);
  });

  test('an undiscovered entry is also unverified, not no', () => {
    assert.equal(publishFields(entry(), { status: 'undiscovered' }).verifiedCors, 'unverified');
  });

  test('a confirmed endpoint with CORS reports yes', () => {
    const f = publishFields(entry(), { status: 'confirmed', endpoint: 'https://api.example.com/v1', cors: 'yes', latencyMs: 120 });
    assert.equal(f.verifiedCors, 'yes');
    assert.equal(f.endpoint, 'https://api.example.com/v1');
    assert.equal(f.apiLatencyMs, 120);
  });

  test('a confirmed endpoint without CORS reports no — this one we did measure', () => {
    assert.equal(publishFields(entry(), { status: 'confirmed', endpoint: 'https://api.example.com/v1', cors: 'no' }).verifiedCors, 'no');
  });

  test('never contradicts upstream silently — the claimed value is carried through', () => {
    const f = publishFields(entry({ cors: 'Yes' }), { status: 'confirmed', endpoint: 'https://x', cors: 'no' });
    assert.equal(f.claimedCors, 'Yes');
    assert.equal(f.corsDisagrees, true);
  });

  test('no disagreement flag when we never measured', () => {
    assert.equal(publishFields(entry({ cors: 'Yes' }), undefined).corsDisagrees, false);
  });
});

describe('enrich (integration)', () => {
  let base;
  const server = createServer((req, res) => {
    if (req.url === '/docs/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<pre><code>curl http://127.0.0.1:PORT/api/v1/status</code></pre>'.replace('PORT', server.address().port));
    }
    if (req.url === '/api/v1/status') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      return res.end('{"ok":true}');
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('no');
  });

  test('discovers an endpoint and records it in the cache', async (t) => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    t.after(() => server.close());
    base = `http://127.0.0.1:${server.address().port}`;

    const cache = {};
    const entries = [entry({ url: `${base}/docs/` })];
    await enrich(entries, cache, TODAY);

    const record = cache[`${base}/docs/`];
    assert.equal(record.status, 'confirmed');
    assert.equal(record.endpoint, `${base}/api/v1/status`);
    assert.equal(record.cors, 'yes');
    assert.equal(record.checkedAt, TODAY);
  });

  test('a second pass spends no requests on an already-confirmed entry', async () => {
    const cache = {
      [`${base}/docs/`]: { status: 'confirmed', endpoint: `${base}/api/v1/status`, cors: 'yes', checkedAt: TODAY, url: `${base}/docs/` },
    };
    // The server is closed by now, so any request would fail and the record
    // would change. It must not.
    await enrich([entry({ url: `${base}/docs/` })], cache, TODAY);
    assert.equal(cache[`${base}/docs/`].status, 'confirmed');
  });

  test('records a miss so it is not retried every week', async () => {
    const cache = {};
    await enrich([entry({ url: 'http://127.0.0.1:1/docs/' })], cache, TODAY);
    assert.equal(cache['http://127.0.0.1:1/docs/'].status, 'undiscovered');
    assert.equal(cache['http://127.0.0.1:1/docs/'].checkedAt, TODAY);
  });

  test('respects a hard request budget', async () => {
    const cache = {};
    const many = Array.from({ length: 50 }, (_, i) => entry({ url: `http://127.0.0.1:1/docs/${i}` }));
    await enrich(many, cache, TODAY, { maxEntries: 5 });
    assert.equal(Object.keys(cache).length, 5);
  });
});
