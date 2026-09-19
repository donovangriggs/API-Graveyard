#!/usr/bin/env node
// Phase 0 extractors: find where an API actually lives, rather than guessing
// URL shapes. The endpoint is written down in the docs — read it there.
const MAX_CANDIDATES = 6;

// Conventional spec locations, tried when the page does not name one.
const SPEC_PATHS = ['/openapi.json', '/swagger.json', '/spec.json', '/v3/api-docs'];
// Any .json whose name says openapi/swagger...
const SPEC_FILE = /["'\s=(]((?:https?:\/\/|\/|\.\/)[^"'\s>)]*?(?:openapi|swagger)[^"'\s>)]*?\.json)/gi;
// ...plus the two places a viewer names its spec outright, whatever the
// filename: Redoc's spec-url attribute and Swagger UI's url: config. httpbin
// serves /spec.json this way, which the filename rule alone never finds.
const SPEC_DECLARED = /(?:spec-url\s*=\s*|\burl\s*:\s*)["']((?:https?:\/\/|\/|\.\/)[^"'\s>]+\.json)["']/gi;

const CODE_BLOCK = /<(pre|code)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const URL_IN_TEXT = /https?:\/\/[^\s"'`<>\\]+/g;
const ASSET = /\.(png|jpe?g|gif|svg|ico|css|js|woff2?|ttf|pdf|zip)(\?|$)/i;
// Anything the docs left for the reader to fill in.
const PLACEHOLDER = /\{|\}|<[a-z_]+>|:[a-z_]+\b|YOUR[_-]?|API[_-]?KEY|xxxx|ACCESS[_-]?TOKEN/i;

// When the listed URL is a repo page, the API is on some other host by
// definition, so the same-domain rule below would discard every curl example
// in the README. These pages get the inverse treatment: allow any host except
// the noise a README is full of.
const REPO_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org', 'sourceforge.net']);
const README_NOISE = /(^|\.)(github\.com|githubusercontent\.com|gitlab\.com|bitbucket\.org|shields\.io|travis-ci\.(org|com)|circleci\.com|codecov\.io|coveralls\.io|badgen\.net|twitter\.com|x\.com|linkedin\.com|facebook\.com|youtube\.com|npmjs\.com|pypi\.org|opensource\.org|licenses\.nuget\.org|paypal\.(me|com)|ko-fi\.com|buymeacoffee\.com)$/i;

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
  const referenced = [...String(html).matchAll(SPEC_FILE), ...String(html).matchAll(SPEC_DECLARED)]
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

  const fromRepo = REPO_HOSTS.has(registrable(base.hostname));

  const found = (codeBlockText(html).match(URL_IN_TEXT) ?? [])
    // Trailing quotes, brackets and sentence punctuation are not part of the URL.
    .map((u) => u.replace(/["'`)\]}>,.;:]+$/, ''))
    .filter((u) => {
      const parsed = parse(u);
      if (!parsed || ASSET.test(parsed.pathname)) return false;
      return fromRepo
        ? !README_NOISE.test(parsed.hostname)
        : registrable(parsed.hostname) === home;
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
