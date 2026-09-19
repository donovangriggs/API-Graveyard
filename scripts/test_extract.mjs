#!/usr/bin/env node
// Phase 0: Extractors A (OpenAPI spec) and B (docs code blocks).
// Written before scripts/extract.mjs exists.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { specCandidateUrls, endpointsFromSpec, urlsFromCodeBlocks, hasUrlInCodeBlock } from './extract.mjs';

describe('specCandidateUrls (Extractor A)', () => {
  test('probes the conventional spec locations on the origin', () => {
    const c = specCandidateUrls('https://example.com/docs/');
    for (const p of ['/openapi.json', '/swagger.json', '/v3/api-docs']) {
      assert.ok(c.includes(`https://example.com${p}`), `missing ${p}`);
    }
  });

  test('finds a spec referenced by the docs page itself', () => {
    // Swagger UI and Redoc both name their spec file in the page.
    const html = '<redoc spec-url="/static/openapi.json"></redoc>';
    assert.ok(specCandidateUrls('https://example.com/docs/', html).includes('https://example.com/static/openapi.json'));
  });

  test('resolves a relative spec reference against the docs URL, not the origin', () => {
    const html = '<script>SwaggerUIBundle({url: "./v2/swagger.json"})</script>';
    assert.ok(specCandidateUrls('https://example.com/docs/', html).includes('https://example.com/docs/v2/swagger.json'));
  });

  test('accepts an absolute spec reference on another host', () => {
    const html = '<redoc spec-url="https://cdn.example.net/openapi.json"></redoc>';
    assert.ok(specCandidateUrls('https://example.com/docs/', html).includes('https://cdn.example.net/openapi.json'));
  });

  test('a page-referenced spec is tried before the blind guesses', () => {
    const html = '<redoc spec-url="/static/openapi.json"></redoc>';
    assert.equal(specCandidateUrls('https://example.com/docs/', html)[0], 'https://example.com/static/openapi.json');
  });

  test('dedupes and stays bounded', () => {
    const html = '<redoc spec-url="/openapi.json"></redoc>';
    const c = specCandidateUrls('https://example.com/', html);
    assert.equal(new Set(c).size, c.length);
    assert.ok(c.length <= 6);
  });

  test('yields nothing for an unparseable URL', () => {
    assert.deepEqual(specCandidateUrls('not a url'), []);
  });
});

describe('endpointsFromSpec (Extractor A)', () => {
  const SPEC = {
    openapi: '3.0.0',
    servers: [{ url: 'https://api.example.com/v1' }],
    paths: {
      '/status': { get: {} },
      '/users/{id}': { get: {} },
      '/things': { post: {} },
    },
  };

  test('joins the server URL with a path', () => {
    assert.ok(endpointsFromSpec(SPEC, 'https://example.com/openapi.json').includes('https://api.example.com/v1/status'));
  });

  test('prefers callable paths over ones needing a parameter we cannot invent', () => {
    const e = endpointsFromSpec(SPEC, 'https://example.com/openapi.json');
    assert.equal(e[0], 'https://api.example.com/v1/status');
  });

  test('ignores paths with no GET — we only ever issue GETs', () => {
    assert.ok(!endpointsFromSpec(SPEC, 'https://example.com/openapi.json').some((u) => u.endsWith('/things')));
  });

  test('resolves a relative server URL against the spec location', () => {
    const spec = { openapi: '3.0.0', servers: [{ url: '/api/v2' }], paths: { '/ping': { get: {} } } };
    assert.ok(endpointsFromSpec(spec, 'https://example.com/docs/openapi.json').includes('https://example.com/api/v2/ping'));
  });

  test('falls back to the spec origin when servers is absent', () => {
    const spec = { openapi: '3.0.0', paths: { '/ping': { get: {} } } };
    assert.ok(endpointsFromSpec(spec, 'https://example.com/openapi.json').includes('https://example.com/ping'));
  });

  test('understands Swagger 2.0 host + basePath', () => {
    const spec = { swagger: '2.0', host: 'api.example.com', basePath: '/v1', schemes: ['https'], paths: { '/ping': { get: {} } } };
    assert.ok(endpointsFromSpec(spec, 'https://example.com/swagger.json').includes('https://api.example.com/v1/ping'));
  });

  test('returns nothing for JSON that is not a spec', () => {
    assert.deepEqual(endpointsFromSpec({ hello: 'world' }, 'https://example.com/x.json'), []);
    assert.deepEqual(endpointsFromSpec(null, 'https://example.com/x.json'), []);
  });

  test('stays bounded on a huge spec', () => {
    const paths = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`/p${i}`, { get: {} }]));
    assert.ok(endpointsFromSpec({ openapi: '3.0.0', paths }, 'https://example.com/openapi.json').length <= 6);
  });
});

describe('urlsFromCodeBlocks (Extractor B)', () => {
  const DOCS = 'https://example.com/docs/';

  test('pulls the URL out of a curl example', () => {
    const html = '<pre><code>curl https://api.example.com/v1/status</code></pre>';
    assert.ok(urlsFromCodeBlocks(html, DOCS).includes('https://api.example.com/v1/status'));
  });

  test('ignores URLs in prose — only code blocks count', () => {
    const html = '<p>Read more at https://api.example.com/marketing</p>';
    assert.deepEqual(urlsFromCodeBlocks(html, DOCS), []);
  });

  test('decodes HTML entities in the block', () => {
    const html = '<code>https://api.example.com/v1?a=1&amp;b=2</code>';
    assert.ok(urlsFromCodeBlocks(html, DOCS).includes('https://api.example.com/v1?a=1&b=2'));
  });

  test('strips trailing punctuation and quotes', () => {
    const html = `<code>fetch("https://api.example.com/v1/status").then()</code>`;
    assert.ok(urlsFromCodeBlocks(html, DOCS).includes('https://api.example.com/v1/status'));
  });

  test('keeps same-domain and api-subdomain hosts', () => {
    const html = '<code>https://api.example.com/a https://example.com/b</code>';
    const u = urlsFromCodeBlocks(html, DOCS);
    assert.ok(u.includes('https://api.example.com/a'));
    assert.ok(u.includes('https://example.com/b'));
  });

  test('drops unrelated hosts — a repo link is not the API', () => {
    const html = '<code>https://github.com/owner/repo https://twitter.com/x</code>';
    assert.deepEqual(urlsFromCodeBlocks(html, DOCS), []);
  });

  test('drops asset URLs', () => {
    const html = '<code>https://example.com/logo.png https://example.com/app.js</code>';
    assert.deepEqual(urlsFromCodeBlocks(html, DOCS), []);
  });

  test('ranks a callable URL above one with an unresolved placeholder', () => {
    const html = '<code>https://api.example.com/users/{id} https://api.example.com/status</code>';
    assert.equal(urlsFromCodeBlocks(html, DOCS)[0], 'https://api.example.com/status');
  });

  test('still offers a placeholder URL when nothing cleaner exists', () => {
    const html = '<code>https://api.example.com/users/YOUR_API_KEY</code>';
    assert.equal(urlsFromCodeBlocks(html, DOCS).length, 1);
  });

  test('dedupes and caps at 6', () => {
    const html = `<code>${Array.from({ length: 20 }, (_, i) => `https://api.example.com/p${i}`).join(' ')} https://api.example.com/p0</code>`;
    const u = urlsFromCodeBlocks(html, DOCS);
    assert.equal(new Set(u).size, u.length);
    assert.ok(u.length <= 6);
  });

  test('survives a page with no code blocks at all', () => {
    assert.deepEqual(urlsFromCodeBlocks('<html><body>nothing</body></html>', DOCS), []);
  });
});

describe('hasUrlInCodeBlock (the free prefilter before any model call)', () => {
  test('true when a code block holds a URL', () => {
    assert.equal(hasUrlInCodeBlock('<pre>curl https://api.example.com/v1</pre>'), true);
  });
  test('false when code blocks hold no URL — a model could only invent one', () => {
    assert.equal(hasUrlInCodeBlock('<pre>npm install thing</pre>'), false);
  });
  test('false when there are no code blocks', () => {
    assert.equal(hasUrlInCodeBlock('<p>https://api.example.com/v1</p>'), false);
  });

  // A /g regex carries lastIndex between calls. This runs once per entry
  // across hundreds of entries, so a stateful match would skip pages at random.
  test('gives the same answer when called repeatedly', () => {
    const html = '<pre>curl https://api.example.com/v1</pre>';
    for (let i = 0; i < 5; i++) assert.equal(hasUrlInCodeBlock(html), true, `call ${i + 1} disagreed`);
  });
});
