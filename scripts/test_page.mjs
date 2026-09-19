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

const base = {
  strikes: 0, httpStatus: 200, latencyMs: 42, errorCode: null, lastSeenAlive: '2026-09-19',
  redirectedTo: null, endpoint: null, apiLatencyMs: null, verifiedCors: 'unverified',
  claimedCors: 'Unknown', corsDisagrees: false,
};

const FIXTURE = {
  generatedAt: '2026-09-19T00:00:00.000Z',
  counts: { alive: 5, moved: 1, dead: 1 },
  entries: [
    // The one entry that satisfies all three directory filters.
    { ...base, name: 'Usable One', description: 'works from a browser', category: 'Animals',
      auth: 'No', status: 'alive', url: 'https://usable.example/',
      endpoint: 'https://api.usable.example/v1', apiLatencyMs: 55, verifiedCors: 'yes', claimedCors: 'Yes' },
    // Alive and no-auth, but CORS was measured and is genuinely absent.
    { ...base, name: 'No Cors', description: 'server only', category: 'Animals',
      auth: 'No', status: 'alive', url: 'https://nocors.example/',
      endpoint: 'https://api.nocors.example/v1', verifiedCors: 'no', claimedCors: 'Yes', corsDisagrees: true },
    // Alive and no-auth, but never testable — must not read as a failure.
    { ...base, name: 'Untested One', description: 'never testable', category: 'Animals',
      auth: 'No', status: 'alive', url: 'https://untested.example/' },
    // Verified CORS but needs a key, so it fails the no-auth filter.
    { ...base, name: 'Moved One', description: 'relocated', category: 'Weather', auth: 'apiKey',
      status: 'moved', latencyMs: 90, redirectedTo: 'https://elsewhere.example/',
      url: 'https://moved.example/', endpoint: 'https://api.moved.example/v1', verifiedCors: 'yes' },
    { ...base, name: '<script>alert(1)</script>', description: 'hostile name', category: 'Test Data',
      auth: 'No', status: 'dead', strikes: 3, httpStatus: null, latencyMs: null,
      errorCode: 'ENOTFOUND', lastSeenAlive: '2026-08-01', url: 'https://gone.example/' },
    // The upstream README is community-edited: anyone can open a PR adding an
    // entry, so every field here is third-party input, URLs included.
    { ...base, name: 'Attr Breakout', description: 'hostile url', category: 'Test Data',
      auth: 'No', status: 'alive', url: 'https://x.example/"onmouseover="alert(1)' },
    { ...base, name: 'Scheme Abuse', description: 'hostile scheme', category: 'Test Data',
      auth: 'No', status: 'alive', url: 'javascript:alert(1)' },
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

  // A hostile entry URL must not break out of the href attribute. Matched with
  // a leading space so this tests for a real attribute: the same text appears
  // harmlessly percent-encoded *inside* the href value, which is the fix
  // working, not the bug.
  assert.doesNotMatch(dom, /\sonmouseover=/i, 'entry URL escaped the href attribute');
  assert.match(dom, /href="https:\/\/x\.example\/%22onmouseover/, 'the quote should be percent-encoded, not dropped');
  // ...nor survive as an executable scheme.
  assert.doesNotMatch(dom, /href="javascript:/i, 'javascript: URL rendered as a link');

  assert.match(dom, /Usable One/, 'entry name missing');
  assert.match(dom, /HTTP 200 · 42ms/, 'alive detail line missing');
  assert.match(dom, /now redirects to https:\/\/elsewhere\.example\//, 'moved destination missing');
  assert.match(dom, /ENOTFOUND · last alive 2026-08-01/, 'dead detail line missing');
  assert.match(dom, /class="chip s-alive"[\s\S]*?>5</, 'status counts missing');

  // The honesty rule, asserted on the rendered page and not just in the data:
  // an untested entry must never render as a measured failure.
  // Asserted on the CORS cell specifically — an earlier version of this test
  // passed only because the fixture URL contained the word "unverified".
  const cellOf = (name) => tbody.split('<tr>').find((r) => r.includes(name))
    ?.match(/data-cors="([^"]*)"/)?.[1];
  assert.equal(cellOf('Untested One'), 'unverified', 'untestable entry should be marked unverified');
  assert.equal(cellOf('No Cors'), 'no', 'a measured absence should be marked no');
  assert.equal(cellOf('Usable One'), 'yes', 'a measured success should be marked yes');
  assert.match(dom, /All categories[\s\S]*?Animals[\s\S]*?Test Data[\s\S]*?Weather/, 'category options missing or unsorted');

  // A hostile entry name from upstream must not become markup.
  assert.match(dom, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, 'entry name was not escaped');
  assert.doesNotMatch(dom, /<script>alert\(1\)<\/script>/, 'entry name injected live markup');

  // The directory filter is URL-driven, which makes a filtered view shareable
  // and lets --dump-dom exercise it without clicking.
  const { stdout: filtered } = await promisify(execFile)(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--virtual-time-budget=8000', '--dump-dom', `${url}?usable=1`,
  ], { maxBuffer: 32 * 1024 * 1024 });

  const fbody = filtered.split('<tbody id="rows">')[1]?.split('</tbody>')[0] ?? '';
  const frows = fbody.match(/<tr>/g)?.length ?? 0;
  assert.equal(frows, 1, `usable filter should leave exactly 1 row, left ${frows}`);
  assert.match(fbody, /Usable One/, 'the usable entry should survive the filter');
  assert.doesNotMatch(fbody, /No Cors/, 'measured no-CORS should be filtered out');
  assert.doesNotMatch(fbody, /Untested One/, 'unverified should not count as usable');
  assert.doesNotMatch(fbody, /Moved One/, 'an entry needing a key is not usable');
  assert.doesNotMatch(fbody, /alert\(1\)/, 'a dead entry is not usable');

  // The row is sorted by the API's latency, so it must show that number and
  // not the docs page's — otherwise the list looks mis-sorted to the reader.
  assert.match(fbody, /55ms/, 'usable row should show the API latency');
  assert.doesNotMatch(fbody, /42ms/, 'usable row must not show the docs-page latency');

  console.log(`page test: ${rows} rows rendered, filter leaves ${frows}, all assertions passed`);
} finally {
  server.close();
}
