#!/usr/bin/env node
// Findings page. Every number must be computed from results.json at render
// time — a hand-written statistic goes stale the first night the job runs.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';

const CHROMES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
].filter(Boolean);

const row = (over) => ({
  name: 'x', description: '', category: 'Animals', auth: 'No', status: 'alive',
  strikes: 0, httpStatus: 200, errorCode: null, latencyMs: 10, lastSeenAlive: '2026-09-19',
  redirectedTo: null, endpoint: null, apiLatencyMs: null, verifiedCors: 'unverified',
  claimedCors: 'Unknown', corsDisagrees: false, url: 'https://x.example/', ...over,
});

// 10 entries: 4 dead/unknown in Crypto (50% rot of 8), 2 moved, 3 disagreements.
const FIXTURE = {
  generatedAt: '2026-09-19T00:00:00.000Z',
  counts: { alive: 4, moved: 2, blocked: 1, unknown: 2, dead: 1 },
  entries: [
    ...Array.from({ length: 4 }, (_, i) => row({ name: `crypto-ok-${i}`, category: 'Cryptocurrency' })),
    ...Array.from({ length: 3 }, (_, i) => row({ name: `crypto-bad-${i}`, category: 'Cryptocurrency', status: 'unknown', errorCode: 'ENOTFOUND' })),
    row({ name: 'crypto-dead', category: 'Cryptocurrency', status: 'dead', errorCode: 'ENOTFOUND' }),
    row({ name: 'moved-a', category: 'Weather', status: 'moved', redirectedTo: 'https://elsewhere.example/' }),
    row({ name: 'moved-b', category: 'Weather', status: 'moved', redirectedTo: 'https://elsewhere.example/' }),
    // CORS: 2 overclaims (README Yes, measured no), 1 underclaim, 1 agreement, 1 newly known.
    row({ name: 'over-1', verifiedCors: 'no', claimedCors: 'Yes', corsDisagrees: true, endpoint: 'https://a/' }),
    row({ name: 'over-2', verifiedCors: 'no', claimedCors: 'Yes', corsDisagrees: true, endpoint: 'https://b/' }),
    row({ name: 'under-1', verifiedCors: 'yes', claimedCors: 'No', corsDisagrees: true, endpoint: 'https://c/' }),
    row({ name: 'agree-1', verifiedCors: 'yes', claimedCors: 'Yes', corsDisagrees: false, endpoint: 'https://d/' }),
    row({ name: 'newly-known', verifiedCors: 'yes', claimedCors: 'Unknown', corsDisagrees: false, endpoint: 'https://e/' }),
  ],
};

const chrome = CHROMES.find((p) => existsSync(p));
if (!chrome) {
  const msg = 'no Chrome found (set CHROME_PATH)';
  if (process.env.REQUIRE_BROWSER) { console.error(`findings test: ${msg}`); process.exit(1); }
  console.log(`findings test: SKIPPED — ${msg}`);
  process.exit(0);
}

const page = await readFile('docs/findings.html', 'utf8');
const server = createServer((req, res) => {
  if (req.url.startsWith('/results.json')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(FIXTURE));
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(page);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/findings.html`;

try {
  const { stdout: dom } = await promisify(execFile)(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--virtual-time-budget=8000', '--dump-dom', url,
  ], { maxBuffer: 32 * 1024 * 1024 });

  const stat = (key) => dom.match(new RegExp(`data-stat="${key}"[^>]*>([^<]*)<`))?.[1]?.trim();

  // Headline counts, all derived from the fixture.
  assert.equal(stat('total'), '15', 'total entries');
  assert.equal(stat('moved'), '2', 'moved count');
  assert.equal(stat('unresolved'), '4', 'domains that no longer resolve (ENOTFOUND)');

  // CORS: 3 of 4 comparable disagree; the Unknown one is not comparable.
  assert.equal(stat('cors-comparable'), '4', 'comparable = measured AND README said Yes/No');
  assert.equal(stat('cors-disagree'), '3', 'disagreement count');
  assert.equal(stat('cors-overclaim'), '2', 'README said Yes but measured no');
  assert.equal(stat('cors-underclaim'), '1', 'README said No but measured yes');
  assert.equal(stat('cors-newly-known'), '1', 'README said Unknown, now measured');

  // Rot by category: Cryptocurrency is 4 broken of 8 = 50%.
  const crypto = dom.match(/data-cat="Cryptocurrency"[^>]*data-pct="([^"]+)"/)?.[1];
  assert.equal(crypto, '50', 'Cryptocurrency rot percentage');

  // A chart must not invent precision the sample cannot support.
  assert.match(dom, /data-cat="Cryptocurrency"[^>]*data-n="8"/, 'sample size must be published beside the percentage');

  // Every bar is labelled, so colour never carries the meaning alone.
  const bars = [...dom.matchAll(/data-cat="([^"]+)"/g)].length;
  const labels = [...dom.matchAll(/class="bar-label"/g)].length;
  assert.equal(bars, labels, 'every bar needs a visible label');

  assert.doesNotMatch(dom, /\b13%\b/, 'no hand-written statistic from the real dataset may appear');

  console.log(`findings test: ${bars} category bars, all statistics derived from results.json`);
} finally {
  server.close();
}
