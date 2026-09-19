#!/usr/bin/env node
// Badge endpoints, shields.io schema. Written before scripts/badges.mjs exists.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slugFor, badgeFor, writeBadges } from './badges.mjs';

const entry = (over = {}) => ({
  name: 'Cat Facts', url: 'https://catfact.ninja/', status: 'alive', auth: 'No',
  verifiedCors: 'unverified', ...over,
});

describe('slugFor', () => {
  test('lowercases and hyphenates a name', () => {
    assert.equal(slugFor(entry({ name: 'Cat Facts' }), []), 'cat-facts');
  });

  test('strips punctuation that would break a URL', () => {
    assert.equal(slugFor(entry({ name: 'Bhagavad Gita (telugu)!' }), []), 'bhagavad-gita-telugu');
  });

  test('collapses runs and trims stray hyphens', () => {
    assert.equal(slugFor(entry({ name: '  Foo --- Bar  ' }), []), 'foo-bar');
  });

  // The list genuinely contains two entries called "Dog Facts".
  test('disambiguates a duplicate name without renaming the first', () => {
    const a = entry({ name: 'Dog Facts', url: 'https://one.example/' });
    const b = entry({ name: 'Dog Facts', url: 'https://two.example/' });
    const slugA = slugFor(a, [a, b]);
    const slugB = slugFor(b, [a, b]);
    assert.equal(slugA, 'dog-facts');
    assert.notEqual(slugB, slugA);
    assert.match(slugB, /^dog-facts-[0-9a-f]{6}$/);
  });

  test('a slug is stable across runs — a badge URL in someone else README must not rot', () => {
    const a = entry({ name: 'Dog Facts', url: 'https://one.example/' });
    const b = entry({ name: 'Dog Facts', url: 'https://two.example/' });
    // Same inputs in a different order must yield the same slug per entry.
    assert.equal(slugFor(b, [a, b]), slugFor(b, [b, a].reverse()));
  });

  test('falls back to a hash when a name has no usable characters', () => {
    assert.match(slugFor(entry({ name: '!!!' }), []), /^api-[0-9a-f]{6}$/);
  });
});

describe('badgeFor — the shields.io endpoint schema', () => {
  test('emits the required schema fields', () => {
    const b = badgeFor(entry());
    assert.equal(b.schemaVersion, 1);
    assert.equal(b.label, 'api');
    assert.equal(typeof b.message, 'string');
    assert.equal(typeof b.color, 'string');
  });

  test('colour follows status', () => {
    assert.equal(badgeFor(entry({ status: 'alive' })).color, 'brightgreen');
    assert.equal(badgeFor(entry({ status: 'dead' })).color, 'red');
    assert.equal(badgeFor(entry({ status: 'blocked' })).color, 'blue');
    assert.equal(badgeFor(entry({ status: 'moved' })).color, 'yellow');
    assert.equal(badgeFor(entry({ status: 'unknown' })).color, 'lightgrey');
  });

  test('says blocked rather than implying death', () => {
    assert.equal(badgeFor(entry({ status: 'blocked' })).message, 'blocked');
  });

  test('advertises verified CORS when we measured it', () => {
    assert.equal(badgeFor(entry({ status: 'alive', verifiedCors: 'yes' })).message, 'alive · CORS');
  });

  test('never advertises CORS we did not measure', () => {
    assert.equal(badgeFor(entry({ status: 'alive', verifiedCors: 'unverified' })).message, 'alive');
    assert.equal(badgeFor(entry({ status: 'alive', verifiedCors: 'no' })).message, 'alive');
  });
});

describe('writeBadges', () => {
  test('writes one file per entry, named by slug', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'badges-'));
    const entries = [entry({ name: 'Cat Facts' }), entry({ name: 'Dog Facts', url: 'https://d.example/' })];
    await writeBadges(entries, dir);

    const files = (await readdir(dir)).sort();
    assert.deepEqual(files, ['cat-facts.json', 'dog-facts.json']);
    const badge = JSON.parse(await readFile(join(dir, 'cat-facts.json'), 'utf8'));
    assert.equal(badge.schemaVersion, 1);
    assert.equal(badge.message, 'alive');
  });

  test('returns the slug index so the site can link to each badge', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'badges-'));
    const index = await writeBadges([entry({ name: 'Cat Facts' })], dir);
    assert.equal(index['https://catfact.ninja/'], 'cat-facts');
  });
});
