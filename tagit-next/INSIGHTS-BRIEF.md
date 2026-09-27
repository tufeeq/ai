# Market Insights section — shared brief for the two insight agents (2026-09-27)

Owner request: "the best insights in a section for market insights showing the trends, market pulse,
moving sectors and recent news impacting certain industries or companies". Arabic RTL UI, zero cost.
Read tagit-next/AGENTS-BRIEF.md too (hard rules, relay limits, what works from runners). Integrity rules
still apply: facts with timestamps and sources, no buy/sell calls, no invented causality — a news item
is "linked" to a move only by symbol/industry match and time proximity, and must say so.

## Two agents, one contract
- **insights-data** (branch `claude/agent-insights-data`): builds `tagit-next/data/insights.json`
  with a pipeline (`tagit-next/pipeline/insights.mjs` or .py + tests) and a GitHub Actions workflow
  `.github/workflows/tagit-next-insights.yml` that refreshes it on a schedule (e.g. every 15–30 min
  during 08:00–20:30 ET on weekdays + once after close + weekends once), commits it on main only and
  dispatches `pages-tagx-deploy.yml`. On `claude/**` pushes it runs once and uploads the JSON as an artifact.
- **insights-ui** (branch `claude/agent-insights-ui`): adds a third workspace tab "رؤى السوق" (`#insights`)
  next to السوق / المختبر (see index.html nav + workspace-tabs.mjs), rendering insights.json with
  src/views/insights.js (+ core helpers, tests, styles in style.css, both light & dark themes, mobile).
  Develop against `tagit-next/tests/fixtures/insights.sample.json` (the UI agent writes it from the
  contract below; the data agent keeps its output valid against it). Missing/stale sections must render
  an honest empty/stale state, never fake data.
- Coordinate: if you need to change the contract, update THIS file on your branch and send the other
  agent a message (SendMessage to the lead "main" if you can't reach it) — the lead merges both.

## Free data available (from GitHub runners)
- `tag/data/universe-broad.json` on main (Finviz Elite, refreshed every 15 min on weekdays): ~7,000 US
  stocks with Sector, Industry, Market Cap ($M), Price, Change (%), Volume, Avg Volume (thousands), Float,
  Short Float, snapshot time. Best source for breadth, sector/industry moves, unusual volume, leaders/laggards.
- Alpaca via Render relay `/api/lab/provider` (≤40 req/min shared, pace ≥3 s): resource=bars (SIP ≥16 min
  old: index/sector ETFs SPY QQQ IWM DIA, XLK XLF XLE XLV XLY XLP XLI XLB XLU XLRE XLC, SMH XBI ARKK, TLT,
  GLD, USO, UUP, VIXY for trend: 1D/5D/1M/3M/YTD returns, 20/50/200-day MA position), resource=news
  (headlines with symbols, summary, source, time), resource=calendar.
- SEC EDGAR (8-K current feed / latest filings), Nasdaq halts RSS, FINRA short interest, Nasdaq.com
  (unofficial; earnings calendar api.nasdaq.com/api/calendar/earnings?date=YYYY-MM-DD, economic
  calendar), existing tagit-next/data/enrichment.json.

## Contract: tagit-next/data/insights.json (schema_version 1)
{
  "schema_version": 1, "generated_at": ISO, "session": "YYYY-MM-DD", "market_state": "PRE|OPEN|AFTER|CLOSED",
  "sources": [{"name","as_of","delay_note"}],
  "pulse": { "as_of", "indices": [{"symbol","name_ar","last","chg_1d_pct","chg_5d_pct","chg_1m_pct","chg_ytd_pct","above_50dma","above_200dma","spark":[numbers, last 30 closes]}],
             "breadth": {"universe","advancers","decliners","unchanged","adv_dec_ratio","pct_above_0","new_high_20d"?,"up_5pct","down_5pct","unusual_volume"},
             "regime": {"label_ar","reasons_ar":[..]},  // rule-based, e.g. risk-on/off from SPY/QQQ/IWM/TLT/VIXY/breadth; rules documented in code
             "small_caps": {...same breadth for market cap < $300M ...} },
  "sectors": [{"sector","name_ar","chg_1d_pct"(cap-weighted),"median_chg_pct","breadth_pct_up","rel_volume","etf","etf_chg_1d_pct","etf_chg_5d_pct","etf_chg_1m_pct","count"}],
  "industries": { "top": [{"industry","name_ar"?, "sector","chg_1d_pct","median_chg_pct","breadth_pct_up","rel_volume","count","leaders":[{"symbol","chg_pct"}]}], "bottom": [...] },   // min 5 stocks per industry
  "movers": { "gainers": [...], "losers": [...], "unusual_volume": [...] },   // rows: symbol, company, sector, industry, price, chg_pct, rel_volume, market_cap_m, news_ids:[...]
  "trends": [{"id","title_ar","detail_ar","evidence":[{"metric","value"}],"horizon":"1D|5D|1M"}],  // rule-generated observations, e.g. "القطاع X يتفوق للأسبوع الثاني"
  "news": [{"id","time","headline","summary","source","url","symbols":[...],"industries":[...],"sectors":[...],"move_pct":number|null,"impact_note_ar"}], // latest ~40, deduped, linked to movers/industries
  "themes": [{"industry"|"sector","title_ar","news_ids":[...],"symbols":[...],"avg_move_pct"}],  // news clusters hitting one industry
  "calendar": {"earnings_today":[{"symbol","company","time","eps_forecast"}],"economic":[{"time","event","actual","forecast","previous"}]},
  "notes_ar": ["..."]  // data caveats shown in the UI
}
Unknown values are null, never 0. Every section carries its own as_of when it differs from generated_at.

## Contract clarifications from insights-ui (fixture: tests/fixtures/insights.sample.json)
- Section-level `as_of` is read from `pulse.as_of`, `industries.as_of`, `movers.as_of`, `calendar.as_of`,
  plus optional `sectors_as_of`, `trends_as_of`, `news_as_of`, `themes_as_of` (top-level, because those are arrays);
  missing → the UI falls back to `generated_at`. The UI marks a section stale when its as_of is older than 90 min
  during 08:00–20:30 ET on weekdays, or older than 84 h otherwise.
- `industries.*[].name_ar` may be null (UI shows the English name). Leaders sorted by |chg_pct| desc (UI keeps order).
- `calendar.earnings_today[].time`: "pre-market" | "after-hours" | "during" | null; `eps_forecast` number|null.
  `calendar.economic[].time` is ISO UTC; `actual/forecast/previous` are display strings (e.g. "0.2%") or null.
- `themes[]` carries exactly one of `industry` or `sector`.
- `news[].time` is ISO UTC; order newest first (UI re-sorts anyway). `summary` may be null. `url` must be http(s).
- `movers.*[].news_ids` reference `news[].id`; the UI links a mover to its dossier via `#market/SYMBOL`.
