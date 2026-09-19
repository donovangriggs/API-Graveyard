#!/usr/bin/env node
// README.md -> entries.json
// Source of truth is upstream's markdown tables. Entry rows are the 5-column
// ones; the APILayer promo tables are 3-column and fall out for free.
import { writeFile, readFile } from 'node:fs/promises';

const README_URL = 'https://raw.githubusercontent.com/public-apis/public-apis/master/README.md';

// Upstream format drift should break the build loudly, not silently publish an
// empty graveyard. Measured 2026-09: 1758 entries, 52 categories.
const MIN_ENTRIES = 1700;
const MIN_CATEGORIES = 50;

const LINK = /\[([^\]]+)\]\(\s*([^)\s]+)/;

export function parseReadme(md) {
  const entries = [];
  let category = 'Uncategorized';

  for (const line of md.split('\n')) {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading) { category = heading[1]; continue; }

    if (!line.startsWith('|')) continue;
    const cols = line.split('|');
    if (cols.length !== 7) continue;

    const [, name, description, auth, https, cors] = cols.map((c) => c.trim());
    if (!name || name === 'API' || /^:?-+:?$/.test(name)) continue;

    const link = name.match(LINK);
    if (!link) continue;

    entries.push({
      name: link[1].trim(),
      url: link[2].replace(/[.,]+$/, ''),
      description,
      category,
      auth: auth.replace(/`/g, '') || 'No',
      https,
      cors,
    });
  }
  return entries;
}

// Upstream reformatting the README must fail the build loudly. Kept separate
// from main() so the guard itself can be exercised without a network fetch.
export function validateParse(entries) {
  const categories = new Set(entries.map((e) => e.category));
  if (entries.length >= MIN_ENTRIES && categories.size >= MIN_CATEGORIES) return { ok: true };
  return {
    ok: false,
    message: `parse: got ${entries.length} entries / ${categories.size} categories, ` +
      `expected >=${MIN_ENTRIES} / >=${MIN_CATEGORIES}. Upstream format likely changed.`,
  };
}

async function main() {
  const local = process.argv[2];
  const md = local
    ? await readFile(local, 'utf8')
    : await fetch(README_URL).then((r) => {
        if (!r.ok) throw new Error(`README fetch failed: ${r.status}`);
        return r.text();
      });

  const entries = parseReadme(md);
  const check = validateParse(entries);
  if (!check.ok) {
    console.error(check.message);
    process.exit(1);
  }

  await writeFile('entries.json', JSON.stringify(entries, null, 2));
  console.log(`parse: ${entries.length} entries, ${new Set(entries.map((e) => e.category)).size} categories`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
