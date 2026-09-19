#!/usr/bin/env node
// v2: endpoint verification. Written before scripts/discover.mjs exists.
// Run: node --test scripts/test_discover.mjs
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { corsFrom, looksLikeJson, verifyEndpoint } from './discover.mjs';

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
    if (req.url === '/rejects') return send(400, 'application/json', '{"error":"missing param"}');
    if (req.url === '/needs-key') return send(401, 'application/json', '{"error":"unauthorized"}');
    if (req.url === '/gone-json') return send(404, 'application/json', '{"error":"not found"}');
    return send(404, 'text/plain', 'nope');
  });

  before(async () => {
    await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
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

  // A live API rejecting a malformed call proves the endpoint exists. This is
  // the geoPlugin case: api.geoplugin.com/ answers 400 with a JSON body.
  test('a JSON-shaped 4xx rejection confirms the endpoint', async () => {
    const r = await verifyEndpoint(`${base}/rejects`);
    assert.equal(r.ok, true);
    assert.equal(r.confirmedBy, 'rejection');
  });

  test('a 401 asking for a key also confirms the endpoint exists', async () => {
    assert.equal((await verifyEndpoint(`${base}/needs-key`)).ok, true);
  });

  // 404 is the one 4xx that means the opposite: this path is not there. Taking
  // every JSON 4xx would let an API gateway's JSON 404 confirm any guess.
  test('a JSON 404 does not confirm — it says the path is wrong', async () => {
    assert.equal((await verifyEndpoint(`${base}/gone-json`)).ok, false);
  });

  test('a 4xx with an HTML body confirms nothing', async () => {
    assert.equal((await verifyEndpoint(`${base}/missing`)).ok, false);
  });

  test('a 2xx success is labelled as such', async () => {
    assert.equal((await verifyEndpoint(`${base}/json`)).confirmedBy, 'success');
  });

  test('a connection failure is reported, not thrown', async () => {
    const r = await verifyEndpoint('http://127.0.0.1:1/nothing');
    assert.equal(r.ok, false);
    assert.ok(r.errorCode);
  });
});
