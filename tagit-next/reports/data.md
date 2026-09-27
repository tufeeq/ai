# Data agent report: live numbers you can check (2026-09-27)

Role: market data. Branches: `claude/agent-data` (frontend and audit tooling) and
`claude/agent-data-backend` (quote service, based on `tagit-next-independent-20260914`; `scanner.mjs` untouched).
Cost: zero. Every source used is free: Nasdaq.com's unofficial endpoints, the Alpaca free plan (IEX, plus SIP data that is at least 16 minutes old) and GitHub Actions.

## Measured (run 36309586246 and run 36310386929, from GitHub runners; universe = 823 Nasdaq names under $100M)

These runs were made on a Sunday, so the freshness numbers come from Friday 2026-09-25's minute bars (part D).
Per minute from 09:45 to 16:00 ET, this is the median number of symbols that actually printed:

| window | SIP (every venue) | IEX only | IEX share |
|---|---|---|---|
| last 1 min | 213 | 30 | 14% |
| last 2 min | 302 | 50 | 17% |
| last 5 min | 446 | 93 | 21% |
| last 15 min | 620 | 178 | 29% |

Other results:
- Over the whole session, 821 of 823 symbols had SIP bars, but only 644 had any IEX bar.
- An IEX-only feed therefore misses about 86% of the names that are trading at any given minute. This explains why the live detector saw almost nothing.
- **Previous close from IEX versus SIP (2026-09-24, 823 names):** the median absolute difference is 0.87%, and the 90th percentile is 4.6%.
  - 368 names (45%) are off by more than 1%.
  - 67 names are off by more than 5%.
  - The frozen scanner computes day change on `feed=iex` closes, which is wrong for these names. The frontend now uses SIP closes instead.
- **Nasdaq.com watchlist versus SIP (2026-09-25 close):**
  - Last price matches the SIP close for 658 of 660 names (only 2 differ by more than 0.5%).
  - Change differs by 0.002 pp at the median.
  - Previous close matches for 660 of 660 names (none off by more than 0.5%).
- **Nasdaq.com endpoints:**
  - The single-symbol `info` endpoint answered 30 of 30 requests (median 2.1 s).
  - The `watchlist` batch endpoint returns at most 20 symbols per request; a request for 100 symbols gets a 404.
  - One pass over the universe took 33 requests in 69 s and priced 660 of 823 names. The other 163 have no Nasdaq.com quote (mostly thin names or names that are not Nasdaq.com "stocks").
  - A burst of 99 requests over 235 s (25 requests per minute) drew no 403 or 429.
  - At that rate the whole universe refreshes in about 80 s.
- **Deployed service (Sunday):**
  - `/api/health` answered in 23 s (cold start).
  - `/api/scanner` returned 503.
  - `/api/live` returned 404, because it has not been deployed yet.
  - The published page showed "مرجع الشركات يحتاج تحديثًا" (the company reference needs a server update) and 429s from the relay. It rendered no rows, so its data could not be checked today.

## Before / after (coverage of consolidated, timely prices)

| | before | after, frontend only (now) | after the Render redeploy |
|---|---|---|---|
| consolidated real-time price | top 20 overlay | top 20 overlay | the whole universe, rotating (≈660 priced, full cycle ≈80–100 s; viewed symbols ≤15 s) |
| IEX price | ≈30/823 fresh per minute | same, marked by source and age | same, used only when it is newer |
| delayed consolidated context | none per row | every symbol scanned via the SIP scan (≥16 min, marked «متأخر» (delayed)) | the service also sends it per row |
| previous close for % change | IEX in the scanner (45% off by >1%) | SIP, split-adjusted, for the session before the price's own session (all universe names, 9 relay calls a day, cached) | SIP from the server as well |
| stale prices | green/yellow dot only | a source tag on every price; stale, aging and delayed prices are dimmed and labeled; the KPI counts only current prices | same |

**Still unmeasured: in-session live freshness.** Part E of the audit measures it: it fetches Nasdaq.com quotes, waits 17 minutes, then checks them against SIP bars. It only runs during market hours. See the owner actions below.

## What changed

Frontend (`claude/agent-data`):
- `src/core/quality.js` defines the price quality levels. A price counts as current only when it is `live` or `quiet`:
  - `live`: IEX ≤15 s, or consolidated ≤2 min.
  - `quiet`: Nasdaq.com re-confirmed the last sale within 45 s.
  - `aging`, `stale` and `delayed` are never current.
- `src/core/closes.js` fetches SIP split-adjusted daily closes through the relay. It uses identical per-day URLs so viewers share the relay cache, and stores them in localStorage.
- Day change is computed against the close of the session before the price's own session. A price from an earlier session is labeled with its date. A change that is not based on a consolidated close carries `*`.
- `mergeMarketRow` now also considers the delayed SIP minute close as a candidate, tagged with its own source. It also keeps `verified_at`.
- The list, the dossier and the KPIs show the source, the level and the other known prices. There is a notice when `/api/live` is absent.
- The `/api/live` client (`api.js` `live()`, `state.applyLive`) polls every 10 s. When the service returns 404 it stays in `NOT_SUPPORTED` and re-probes every 10 minutes. The page therefore works on today's service without changes.
- Tests: `tests/data.test.mjs` and `tests/nasdaq.test.mjs`. The full suite has 71 tests, all passing. The evidence-release hashes are updated and `verify-evidence-release.py --local` passes.
- Workflows:
  - `tagit-next-live-audit.yml` (parts A–E).
  - `tagit-next-ui-check.yml`, a Playwright check. Run 36310386898 against a canned service passed: every price had a source tag, the stale and aging rows were marked, and `/api/live` 404 degraded cleanly. Its checks of the published page and of this branch against the real service could not pass: the published service returned 429/503 on Sunday, and the page served from the runner is blocked by CORS.

Backend (`claude/agent-data-backend`):
- `src/live.mjs` adds `GET /api/live[?symbols=…]`. It combines three sources:
  - A rotation over the Nasdaq.com watchlist: 20 symbols per request, one step per ≈1 s plus latency. Batches alternate between viewed symbols and the rotation. A 403 or 429 backs off for 5 minutes.
  - Alpaca IEX snapshots every 20 s.
  - SIP 1-minute bars at least 16 minutes old, every 60 s.
- Each row carries `price_source`, `price_at`, `price_time_resolution`, `verified_at`, and a SIP day change for today's prices only.
- Polling runs only while someone asked for the board in the last 5 minutes, and only between 04:00 and 20:00 ET.
- `closes.mjs` now refreshes the union of the symbol sets it is asked for.
- 79 of 79 backend tests pass (`npm test`).

## Owner actions (free)

1. In Render, for the `tagit-next-quotes` service, change the branch to `claude/agent-data-backend`, or merge that branch into `tagit-next-independent-20260914`. Then click **Manual Deploy → Deploy latest commit**. No new environment variables are needed.
2. Check it: `https://tagit-next-quotes.onrender.com/api/live?symbols=SENS` should return `schema_version: 1`. `/api/health` → `live` shows the status of each source.
3. On a trading day, between 14:00 and 19:00 UTC, run the live audit with the in-session truth check and the deployed-board check:
   - In the Actions UI: **TAGit NEXT live data audit → Run workflow**, branch `claude/agent-data`, parts `A,B,E`.
   - Or re-run run 36310386929.
4. Separately, the published page's server reference is stale ("CURRENT_UNIVERSE_REQUIRED"), which is outside this work. The reference file `tag/data/universe-broad.json` on main needs its daily refresh.

## Open

- Nasdaq.com is unofficial. It can change or block without notice. The board reports `BACKING_OFF` or `FAILING`, and the page then shows IEX and delayed prices with their labels.
- 163 of the 823 names have no Nasdaq.com quote. They only get IEX and delayed prices.
- Nasdaq.com trade times have minute resolution. Their age is measured from the start of the minute, so it is never understated.
