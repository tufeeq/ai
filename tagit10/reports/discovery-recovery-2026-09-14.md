# TAGit10 10.5.0: discovery reliability and evidence repair

The recorded alerts do not establish a profitable trading edge. This release repairs discovery coverage, misleading data states, ranking, and evidence collection. It does not claim that a new predictive model has passed validation.

## Actual recorded alert evidence

Source: `tagit10-live` state blob `ed13b89cf2999c329cd12ffdfa389013ab02044a`, retrieved September 14, 2026. The accompanying `live-alert-audit-2026-09-14.json` preserves the 61 version-10.3 alert records and separates legacy version 10.2 statistics. Pending outcomes reflect this frozen snapshot, not their eventual results.

| Group, version 10.3 | Completed | +3% before -2% | Mean return after assumed costs |
| --- | ---: | ---: | ---: |
| EARLY | 38 | 1 | -0.1816% |
| ACTIONABLE | 4 | 0 | -0.6313% |
| CONFIRMED | 0 | Not available | Not available |
| First alert per stock-session, across stages | 39 | 1 | -0.2385% |

The first-alert cohort contains 51 observations: 39 completed, 3 unscorable and 9 pending. Only 30.77% of completed first alerts had positive net returns. The +3% target-hit rate is a different metric from the rate of positive returns. These are research outcomes using the next full minute's open, a 30-minute horizon, stop-first treatment of ambiguous bars, and assumed 0.4% round-trip cost. They are not brokerage fills or an audit of the user's personal 50% loss.

Eight completed first alerts with activity score at least 55 averaged -0.5907%. This small descriptive sample does not prove an indicator causes losses. It does demonstrate that a high activity score has not been established as a reliable upside signal. Original records lack individual indicator snapshots, preventing a faithful retrospective indicator-ablation study.

## Changes

- Developing, declining/extended, and unavailable-data lists are separate. Falling stocks cannot appear in the developing list merely because their volume score is high. Within each comparable group, observed 5- and 15-minute price direction determines watchlist order; the unvalidated activity score is confined to detail and existing research rules.
- Stale or unavailable data produces an unavailable count and an explicit inability to assess opportunities. A partial scan is never described as the entire market having no opportunities.
- Each successful feed response renders immediately. A slow secondary mirror no longer holds up a fresh primary response. Newer snapshots are never replaced by older ones.
- Scan priority retains pending outcomes and recently active alerts. High activity alone no longer retains a slot. At least one-third of hot slots rotate to new discovery even when many outcomes are pending. The broad sweep keeps its request budget; coverage is measured rather than presented as continuous all-market coverage.
- Data health reports attempted versus successful coverage over five minutes, symbols without a recorded attempt, unavailable requests, and median/p95 closed-bar age. Price timestamps explicitly describe the close of the minute bar. Eligibility still expires 120 seconds after bar start, equivalent to 60 seconds after close; the limit was not loosened.
- Every new frozen alert preserves individual indicator values, release ID, source, missing execution evidence, and closed-bar time. Completed outcomes also retain 30-minute favorable/adverse excursion. Earlier records remain intact and are not backfilled with invented values.
- `audit_live.py` makes the recorded-alert audit reproducible, separating versions, stages, missing outcomes and first alerts per stock-session. Its output is descriptive and is not a new historical market replay.

## Remaining work and order of execution

1. Verify the connected Alpaca account's historical and SIP entitlements with a real data request. The connection was confirmed during this turn; callable Alpaca data tools had not yet appeared in the running tool registry. No assertion about account plan, API credentials, entitlement, or successful SIP access is made.
2. Establish an authenticated persistent ingestion service and licensed data access for the intended use. The connected Vercel team has no projects; the existing production service remains a GitHub Actions polling engine with a GitHub Pages interface. A ChatGPT connector is not automatically a credential for a deployed worker. Streaming minute bars, revised bars and executable bid/ask data need explicit provenance, event and receipt timestamps, reconnection/backfill handling, and persistent storage. Never label delayed SIP or a single-exchange feed as consolidated realtime data.
3. With usable historical access, collect a frozen, reproducible six-to-twelve-month stock universe using historical listings/corporate actions where available. Save raw immutable inputs. Include all outcomes and matched failed breakouts, not only retrospective biggest gainers. Separate missing data, inactive intervals, halts and unavailable listings. Audit coverage before fitting.
4. Predeclare distinct opening, continuation and pullback hypotheses, move sizes (3/5/10/20% and above), time-to-target and adverse-move limits. Respect what was actually known at each alert timestamp. Bid/ask, volatility, liquidity and catalyst features must use historical observations, not today's metadata. Track all missing features.
5. Compare simple baselines and a small fixed model family with chronological train/calibration/test periods and embargoes. Optimize net-cost expectancy, downside and early capture jointly; keep a fixed alert budget. Use unseen dates for evaluation and do not repeatedly tune against the same published holdout. Existing failed 20% model remains shadow research and does not rank live candidates.
6. Observe at least 20 subsequent sessions and 100 independent stock-session alerts as an initial review point. Those counts alone are insufficient: require coverage/freshness readiness, improvement over predeclared baselines after stressed costs, acceptable downside, and stable results across multiple time blocks before considering promotion. Missing outcomes cannot count as successful alerts.

The release does not replace the legacy candidate thresholds with a newly validated model. It removes concrete ranking/data defects and captures the missing evidence needed to evaluate such a replacement.

## Primary implementation references

- [Alpaca realtime stock data](https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data): feed types, bar timing/revisions, quote messages, subscription authorization.
- [Alpaca historical stock sources](https://docs.alpaca.markets/us/docs/historical-stock-data-1): distinction between SIP and IEX data coverage.

## Verification

Local backend suite: 61 tests passed; an additional rollout-compatibility test passed after verifying that prior-release scan timestamps remain counted, including closed-bar integrity, unchanged freshness expiry, direction ordering, fair scan rotation, pending-outcome preservation, immutable indicator snapshots, and duplicate/unknown-safe audit summaries. Chromium regression passed on the PR and merged release, including mobile layout and slow-mirror response handling. The main release was deployed successfully. A subsequent coverage-compatibility correction preserves prior-release scan evidence; its published output is checked before completion.
