#!/usr/bin/env node
// Phase 0 extractors: find where an API actually lives, rather than guessing
// URL shapes. The endpoint is written down in the docs — read it there.
const MAX_CANDIDATES = 6;

// Conventional spec locations, tried when the page does not name one.
const SPEC_PATHS = ['/openapi.json', '/swagger.json', '/v3/api-docs'];
const SPEC_FILE = /["'\s=(]((?:https?:\/\/|\/|\.\/)[^"'\s>)]*?(?:openapi|swagger)[^"'\s>)]*?\.json)/gi;

const CODE_BLOCK = /<(pre|code)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const URL_IN_TEXT = /https?:\/\/[^\s"'`<>\\]+/g;
const ASSET = /\.(png|jpe?g|gif|svg|ico|css|js|woff2?|ttf|pdf|zip)(\?|$)/i;
// Anything the docs left for the reader to fill in.
const PLACEHOLDER = /\{|\}|<[a-z_]+>|:[a-z_]+\b|YOUR[_-]?|API[_-]?KEY|xxxx|ACCESS[_-]?TOKEN/i;

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m]);

// example.com from api.docs.example.com — good enough to tell "this host
// belongs to the same project" from "this is a link to GitHub".
const registrable = (host) => host.replace(/^www\./, '').split('.').slice(-2).join('.');

function parse(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch { return null; }
}

function codeBlockText(html) {
  return [...String(html ?? '').matchAll(CODE_BLOCK)].map((m) => decode(m[2])).join('\n');
}

export function specCandidateUrls(docsUrl, html = '') {
  const base = parse(docsUrl);
  if (!base) return [];

  // A spec the page names beats a blind guess, so it goes first.
  const referenced = [...String(html).matchAll(SPEC_FILE)]
    .map((m) => { try { return new URL(m[1], docsUrl).href; } catch { return null; } })
    .filter(Boolean);

  return [...new Set([...referenced, ...SPEC_PATHS.map((p) => `${base.origin}${p}`)])].slice(0, MAX_CANDIDATES);
}

export function endpointsFromSpec(spec, specUrl) {
  if (!spec?.paths || typeof spec.paths !== 'object') return [];
  const specBase = parse(specUrl);
  if (!specBase) return [];

  let base;
  if (Array.isArray(spec.servers) && spec.servers[0]?.url) {
    base = spec.servers[0].url;
  } else if (spec.host) {
    // Swagger 2.0 spells the same thing as host + basePath + schemes.
    base = `${spec.schemes?.[0] ?? 'https'}://${spec.host}${spec.basePath ?? ''}`;
  } else {
    base = specBase.origin;
  }

  let baseUrl;
  try { baseUrl = new URL(base, specBase.origin); } catch { return []; }

  const paths = Object.entries(spec.paths)
    .filter(([, ops]) => ops && typeof ops === 'object' && 'get' in ops)
    .map(([path]) => path)
    // Paths needing a parameter we cannot invent go last, not away: a 4xx
    // rejection from one still proves the endpoint is live.
    .sort((a, b) => Number(PLACEHOLDER.test(a)) - Number(PLACEHOLDER.test(b)));

  const joined = paths.map((p) => `${baseUrl.href.replace(/\/$/, '')}/${p.replace(/^\//, '')}`);
  return [...new Set(joined)].slice(0, MAX_CANDIDATES);
}

export function urlsFromCodeBlocks(html, docsUrl) {
  const base = parse(docsUrl);
  if (!base) return [];
  const home = registrable(base.hostname);

  const found = (codeBlockText(html).match(URL_IN_TEXT) ?? [])
    // Trailing quotes, brackets and sentence punctuation are not part of the URL.
    .map((u) => u.replace(/["'`)\]}>,.;:]+$/, ''))
    .filter((u) => {
      const parsed = parse(u);
      return parsed && !ASSET.test(parsed.pathname) && registrable(parsed.hostname) === home;
    });

  const ranked = [...new Set(found)]
    .sort((a, b) => Number(PLACEHOLDER.test(a)) - Number(PLACEHOLDER.test(b)));
  return ranked.slice(0, MAX_CANDIDATES);
}

// Free gate in front of any model call: if no code block holds a URL, there is
// nothing to extract and a model could only invent one.
// Deliberately not URL_IN_TEXT: a /g regex carries lastIndex between .test()
// calls, and this runs once per entry across hundreds of entries.
export function hasUrlInCodeBlock(html) {
  return /https?:\/\/[^\s"'`<>\\]+/.test(codeBlockText(html));
}
