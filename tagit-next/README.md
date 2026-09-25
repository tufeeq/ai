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
node --test tagit-next/tests/opportunity.test.mjs tagit-next/tests/app.test.mjs tagit-next/phase2-view.test.mjs
python tagit-next/verify-evidence-release.py --local
```

After changing any file listed in `evidence-release.json`, update its SHA-256 there. The deploy workflow compares
the published bytes against that manifest.

Passing checks is a detection condition, not a probability of profit. The historical study has not shown
profitable out-of-sample prediction.
