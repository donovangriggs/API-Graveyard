#!/usr/bin/env node
// Smoke test for docs/index.html against a fixture, in a real browser.
//
// The strike logic had unit tests and worked first try; the page had none and
// shipped a blank table (esc() was in the temporal dead zone, so every row
// threw). That bug is invisible to anything that does not execute the page, so
// this renders it in headless Chrome and reads the resulting DOM.
//
// Covers first render only — --dump-dom cannot click. The filter and search
// wiring is not exercised here.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';

const CHROMES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

const FIXTURE = {
  generatedAt: '2026-09-19T00:00:00.000Z',
  counts: { alive: 1, moved: 1, dead: 1 },
  entries: [
    { name: 'Alive One', description: 'works', category: 'Animals', auth: 'No',
      status: 'alive', strikes: 0, httpStatus: 200, latencyMs: 42, errorCode: null,
      lastSeenAlive: '2026-09-19', redirectedTo: null, url: 'https://alive.example/' },
    { name: 'Moved One', description: 'relocated', category: 'Weather', auth: 'apiKey',
      status: 'moved', strikes: 0, httpStatus: 200, latencyMs: 90, errorCode: null,
      lastSeenAlive: '2026-09-19', redirectedTo: 'https://elsewhere.example/', url: 'https://moved.example/' },
    { name: '<script>alert(1)</script>', description: 'hostile name', category: 'Test Data', auth: 'No',
      status: 'dead', strikes: 3, httpStatus: null, latencyMs: null, errorCode: 'ENOTFOUND',
      lastSeenAlive: '2026-08-01', redirectedTo: null, url: 'https://gone.example/' },
  ],
};

const chrome = CHROMES.find((p) => existsSync(p));
if (!chrome) {
  const msg = 'no Chrome found (set CHROME_PATH)';
  if (process.env.REQUIRE_BROWSER) { console.error(`page test: ${msg}`); process.exit(1); }
  console.log(`page test: SKIPPED — ${msg}`);
  process.exit(0);
}

const page = await readFile('docs/index.html', 'utf8');
const server = createServer((req, res) => {
  if (req.url.startsWith('/results.json')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(FIXTURE));
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(page);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

try {
  const { stdout: dom } = await promisify(execFile)(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--virtual-time-budget=8000', '--dump-dom', url,
  ], { maxBuffer: 32 * 1024 * 1024 });

  // Scope to the tbody: the thead's own <tr> is not a result row.
  const tbody = dom.split('<tbody id="rows">')[1]?.split('</tbody>')[0] ?? '';
  const rows = tbody.match(/<tr>/g)?.length ?? 0;
  assert.equal(rows, FIXTURE.entries.length, `expected ${FIXTURE.entries.length} rows, rendered ${rows}`);

  assert.match(dom, /Alive One/, 'entry name missing');
  assert.match(dom, /HTTP 200 · 42ms/, 'alive detail line missing');
  assert.match(dom, /now redirects to https:\/\/elsewhere\.example\//, 'moved destination missing');
  assert.match(dom, /ENOTFOUND · last alive 2026-08-01/, 'dead detail line missing');
  assert.match(dom, /class="chip s-alive"[\s\S]*?>1</, 'status counts missing');
  assert.match(dom, /All categories[\s\S]*?Animals[\s\S]*?Test Data[\s\S]*?Weather/, 'category options missing or unsorted');

  // A hostile entry name from upstream must not become markup.
  assert.match(dom, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, 'entry name was not escaped');
  assert.doesNotMatch(dom, /<script>alert\(1\)<\/script>/, 'entry name injected live markup');

  console.log(`page test: ${rows} rows rendered, all assertions passed`);
} finally {
  server.close();
}
