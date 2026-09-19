# Opportunity workspace — 2026-09-16

The published page now provides an Arabic, RTL, light/dark opportunity workstation. Lists cover early candidates, gainers, a personal watchlist, and the device journal. Selecting a symbol opens four dossier sections: analysis, conditional plan, related news, and observed outcomes.

## Data semantics

- Twelve explicit checks replace an opaque success percentage. Passing checks does not establish profitability.
- Assessment rechecks event timestamps, minute-bar timestamps and the individual row's scan time. Cached server receipt times never reset the browser clock or make an old quote fresh.
- Plans require server eligibility and all local liquidity, recency, spread, extension and structure checks. Expired plans disable sizing.
- Entry, invalidation and targets retain four decimals. Risk sizing is integer shares bounded by both user-entered capital and planned dollar loss; it excludes costs, slippage and fillability.
- News includes publication time, first service retrieval time, source, link and headline topic. No automatic assertion of positive catalyst or causality.
- Missing financial valuation, original filings and dated short-interest data are explicitly identified.

## Durable device observations

`localStorage` key `tagit-next-journal-v1` stores up to 250 events and 360 latest distinct price samples per event. Full observed minimum and maximum are retained even if chart samples roll off. Watchlist is capped at 50 symbols. Export creates JSON with timestamps and source feed. It is device-specific, not a server database; clearing site data loses the local copy. No background collection occurs while the page is closed.

Manual records start only after a fresh actual trade is available. Automatic records preserve server detection timestamps. Quotes earlier than detection and duplicate or regressing timestamps are excluded from outcomes. Change, maximum sampled excursion, minimum sampled excursion and gain retention are observations, not executed-trade P&L. Lines between sparse chart samples do not imply a continuous price path.

## Verification

`node --test tagit-next/tests/opportunity.test.mjs` on main (or the corresponding web path on the independent branch) tests stale scan/quote rejection, delayed feed rejection, thin liquidity, invalid plans, chasing, sizing, chronology, deduplication, negative gain retention and malformed journal restore. GitHub Pages runs these tests before deployment. Existing backend tests remain unchanged.

Live service: https://tagit-next-quotes.onrender.com
Frontend: https://tufeeq.github.io/ai/tagit-next/

This delivery improves the usable product, evidence and observation accounting. It does not claim newly trained predictive accuracy, profitable historical performance, full-market IEX coverage, or completed fundamental analysis.
