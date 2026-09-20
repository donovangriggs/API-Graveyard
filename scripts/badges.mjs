#!/usr/bin/env node
// shields.io endpoint badges — one small JSON per entry.
// A badge URL ends up in someone else's README, so a slug must stay stable
// across runs: collisions are broken by a hash of the entry's own URL, never
// by its position in the list.
import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const COLORS = {
  alive: 'brightgreen',
  moved: 'yellow',
  blocked: 'blue',
  unknown: 'lightgrey',
  dead: 'red',
};

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 6);

const baseSlug = (name) => String(name ?? '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

// base slug -> sorted URLs of every entry sharing it. Built once per run:
// re-deriving it inside slugFor costs a full re-slug of all 1757 names per
// entry — measured at 425ms, against 0ms for one shared index.
export function nameIndex(all) {
  const index = new Map();
  for (const e of all) {
    const base = baseSlug(e.name);
    if (!base) continue;
    if (!index.has(base)) index.set(base, []);
    index.get(base).push(e.url);
  }
  for (const urls of index.values()) urls.sort();
  return index;
}

export function slugFor(entry, all = [], index = nameIndex(all)) {
  const base = baseSlug(entry.name);
  if (!base) return `api-${hash(entry.url)}`;

  // Only the first entry with a given name keeps the clean slug. "First" is
  // decided by URL order, not array order, so the answer does not depend on
  // how upstream happens to sort the README.
  const sameName = index.get(base) ?? [];
  if (sameName.length <= 1 || sameName[0] === entry.url) return base;
  return `${base}-${hash(entry.url)}`;
}

export function badgeFor(entry) {
  return {
    schemaVersion: 1,
    label: 'api',
    // Only ever advertise a measurement we actually made.
    message: entry.verifiedCors === 'yes' ? `${entry.status} · CORS` : entry.status,
    color: COLORS[entry.status] ?? 'lightgrey',
  };
}

export async function writeBadges(entries, dir) {
  await mkdir(dir, { recursive: true });
  const byName = nameIndex(entries);
  const index = {};
  await Promise.all(entries.map(async (entry) => {
    const slug = slugFor(entry, entries, byName);
    index[entry.url] = slug;
    await writeFile(join(dir, `${slug}.json`), JSON.stringify(badgeFor(entry)));
  }));
  return index;
}
