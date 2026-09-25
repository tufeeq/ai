# TAGit NEXT — opportunity workspace

Arabic, right-to-left workspace for spotting early moves in NASDAQ stocks under $100M market cap.
Live at https://tufeeq.github.io/ai/tagit-next/ and fed by the quote service at
`https://tagit-next-quotes.onrender.com` (`/api/scanner` every 30 s, `/api/quotes` every 5 s).

Static ES modules, no build step. GitHub Pages serves the folder as-is.

## Layout

```
index.html            page shell (market workspace, Lab tab, methodology)
style.css             design tokens, light/dark themes, responsive layout
app.js                controller: timers, events, rendering
opportunity.mjs       public entry to the pure core (used by tests and CI)
src/
  core/               pure logic, no DOM
    checks.js         the 12 checks, READY/CONFIRM/EXTENDED/STALE/WATCH states, priority tier
    market.js         trade/quote merging, New York date and session
    sizing.js         integer position size bounded by capital and planned loss
    journal.js        watch and alert records, observation samples, outcomes
    pressure.js       snapshot-volume pressure proxy
    sharia.js         badge only with a sourced, dated, current review
  api.js              config, scanner and quotes client with validation
  state.js            application state, transitions and selectors
  storage.js          guarded localStorage (journal, watchlist, calculator limits, theme)
  html.js             escaping template tag and keyed DOM morph
  format.js           numbers, prices, percentages, New York times, ages
  views/              state → HTML: list, dossier, journal, status, charts
tests/
  opportunity.test.mjs  core rules (freshness, plans, sizing, journal, pressure, merging)
  app.test.mjs          escaping, formatting, API validation, state transitions, views
lab/, performance.*   TAGit Lab and the evidence page (unchanged)
```

## Data sources

| Need | Source | How it reaches the page |
|---|---|---|
| Minute bars, precise trades and quotes | Alpaca IEX (one exchange) | quote service `/api/scanner`, `/api/quotes` |
| Real-time consolidated last sale, bid/ask, day volume | Nasdaq.com quote API (unofficial, minute resolution) | quote service overlay (`consolidated`) |
| Previous close | Alpaca SIP daily bars (older than 15 min, free) | quote service overlay |
| Trading halts | Nasdaq Trader halts RSS | quote service (`halt`), 30 s cache |
| Filings: offerings, listing notices, late filings, shares outstanding | SEC EDGAR | `data/enrichment.json`, 4× per weekday |
| Listing status (deficient, delinquent, bankrupt) | Nasdaq Trader symbol directory | `data/enrichment.json` |
| Dated short interest | FINRA consolidated short interest | `data/enrichment.json` |
| Live alert outcomes | scanner alerts + Nasdaq.com minute prices | `data/forward-outcomes.json`, daily |

The freshness checks follow the source: an IEX trade must be at most 15 s old and an IEX quote 10 s;
a consolidated trade (minute resolution) at most 2 minutes and a consolidated quote 30 s. Every price
shows its source. A live halt blocks any plan. Filing and listing risks are warnings, not gates.

## Methodology correction (outcome-relabel-1)

The frozen study scored only 84 of 322 signals because it required 30 contiguous minute bars; a
minute without a bar had no trade, not missing data. `research/outcome-relabel.mjs` reproduces the
frozen events and mean exactly, then carries the last trade forward: 295 of 322 signals resolve
(27 had no trade within 2 minutes, 0 unknown), with a mean 30-minute return of −0.58% after the
assumed 0.5 pp cost (−1.43% on the biased 84). The strategy still shows no positive expectancy.
The forward job applies the same protocol to every live alert.

## Jobs

- `.github/workflows/tagit-next-enrichment.yml` → `pipeline/enrich.py`
- `.github/workflows/tagit-next-forward.yml` → `pipeline/forward.py` (records every ~10 minutes,
  which also keeps the free Render instance awake; evaluates after 20:00 New York)
- `.github/workflows/tagit-next-source-probe.yml` → `pipeline/probe_sources.py` (manual check)

## Behaviour

- **Lists.** Early moves (priority tier: ≥ 8/12 checks with fresh minutes, liquidity and no extension), top gainers,
  your watchlist (up to 50 symbols, never filtered by the scanner universe), and the journal.
- **Dossier.** Analysis (grouped checks, why it appeared, pressure, company data, Sharia), plan (price ladder and a
  calculator that sizes as you type from your saved limits), news, and observed outcome with a chart.
- **Freshness.** Checks age with time. The page re-renders every second, so a plan expires on screen when its quote
  or trade goes stale.
- **Journal.** Server alerts and one watch record per symbol per New York day. Kept in this browser (250 records,
  360 samples each), exported as JSON, and each record can be deleted. Outcomes are sampled prices, not trades.
- **Keyboard.** `/` search, `↑`/`↓` move through the list, `Esc` closes the phone sheet or clears search.

## Checks

```
node --test tagit-next/tests/*.test.mjs tagit-next/phase2-view.test.mjs
python -m unittest discover -s tagit-next/pipeline -p 'test_*.py'
python tagit-next/verify-evidence-release.py --local
```

After changing any file listed in `evidence-release.json`, update its SHA-256 there. The deploy workflow compares
the published bytes against that manifest.

Passing checks is a detection condition, not a probability of profit. The historical study has not shown
profitable out-of-sample prediction.
