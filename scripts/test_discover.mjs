#!/usr/bin/env node
// v2: endpoint discovery. Written before scripts/discover.mjs exists.
// Run: node --test scripts/test_discover.mjs
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { candidateEndpoints, corsFrom, looksLikeJson, verifyEndpoint, discover } from './discover.mjs';

describe('candidateEndpoints', () => {
  test('tries the listed URL first, unchanged', () => {
    const c = candidateEndpoints('https://api.example.com/v1');
    assert.equal(c[0], 'https://api.example.com/v1');
  });

  test('swaps a docs host for an api host', () => {
    // The Kraken case: docs.kraken.com 404s while api.kraken.com is healthy.
    assert.ok(candidateEndpoints('https://docs.kraken.com/rest/').includes('https://api.kraken.com/'));
  });

  test('swaps developer/developers/www hosts too', () => {
    for (const host of ['developer', 'developers', 'www']) {
      assert.ok(
        candidateEndpoints(`https://${host}.example.com/`).includes('https://api.example.com/'),
        `${host} should yield an api. candidate`
      );
    }
  });

  test('appends conventional api paths to a bare host', () => {
    const c = candidateEndpoints('https://example.com/');
    for (const path of ['https://example.com/api', 'https://example.com/api/v1']) {
      assert.ok(c.includes(path), `missing ${path}`);
    }
  });

  test('keeps a path that already looks like an endpoint', () => {
    assert.equal(candidateEndpoints('https://example.com/api/v2/')[0], 'https://example.com/api/v2/');
  });

  test('never repeats a candidate', () => {
    const c = candidateEndpoints('https://api.example.com/api');
    assert.equal(new Set(c).size, c.length);
  });

  test('stays small — this multiplies across 849 entries', () => {
    assert.ok(candidateEndpoints('https://docs.example.com/').length <= 6);
  });

  test('yields nothing for a URL that cannot be parsed', () => {
    assert.deepEqual(candidateEndpoints('not a url'), []);
    assert.deepEqual(candidateEndpoints(''), []);
  });

  test('refuses non-http schemes', () => {
    assert.deepEqual(candidateEndpoints('ftp://example.com/'), []);
  });
});

describe('corsFrom', () => {
  const ORIGIN = 'https://api-graveyard.example';
  test('a wildcard is usable from the browser', () => {
    assert.equal(corsFrom({ 'access-control-allow-origin': '*' }, ORIGIN), 'yes');
  });
  test('an echoed origin is usable', () => {
    assert.equal(corsFrom({ 'access-control-allow-origin': ORIGIN }, ORIGIN), 'yes');
  });
  test('some other origin is not usable by us', () => {
    assert.equal(corsFrom({ 'access-control-allow-origin': 'https://someone.else' }, ORIGIN), 'no');
  });
  test('absent header means no', () => {
    assert.equal(corsFrom({}, ORIGIN), 'no');
  });
});

describe('looksLikeJson', () => {
  test('trusts an explicit json content-type', () => {
    assert.equal(looksLikeJson('application/json; charset=utf-8', '{"a":1}'), true);
  });
  test('accepts json vendor subtypes', () => {
    assert.equal(looksLikeJson('application/vnd.api+json', '{"a":1}'), true);
  });
  test('rejects html even when the body happens to parse', () => {
    assert.equal(looksLikeJson('text/html', '123'), false);
  });
  test('falls back to parsing when the server sends no content-type', () => {
    assert.equal(looksLikeJson(null, '{"a":1}'), true);
    assert.equal(looksLikeJson(null, '<!doctype html><html></html>'), false);
  });
  test('an empty body is not json', () => {
    assert.equal(looksLikeJson('application/json', ''), false);
  });
});

describe('verifyEndpoint (integration)', () => {
  let base;
  const server = createServer((req, res) => {
    const send = (code, type, body, headers = {}) => {
      res.writeHead(code, { ...(type ? { 'content-type': type } : {}), ...headers });
      res.end(body);
    };
    if (req.url === '/json') return send(200, 'application/json', '{"ok":true}', { 'access-control-allow-origin': '*' });
    if (req.url === '/json-nocors') return send(200, 'application/json', '{"ok":true}');
    if (req.url === '/html') return send(200, 'text/html', '<!doctype html><html></html>');
    if (req.url === '/boom') return send(500, 'application/json', '{"err":1}');
    return send(404, 'text/plain', 'nope');
  });

  before(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  test('confirms a JSON endpoint and reports CORS as usable', async () => {
    const r = await verifyEndpoint(`${base}/json`);
    assert.equal(r.ok, true);
    assert.equal(r.json, true);
    assert.equal(r.cors, 'yes');
    assert.equal(r.httpStatus, 200);
    assert.ok(Number.isInteger(r.latencyMs));
  });

  test('reports a JSON endpoint without CORS headers as unusable from a browser', async () => {
    const r = await verifyEndpoint(`${base}/json-nocors`);
    assert.equal(r.ok, true);
    assert.equal(r.cors, 'no');
  });

  test('an HTML page at the candidate URL is not an endpoint', async () => {
    assert.equal((await verifyEndpoint(`${base}/html`)).ok, false);
  });

  test('a 5xx is not an endpoint even when it returns JSON', async () => {
    assert.equal((await verifyEndpoint(`${base}/boom`)).ok, false);
  });

  test('a connection failure is reported, not thrown', async () => {
    const r = await verifyEndpoint('http://127.0.0.1:1/nothing');
    assert.equal(r.ok, false);
    assert.ok(r.errorCode);
  });
});

describe('discover (integration)', () => {
  let base;
  const server = createServer((req, res) => {
    if (req.url === '/api') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      return res.end('{"ok":true}');
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><html>docs</html>');
  });

  before(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  test('skips the docs page and reports the candidate that returns JSON', async () => {
    const r = await discover(`${base}/`);
    assert.equal(r.status, 'confirmed');
    assert.equal(r.endpoint, `${base}/api`);
    assert.equal(r.cors, 'yes');
  });

  test('never claims an endpoint when nothing returned JSON', async () => {
    const r = await discover('http://127.0.0.1:1/');
    assert.equal(r.status, 'undiscovered');
    assert.equal(r.endpoint, null);
  });

  test('stops probing as soon as one candidate is confirmed', async () => {
    let hits = 0;
    const counted = createServer((req, res) => {
      hits++;
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end('{"ok":true}');
    });
    await new Promise((r) => counted.listen(0, '127.0.0.1', r));
    await discover(`http://127.0.0.1:${counted.address().port}/`);
    counted.close();
    assert.equal(hits, 1, 'first candidate confirmed, so no further requests should be made');
  });
});
