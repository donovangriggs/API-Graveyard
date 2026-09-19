# TDD Evidence — Code Review Follow-ups

**Source:** findings from `/code-review` of the session's committed work.
Journeys written during this run; no plan file.

**Runner:** `node --test`; page tests render in headless Chrome via `--dump-dom`.

## User journeys

1. As someone filtering for "works from a browser", I want to see the endpoint
   that was verified, so I can copy it and call it.
2. As a screen-reader user, I want the CORS split bar's content as text rather
   than colour alone.

## Task report

| Finding | RED | GREEN |
|:---|:---|:---|
| MEDIUM — endpoint never shown | `confirmed endpoint should be shown` | 8 rows, filter leaves 2 |
| LOW — split bar is sight-only | `split bar should expose itself as an image` | 1 category bar, all stats derived |

## Test specification

| # | What is guaranteed | Test | Result |
|---|---|---|---|
| 1 | A confirmed entry renders its endpoint in a selectable element | `page test: class="endpoint"` | PASS |
| 2 | An entry with no confirmed endpoint renders none | `page test: Untested One` | PASS |
| 3 | A scraped endpoint cannot inject markup | `page test: <img src=x onerror=` | PASS |
| 4 | The CORS bar exposes `role="img"` and an aria-label carrying real counts | `findings test: split bar` | PASS |
| 5 | A row with an endpoint never shows the docs-page latency | `page test: 42ms` | PASS |

## A bug the fixtures exposed

The hostile-endpoint fixture had an `endpoint` but no `apiLatencyMs`, and the
row fell back to printing the **docs page's** latency — in a list sorted by API
latency. Same class as the mis-sorted display fixed earlier, reached by a
different path. `detail()` now prints nothing rather than the wrong
measurement.

Two test assertions also had to be sharpened rather than the code changed:

- `doesNotMatch(fbody, /alert\(1\)/)` identified the dead entry by a string
  that now also appears, safely escaped, inside the hostile-endpoint row.
  Re-anchored on the entry's URL.
- The usable-filter count moved 1 -> 2 because the new fixture is itself
  alive, keyless and CORS-verified, so it genuinely belongs in the filtered
  set.

## Not fixed, deliberately

- **`console.log` in `scripts/`.** These are CLI programs; their output is the
  product. Routing it through a logger would add indirection and remove the
  thing a maintainer reads in the Actions log.
- **Mutation of `history` / `cache` / `results`.** Intentional, documented, and
  covered by `pruneToEntries` and `applyProbe` tests. Converting to immutable
  copies would rewrite three call sites to satisfy a style rule, not a defect.

Both were raised by the review checklist; neither is a defect, and changing
them would make the code worse. Recorded here rather than silently skipped.

## Coverage

```
all files | 94.69 line | 95.25 branch | 98.29 funcs
```

120 node:test assertions plus both browser page tests, unchanged by this work.
