#!/usr/bin/env node
// The format-drift guard: it exists to fail the build loudly rather than
// silently publish an empty graveyard. It had no test until now.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseReadme, validateParse } from './parse.mjs';

const entries = (n, cats = 50) => Array.from({ length: n }, (_, i) => ({
  name: `e${i}`, category: `c${i % cats}`,
}));

describe('validateParse', () => {
  test('accepts a healthy parse', () => {
    assert.equal(validateParse(entries(1757, 51)).ok, true);
  });

  test('rejects a parse that lost most entries — upstream reformatted', () => {
    const r = validateParse(entries(40, 50));
    assert.equal(r.ok, false);
    assert.match(r.message, /40 entries/);
  });

  test('rejects a parse that lost its categories even when entry count holds', () => {
    const r = validateParse(entries(1757, 3));
    assert.equal(r.ok, false);
    assert.match(r.message, /categor/i);
  });

  test('rejects an empty parse rather than publishing nothing', () => {
    assert.equal(validateParse([]).ok, false);
  });

  test('the failure names both measured values, so CI output is actionable', () => {
    const r = validateParse(entries(10, 2));
    assert.match(r.message, /10/);
    assert.match(r.message, /2/);
  });
});

describe('parseReadme edge cases', () => {
  test('ignores a row whose name cell holds no link', () => {
    const md = ['### Animals', '| plain text | desc | No | Yes | Yes |'].join('\n');
    assert.deepEqual(parseReadme(md), []);
  });

  test('an entry before any heading is still captured', () => {
    const md = '| [Early](https://e.example/) | desc | No | Yes | Yes |';
    assert.equal(parseReadme(md)[0].category, 'Uncategorized');
  });

  test('empty auth defaults to No rather than empty string', () => {
    const md = ['### X', '| [A](https://a.example/) | d |  | Yes | Yes |'].join('\n');
    assert.equal(parseReadme(md)[0].auth, 'No');
  });

  test('strips a trailing comma or period from a URL', () => {
    const md = ['### X', '| [A](https://a.example/path.) | d | No | Yes | Yes |'].join('\n');
    assert.equal(parseReadme(md)[0].url, 'https://a.example/path');
  });

  test('handles an empty document without throwing', () => {
    assert.deepEqual(parseReadme(''), []);
  });
});
