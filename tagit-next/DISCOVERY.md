# TAGit NEXT discovery radar — 2026-09-16

The primary UI is a Nasdaq discovery radar, not a claim of a validated trading strategy.

## Live flow

1. Intersect active Alpaca NASDAQ assets with current Finviz reference equities under $1B. Missing metadata and funds are excluded; this is not all US stocks.
2. Retrieve snapshots across the eligible universe, in batches. Compute daily movement only for trades in today's New York session, against split-adjusted previous daily closes from the same feed. Missing verified baseline means no daily percentage.
3. Shortlist up to 120 distinct leaders by minute acceleration, daily gains and recent dollar activity. Pull completed minute bars from the prior 90 minutes.
4. Require three contiguous recent minutes, at least ten baseline minutes, volume expansion >=2x, price expansion >=0.7%, $25k traded in three minutes, >=30 prints, no single minute above 70% of volume, and price above the window's volume-weighted average. This is a window VWAP, not session VWAP.
5. Separate extended moves (>25% for day or >8% in three minutes) from early candidates. These thresholds are engineering defaults, not fitted optimal values.
6. Conditional plans additionally require recent trade and quote, spread <=0.8%, bounded structural stop distance, and no price chasing. Targets are risk multiples, not price predictions or guaranteed fills.
7. Attach related news links, publication times and subject categories. Headline categories do not establish positive impact or causality. No news in fetched results is not proof of manipulation. Float and short-interest reference context is shown; short-interest measurement date is unknown and does not prove a squeeze.
8. Record actual detection timestamps and subsequent sampled prices. Never backdate a live alert. The record is process-memory only and resets on restart.

## Measured evidence

`data/discovery-audit.json` and `quote-service/scripts/evaluate-discovery.mjs` contain a causal replay over 150,148 regular-session bars from 96 previously selected symbols and ten known sessions. This is a development audit, not untouched validation. It produced 322 liquidity/momentum events, 84 with complete subsequent 30-minute windows; 238 were unscorable. Of the 84, 18 reached +5%, 10 reached +10%, and 3 reached +20% intrawindow. Mean return at 30 minutes after an assumed 0.5 percentage point round-trip cost was -1.43%. This does not establish profitability. Intrawindow high is not an executable exit.

The audit uses SIP, whereas the live free account uses IEX. It does not reproduce live shortlisting, news availability, quotes, spreads or early/extended presentation filtering. Metadata has survivorship bias. Do not represent this as training on thousands of stocks or as a high-accuracy model.

## Remaining work before claims of reliable early recommendations

- Point-in-time, split-adjusted multi-month data including inactive/delisted stocks and real quote/liquidity constraints.
- Separate event types (clinical outcomes, earnings surprises, financing/dilution, contracts) with source evidence and availability timestamps, rather than title-keyword positivity.
- Fundamental valuation and dated short-interest/borrow data; currently not connected.
- Freeze event definitions and parameters before genuinely unseen temporal validation, comparing a simple volume baseline. Count false alarms, missed large movers, drawdown before target, fillability, costs and retained gain.
- Durable daily outcomes and unattended monitoring. Free Render may sleep; browser polling currently drives scans. Do not claim 24/7 monitoring or durable history.

## Operations

Backend: `https://tagit-next-quotes.onrender.com/api/scanner` (30-second shared cache). Existing `/api/quotes` updates up to 20 visible symbols every five seconds. Credentials remain only in Render environment variables. No order placement exists. `render.yaml` remains the deployment source; manual deploys because auto-deploy is off. Frontend public path is `main:tagit-next/`; its source is mirrored at `tagit-next/web/` on the independent branch.
