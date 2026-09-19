# TDD Evidence — v2 Endpoint Discovery

**Source plan:** `.claude/plans/api-graveyard.plan.md` (Later -> v2). Journeys
below were written during this TDD run; the plan named the capability, not the
acceptance criteria.

**Runner:** no `package.json` or package manager in this repo. Tests are Node's
built-in runner: `node --test scripts/test_discover.mjs`, coverage via
`node --test --experimental-test-coverage`.

## User journeys

1. As a visitor, I want to know whether the API itself responds, not just
   whether its documentation page loads — v1 reports Kraken as a 404 because
   `docs.kraken.com/rest/` is gone, while `api.kraken.com` is healthy.
2. As a visitor, I want to know whether I can call it from a browser, because
   upstream's CORS column is self-reported and frequently wrong.
3. As a maintainer, I never want a claimed endpoint that was not confirmed to
   return JSON.

## Task report

| Task | Summary | Validation command | Result |
|:---|:---|:---|:---|
| Write failing tests | 26 tests over candidates, CORS, JSON detection, verification, discovery loop | `node --test scripts/test_discover.mjs` | **RED** — `ERR_MODULE_NOT_FOUND: scripts/discover.mjs` |
| Implement | 91-line module, zero dependencies | `node --test scripts/test_discover.mjs` | **GREEN** — 26 pass / 0 fail |
| Coverage | | `node --test --experimental-test-coverage scripts/test_discover.mjs` | 100% lines, 97.22% branches, 100% functions |

RED excerpt:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../scripts/discover.mjs'
  imported from .../scripts/test_discover.mjs
```

GREEN excerpt:

```
ℹ tests 26   ℹ pass 26   ℹ fail 0   ℹ duration_ms 97.4
```

**A test earned its keep during the cycle:** `accepts json vendor subtypes`
failed on first implementation because the content-type regex used `\w+`, which
does not match the dot in `application/vnd.api+json`. Widened to `[\w.\-]+`
before GREEN. Without that test, every JSON:API endpoint would have been
silently classified as undiscovered.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | The listed URL is always tried first, unmodified | `candidateEndpoints:tries the listed URL first` | unit | PASS |
| 2 | `docs.`/`developer.`/`developers.`/`www.` hosts yield an `api.` candidate | `swaps a docs host for an api host`, `swaps developer/developers/www hosts too` | unit | PASS |
| 3 | A bare host gets `/api` and `/api/v1` appended | `appends conventional api paths` | unit | PASS |
| 4 | A path already shaped like an endpoint is not mangled | `keeps a path that already looks like an endpoint` | unit | PASS |
| 5 | Candidates are deduped and capped at 6 per entry | `never repeats a candidate`, `stays small` | unit | PASS |
| 6 | Unparseable URLs and non-http schemes yield no candidates | `yields nothing for a URL that cannot be parsed`, `refuses non-http schemes` | unit | PASS |
| 7 | CORS is `yes` only for `*` or our echoed origin | 4 `corsFrom` tests | unit | PASS |
| 8 | An explicit content-type is authoritative in both directions | 5 `looksLikeJson` tests | unit | PASS |
| 9 | A confirmed endpoint reports CORS, latency and HTTP status | `confirms a JSON endpoint` | integration | PASS |
| 10 | HTML pages and 5xx responses are never confirmed | `an HTML page...`, `a 5xx is not an endpoint` | integration | PASS |
| 11 | Connection failures are reported, never thrown | `a connection failure is reported, not thrown` | integration | PASS |
| 12 | Discovery skips the docs page and finds the JSON candidate | `skips the docs page...` | integration | PASS |
| 13 | Nothing is claimed when no candidate returned JSON | `never claims an endpoint...` | integration | PASS |
| 14 | Probing stops at the first confirmation | `stops probing as soon as one candidate is confirmed` | integration | PASS |

## Coverage and known gaps

```
scripts/discover.mjs | 100.00 line | 97.22 branch | 100.00 funcs
```

Intentional gaps:

- **Not yet wired into the nightly run.** `discover.mjs` is tested but no
  caller exists; `check.mjs` still publishes v1 link health only.
- **Heuristic recall is unmeasured.** The tests prove the candidate rules
  behave as specified; they do not prove those rules find endpoints for a good
  share of the real 849 no-auth entries. That needs a measured sample run.
- **v1 modules predate this workflow.** `test_history.mjs` and `test_page.mjs`
  are assert scripts written after their implementations, and are not counted
  in the coverage figure above.
