# TDD Evidence — Phase 0 Extractors

**Source plan:** `.github/plans/api-graveyard-v2.plan.md` (Three extractors,
Phase 0). Journeys reused from that plan; none invented here.

**Runner:** `node --test`, coverage via `node --test --experimental-test-coverage`.
No `package.json` or package manager in this repo.

**Deviation from the plan, recorded rather than silent:** the plan specifies
Phase 0 as "throwaway quality, measure recall". This cycle built it test-first
instead, at the user's direction. The recall measurement remains the gate and
has **not** been run yet — see Known gaps.

## User journeys (from the plan)

1. As a visitor, I want to know whether the API itself responds, not just
   whether its documentation page loads.
2. As a visitor, I want to know whether I can call it from a browser.
3. As a maintainer, I never want a claimed endpoint that was not confirmed.

## Task report

| Task | Summary | Validation command | Result |
|:---|:---|:---|:---|
| Write failing tests | 30 extractor tests + 5 new 4xx cases | `node --test scripts/test_extract.mjs` | **RED** — `ERR_MODULE_NOT_FOUND: scripts/extract.mjs` |
| | | `node --test scripts/test_discover.mjs` | **RED** — 31 tests, 28 pass, **3 fail** (exactly the new 4xx/`confirmedBy` behaviour) |
| Implement A, B, prefilter, 4xx rule | `extract.mjs` (4 exports) + `verifyEndpoint` change | `node --test scripts/test_extract.mjs scripts/test_discover.mjs` | **GREEN** — 61 pass / 0 fail |
| Regression check | v1 suites unaffected | `node scripts/test_history.mjs && node scripts/test_page.mjs` | PASS |
| Coverage | | `node --test --experimental-test-coverage` | `extract.mjs` 100% line / 82.98% branch; `discover.mjs` 100% / 97.67% |

### A bug the cycle caught in its own implementation

`hasUrlInCodeBlock` was written as `URL_IN_TEXT.test(codeBlockText(html).replace(URL_IN_TEXT, m => m))`.
It passed every test — but only because `String.replace` with a `/g` regex
resets `lastIndex`, masking the fact that `.test()` on a `/g` regex is
stateful. A later "simplification" removing the pointless `.replace()` would
have made the function return alternating answers across entries.

Rather than just fix it, the gap in the tests was closed first:

1. Added `gives the same answer when called repeatedly`.
2. Replaced the implementation with the naive `/g` version to confirm the test
   fails against it: **30 tests, 29 pass, 1 fail**.
3. Restored, then refactored to a non-global regex so correctness comes from
   the code rather than a side effect.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Conventional spec locations are probed on the origin | `specCandidateUrls:probes the conventional spec locations` | unit | PASS |
| 2 | A spec the page names is found and tried **first** | `finds a spec referenced by the docs page itself`, `a page-referenced spec is tried before the blind guesses` | unit | PASS |
| 3 | Relative spec refs resolve against the docs URL, not the origin | `resolves a relative spec reference` | unit | PASS |
| 4 | A spec hosted on a CDN is still accepted | `accepts an absolute spec reference on another host` | unit | PASS |
| 5 | OpenAPI 3 `servers[]` is joined with paths | `joins the server URL with a path` | unit | PASS |
| 6 | Swagger 2.0 `host`+`basePath`+`schemes` is understood | `understands Swagger 2.0 host + basePath` | unit | PASS |
| 7 | Parameterless GET paths are offered before parameterised ones | `prefers callable paths over ones needing a parameter` | unit | PASS |
| 8 | Non-GET paths are never offered | `ignores paths with no GET` | unit | PASS |
| 9 | Non-spec JSON and `null` yield nothing | `returns nothing for JSON that is not a spec` | unit | PASS |
| 10 | Candidate lists stay bounded (<= 6) even on a 200-path spec | `stays bounded on a huge spec`, `dedupes and caps at 6` | unit | PASS |
| 11 | URLs are taken from `<pre>`/`<code>` only, never prose | `pulls the URL out of a curl example`, `ignores URLs in prose` | unit | PASS |
| 12 | HTML entities decoded; trailing punctuation and quotes stripped | `decodes HTML entities`, `strips trailing punctuation and quotes` | unit | PASS |
| 13 | Same registrable domain and `api.` subdomains kept; repo/social links and assets dropped | `keeps same-domain...`, `drops unrelated hosts`, `drops asset URLs` | unit | PASS |
| 14 | Placeholder-free URLs rank first, but placeholders are not discarded | `ranks a callable URL above...`, `still offers a placeholder URL when nothing cleaner exists` | unit | PASS |
| 15 | The free prefilter is correct and **stateless across calls** | 4 `hasUrlInCodeBlock` tests | unit | PASS |
| 16 | A JSON-shaped 400/401 confirms a live endpoint | `a JSON-shaped 4xx rejection confirms`, `a 401 asking for a key also confirms` | integration | PASS |
| 17 | A JSON **404** does not confirm — it says the path is wrong | `a JSON 404 does not confirm` | integration | PASS |
| 18 | A 4xx with an HTML body confirms nothing | `a 4xx with an HTML body confirms nothing` | integration | PASS |
| 19 | Confirmations are labelled `success` vs `rejection` | `a 2xx success is labelled as such` | integration | PASS |

## Coverage and known gaps

```
scripts/extract.mjs  | 100.00 line | 82.98 branch | 100.00 funcs
scripts/discover.mjs | 100.00 line | 97.67 branch | 100.00 funcs
```

- **The Phase 0 gate has not been run.** These tests prove the extractors
  behave as specified against fixtures. They say nothing about recall on real
  docs pages — which is exactly the mistake that produced the 2% result last
  time. The 50-entry measurement is the next step and decides whether Phases
  1-3 happen at all.
- **No network test of Extractor A end to end.** Spec fetching is not yet
  wired to `discover()`; only the pure parsing is covered.
- **YAML specs are not parsed.** `/openapi.yaml` is common and would need a
  parser or a dependency. Deliberately out of scope for Phase 0; if the
  measurement shows YAML-only specs are a large slice, revisit.
- **`extract.mjs` has no production caller yet** — same status as
  `discover.mjs`, by design until the gate passes.
