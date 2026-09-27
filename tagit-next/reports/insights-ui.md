# insights-ui — Market Insights tab (رؤى السوق)

Branch `claude/agent-insights-ui`. Frontend only; the data file comes from insights-data.

## What was built
- Third workspace tab `#insights` (index.html nav + `workspace-tabs.mjs` now handles market / insights / lab).
- `insights.mjs` controller: loads `data/insights.json?t=<minute>` (`cache: no-cache`) on first open, reloads every 5 min
  while the tab is visible, re-renders every 30 s so ages/staleness move; keeps the last good file on a failed refresh.
- `src/core/insights.js` (pure): schema-1 check, per-section as_of + source matching, staleness rule
  (90 min in weekday 08:00–20:30 ET, calendar 18 h, 84 h otherwise, future/unparsable = invalid), news filters, sector sorts.
- `src/views/insights.js` (escaping `html` template, morph-friendly keys): pulse (regime card with reasons + score,
  8 index/ETF cards with 30-close SVG sparkline, 1D/5D/1M/YTD, 50/200-DMA badges), breadth gauges (all / small caps),
  sectors ranked diverging bars (cap-weighted bar + equal-weight median tick, breadth, rel. volume, ETF 5D/1M; 5 sort
  keys), top/bottom industries with leaders, movers table (gainers / losers / unusual volume, news count button),
  rule-based trends with evidence chips, news feed (sector / industry / symbol filters, linked move + symbol, impact note,
  explicit "link ≠ causation" banner), news themes (click → filter news), earnings + economic calendar, sources & notes.
- Every section header shows as_of in New York, age and source; stale sections get a flag + notice; missing data shows
  an empty state; failed load shows an explicit error (no substitute numbers). Unknown values render "—".
- Ticker links use `#market/SYMBOL`; app.js opens that dossier in the market workspace.
- Styles appended to style.css with existing tokens (light/dark), 360 px layout, numbers `dir="ltr"`.

## Evidence
- `node --test tagit-next/tests/*.test.mjs`: 123 pass (12 new in tests/insights-ui.test.mjs: contract shape of the
  fixture, freshness rules, fallbacks, filters, full render, empty/stale/error states, escaping of hostile news text).
- `verify-evidence-release.py --local`: OK (release next-9-insights-20260927, 46 files; 3 new files added).
- Playwright/Chromium at 1440 and 360 px, light and dark, 404 case: no horizontal overflow, no console/page errors
  (external hosts blocked in sandbox), filter focus kept, dossier link opens the market tab.

## Open
- Not yet tested against a real pipeline output (artifact download blocked by the sandbox proxy); the fixture includes
  the insights-data additive fields (regime key/score, numeric evidence, linked_symbol, news_window, calendar.date).
- INSIGHTS-BRIEF.md: both agents appended notes to the same section area; the lead should keep both blocks when merging.
