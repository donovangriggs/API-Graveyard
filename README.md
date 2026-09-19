# API Graveyard

Nightly link health for all 1,757 entries in
[public-apis/public-apis](https://github.com/public-apis/public-apis).

**[View the results →](https://donovangriggs.github.io/API-Graveyard/)**

## What it measures

The URLs in that list are documentation and homepage links, not API endpoints.
So this measures whether the *listing* still resolves — which is enough to find
the hundreds of entries pointing at dead domains, expired certs and 404s.

Five statuses, because collapsing to alive/dead is how link checkers earn their
reputation for being wrong:

| Status | Meaning |
|:---|:---|
| `alive` | 2xx |
| `moved` | 2xx after redirecting to a different host — the entry is stale |
| `blocked` | 401/403/429. A bot wall, **not** a death |
| `dead` | DNS failure, refused connection, expired cert, 404/410, 5xx — for 3 consecutive nights |
| `unknown` | Timeout, or fewer than 3 strikes so far |

An entry needs **3 consecutive failed nights** before it is called dead, and any
single success resets the count. One flaky night must never publish a graveyard.

## Run it

```bash
node scripts/test_history.mjs   # strike logic + parser
node scripts/parse.mjs          # upstream README -> entries.json
node scripts/check.mjs          # -> docs/results.json, history.json
```

Node 22+, no dependencies. A full run is ~5 minutes at concurrency 20, one
request per URL per day.

## Layout

| Path | |
|:---|:---|
| `scripts/parse.mjs` | Parses the upstream README's 5-column tables |
| `scripts/check.mjs` | Probes every URL, applies the strike rule |
| `scripts/test_history.mjs` | The tests |
| `docs/index.html` | The page (GitHub Pages: serve from `main` `/docs`) |
| `history.json` | Rolling 30-day state — committed, it *is* the memory |

## Roadmap

- **v2** — real endpoint discovery for the 849 no-auth entries: call them,
  validate JSON, measure p50 latency, and verify CORS for real by sending an
  `Origin` header. The upstream CORS column is self-reported and often wrong.
- **PR bot** — open PRs upstream removing entries dead for 30 straight days,
  with the evidence linked.
