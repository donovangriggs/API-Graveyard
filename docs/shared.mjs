// Shared by index.html and findings.html.
//
// Both pages answer the same question about the same results.json, so the two
// definitions below get one home. "Usable" is the site's headline claim and
// was previously spelled out once per page; two copies of a claim drift.

// A bot wall on the docs site says nothing about the API, so blocked counts as
// working. 'unverified' is never usable — we did not test it.
const WORKS = new Set(['alive', 'moved', 'blocked']);

export const isUsable = (e) => WORKS.has(e.status) && e.auth === 'No' && e.verifiedCors === 'yes';

// Every field in results.json originates in a community-edited README, and
// endpoints are scraped from third-party docs pages, so all of it is
// third-party input.
export function esc(s) {
  return String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}
