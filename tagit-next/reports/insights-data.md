# insights-data — Market Insights data pipeline (2026-09-27)

## What was built
- `tagit-next/pipeline/insights.mjs`: pure, exported functions (universe parsing, breadth, group stats, sectors,
  industries, movers, ETF trend stats, regime-1, trend rules, news-link-1, themes, Nasdaq calendar parsers,
  market clock) + a thin IO `main()`. Output: `tagit-next/data/insights.json` (schema_version 1, per INSIGHTS-BRIEF.md
  and the UI's clarifications; additive fields are documented there).
- `tagit-next/tests/insights-data.test.mjs`: 11 tests on small fixtures. When `tests/fixtures/insights.sample.json`
  (UI branch) is present, the test also checks the built document against the fixture's shape (verified locally: passes).
- `.github/workflows/tagit-next-insights.yml`: every 30 min 08:11–19:41 ET on weekdays, ~20:11 ET after the close, and once a day on weekends.
  On `claude/**` pushes it runs once, prints a compact sample and uploads the artifact. On main it commits the JSON, pushes with a
  rebase-retry loop and dispatches `pages-tagx-deploy.yml`. On this branch only, it seeds the real JSON back to the branch.

## Sources and cost
Finviz snapshot `tag/data/universe-broad.json` from main (4,763 stocks after dropping ETFs, CEFs and shells), relay
calendar + one multi-symbol 1Day SIP bars request (23 ETFs, 420 days) + news for movers and the 100 largest caps
(7 relay requests per run, paced 3.1 s, hard cap 40), Nasdaq.com earnings/economic calendars. Free.

## Rules (in code)
- regime-1: ±1 each for SPY>50/200DMA, QQQ>50DMA, IWM>50DMA, A/D ≥1.5 / ≤0.67, VIXY 5d ≤−5% / ≥+10%, TLT↑≥1% while
  SPY↓≤−1% (5d). ≥4 risk-on, 2–3 lean positive, −1..1 mixed, −3..−2 defensive, ≤−4 risk-off.
- news-link-1: move_pct is set only for items naming ≤4 companies published between the previous close and the session close;
  the Arabic note says the link is symbol+time only. Roundups are shown last and are excluded from themes.
- Industries: ≥5 stocks, ranked by median change. Movers: price ≥$1, cap ≥$50M, ≥$1M traded. Unusual: RVOL ≥3 and ≥300K shares.

## Evidence
Runs (all success): 36358402535, 36358518353, 36358625905 — https://github.com/tufeeq/ai/actions/runs/36358625905
Real output for session 2026-09-25 (market closed): regime "ميل إيجابي حذر" (+2/7); SPY 771.35 (+0.54% 1D, +1.27% 5D);
breadth 2,412 up / 2,210 down (A/D 1.09); small caps 563/779; XLK leads for the second week (5D +3.5% vs SPY +1.3%);
40 news items, 31 of them linked by time; 3 themes; 21 earnings on 2026-09-28; 0 US economic events that day
(Nasdaq returned 3 events, none from the US).

## Open
- new_high_20d is null (the snapshot has no highs). Filling it would need per-stock bars and a larger relay budget.
- Holidays: the relay calendar is used. If it fails, the pipeline falls back to weekdays and adds a note.
- Before the open, the Finviz "Change" is assumed to still be the prior session's change. It is labeled that way in notes_ar.
- For news that names several companies, move_pct uses the most-moved named company. That may not be the company in the headline.
