# TDD Evidence — Directory, Phases 1-4

**Source plan:** `.github/plans/api-directory.plan.md`, approved in canvas.

**Runner:** `node --test` (+ `--experimental-test-coverage`); page tests drive
headless Chrome via `--dump-dom`. No package manager in this repo.

## Task report

| Phase | RED | GREEN |
|:---|:---|:---|
| 1 — enrichment | `ERR_MODULE_NOT_FOUND enrich.mjs` | 16/16 |
| 2 — directory filter | `?usable=1` left all 5 fixture rows | 5 rows, filter leaves 1 |
| 3 — findings page | `ENOENT docs/findings.html` | 1 category bar, all stats derived |
| 4 — badges | `ERR_MODULE_NOT_FOUND badges.mjs` | 13/13 |

Totals: **98** unit/integration tests plus 2 browser page tests, all green and
all wired into CI.

## Measured outcomes

| | |
|:---|---:|
| Entries checked nightly | 1757 |
| Endpoints confirmed | 205 of 854 no-auth (24%) |
| Usable (alive + no auth + CORS verified) | 172, across 35 categories |
| CORS disagrees with upstream | 20 of 154 comparable (13%) |
| Upstream "Unknown", now measured | 51 |
| Badge endpoints published | 1754 (125KB) |

## Decisions that came from measurement, not taste

- **Status distribution is labelled rows, not a stacked bar.** The dataviz
  palette validator measured the site's own `alive`-green against
  `moved`-yellow at **CVD ΔE 5.1** on the `#0d1017` surface — below the floor.
  Adjacent in a stack they would be indistinguishable to a colourblind reader.
- **The diverging CORS pair uses `#3987e5`, not the site's `#58a6ff`**, which
  sits outside the dark lightness band.
- **Rot excludes categories under 15 entries**, and prints the sample size
  beside every percentage.
- **Nothing is reported dead yet.** That needs 3 consecutive failed nights and
  the history is younger, so the page states the rot figures are an upper
  bound and that all 286 failing entries are on first strikes.

## Bugs the cycle caught

1. **Rows sorted by API latency displayed docs-page latency.** BlazePhoenix
   sorted first at 35ms and rendered 117ms.
2. **A page assertion passed for a fake reason** — the fixture URL was
   `https://unverified.example/`, so `/unverified/i` matched regardless of what
   rendered. Renamed the host; asserted on the `data-cors` attribute.
3. **`--dump-dom` includes inline `<script>` source**, so the template literal
   `data-cat="${esc(r.cat)}"` counted as a rendered bar. The findings test was
   green while counting a bar that did not exist. Scripts are now stripped
   before any assertion.
4. **A label assertion compared category bars against every label on the
   page**, including the status rows it was not testing.

## Coverage and known gaps

```
extract.mjs  100.00 line / 84.00 branch
discover.mjs 100.00 line / 97.67 branch
```

- **Recall is 24%, against a 40% gate that failed.** Shipping anyway was an
  explicit user decision after the measurement, not a rationalisation of it.
  The plan's response was to use verification as a *filter* rather than a
  headline.
- **Extractor C (LLM) was dropped, not deferred** — measured as unable to
  reach the gate either.
- **YAML OpenAPI specs are not parsed.**
- **`enrich.mjs` `main()` and `check.mjs` `main()` have no direct tests**;
  their pure logic (`needsDiscovery`, `publishFields`, `writeBadges`) does.
