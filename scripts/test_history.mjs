#!/usr/bin/env node
// The strike logic is the only non-obvious thing here, so it is the only test.
import assert from 'node:assert/strict';
import { applyProbe, classify } from './check.mjs';
import { parseReadme } from './parse.mjs';

const run = (statuses) => statuses.reduce((s, st, i) => applyProbe(s, st, `2026-09-${10 + i}`), undefined);

// Two bad nights are not death.
assert.equal(run(['dead', 'dead']).status, 'unknown');

// Three consecutive are.
assert.equal(run(['dead', 'dead', 'dead']).status, 'dead');

// Recovery resets the count, so one flaky week cannot quietly stack up.
const recovered = run(['dead', 'dead', 'alive']);
assert.equal(recovered.status, 'alive');
assert.equal(recovered.strikes, 0);
assert.equal(recovered.lastSeenAlive, '2026-09-12');

// A bot wall is not a strike, however many nights it lasts.
const walled = run(['blocked', 'blocked', 'blocked', 'blocked']);
assert.equal(walled.status, 'blocked');
assert.equal(walled.strikes, 0);

// ...and it never contributes to a death sentence alongside real failures.
assert.equal(run(['dead', 'blocked', 'dead']).status, 'unknown');

// Timeouts are absence of evidence, not evidence of death.
assert.equal(classify({ errorCode: 'TIMEOUT' }), 'unknown');
assert.equal(classify({ errorCode: 'ENOTFOUND' }), 'dead');
assert.equal(classify({ httpStatus: 403 }), 'blocked');
assert.equal(classify({ httpStatus: 200, url: 'https://a.com/x', finalUrl: 'https://a.com/y' }), 'alive');
assert.equal(classify({ httpStatus: 200, url: 'https://a.com/x', finalUrl: 'https://www.a.com/x' }), 'alive');
assert.equal(classify({ httpStatus: 200, url: 'https://a.com/x', finalUrl: 'https://sold.example/x' }), 'moved');

// History stays bounded so the nightly commit cannot grow without limit.
const long = Array.from({ length: 40 }, () => 'alive');
assert.equal(run(long).recent.length, 30);

// Parser sanity on the exact upstream row shape.
const rows = parseReadme([
  '### Animals',
  '| API | Description | Auth | HTTPS | CORS |',
  '|:---|:---|:---|:---|:---|',
  '| [Cats](https://docs.thecatapi.com/) | Pictures of cats | `apiKey` | Yes | No |',
  '## APILayer APIs',
  '| [IPstack](https://ipstack.com/) | Locate visitors | [Run](https://x.com) |',
].join('\n'));
assert.equal(rows.length, 1, 'three-column promo tables must not be treated as entries');
assert.deepEqual(rows[0], {
  name: 'Cats', url: 'https://docs.thecatapi.com/', description: 'Pictures of cats',
  category: 'Animals', auth: 'apiKey', https: 'Yes', cors: 'No',
});

console.log('all assertions passed');
