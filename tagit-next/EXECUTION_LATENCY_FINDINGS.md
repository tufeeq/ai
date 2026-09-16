# Execution-latency development experiment — 2026-09-16

## Frozen before quote retrieval

Protocol commit: af7c1118e9773c6326789404f81cb8d938332706.
Source ledger: 5f6963207e8ac45c07c023670c1a1bcaa2474f26, data/study-selection.json.gz.
Selection: first six BASE signals on August 25 sorted by time, symbol and ID,
without outcome filtering: OCGN, MITK, SLDB, MIST, HLLY, VUZI.
These are different signal IDs/session from the prior August 24 quote audit.
Their candle outcomes were already known; this is NOT an independent validation
sample. August 31–September 4 validation/test windows were not requested.

Compare entry observation latency of 1/3 seconds with a timeout quote allowance
of 3/30 seconds, fixed 45-minute horizon and 0.25% per-side costs. The alternative
only extends an otherwise UNKNOWN_TIMEOUT_QUOTE observation. It preserves
predeadline stops/targets, original fresh-last-quote fallback, original displayed
bid, actual late timestamp and unknown capped prefixes. Last-quote freshness
remains three seconds. No default trading policy is changed or promoted.

## Retrieval result: experiment NOT evaluated on new market data

Eight Alpaca SIP history requests, including bounded retries, all returned MCP
internal error -32603. Zero quotes received. The six failed windows appear in all
four scenario ledgers as PROVIDER_ERROR: zero resolved, no return estimate.
This is not zero opportunities, zero returns, or a negative strategy finding.
No additional downloads were attempted after the retry failed. Request parameters,
original error responses and resumption IDs are retained in
data/execution-latency-input.json. Budget used: 8/20 market-data requests.

No new news archive capability was available; news coverage stays unknown. Hosting
activation was not attempted; this research cycle needs no production deployment.

## Implemented and checked

Added execution_latency.py as a separate reproducible sensitivity diagnostic.
Existing exit_audit.py and all old study results are unchanged. Eight new tests
cover exact delay bounds, original late bid/time, invalid quotes, stop preservation,
capped prefixes, fresh fallback, full failed-sample accounting and entry latency.
58 Python tests passed locally without skips; CI additionally replays this report
and the original deterministic reports. Tests are software checks, not performance
evidence. No selected best scenario, trained model or trading accuracy is claimed.

Reproduce: python execution_latency.py; python -m unittest discover -s tests.

## Exact resumption point

After Alpaca history recovers, fetch these SAME six frozen windows. Preserve this
failed attempt log when adding successful pages. Continue capped pages from the
last timestamp inclusive, deduplicate exact records, and retain any incomplete
prefix if the cycle's 20-request budget is exhausted. Do not switch symbols or
relax thresholds. Then report all four scenarios' complete outcome counts, per-case
exit delays and paired bid-price differences, including unresolved cases. Only a
separately frozen untouched period could support a later independent claim.


## September 16 — provider recovered; same frozen sample completed

Alpaca recovered during the user-requested continuation. Six successful SIP calls
returned 15,317 quotes: OCGN 1,347; MITK 1,582; SLDB 9,212; MIST 678;
HLLY 622; VUZI 1,876. No response hit 10,000, so no continuation page was needed.
No sample or threshold changed. The eight prior failed requests are preserved in
execution-latency-input.json and in the compressed successful input's request log.
Cumulative requests: 14, including 8 failed + 6 successful; this continuation: 6.

Raw quote input: data/execution-latency-quotes.json.gz. The report now uses that
input when present; it retains the failure-only input as a historical checkpoint.

| Entry delay | Exit quote allowance | Resolved of 6 cases | Unknown exits | No eligible entry |
|---|---|---:|---:|---:|
| 1 second | 3 seconds | 3 | 2 | 1 |
| 1 second | 30 seconds | 5 | 0 | 1 |
| 3 seconds | 3 seconds | 3 | 2 | 1 |
| 3 seconds | 30 seconds | 5 | 0 | 1 |

The three-second cases are one fresh-last-quote timeout (OCGN), two stops
(MITK/HLLY), two unknown timeouts (SLDB/VUZI), and no eligible entry quote (MIST).
The extended allowance observes SLDB's bid 9.67 after 4.204488 seconds,
net quote approximation -1.2139%; VUZI's bid 2.79 after 26.918962 seconds
(1-second entry latency) or 20.608271 seconds (3-second entry latency),
net +0.2197%. These are actual later event timestamps, not backdated fills.
Neither baseline unknown has an executable deadline price, so paired price
slippage versus that missing price cannot be estimated.

For BOTH 30-second scenarios, the five quote-entry approximations comprise four
negative outcomes and one positive outcome, plus the sixth case with no eligible
entry. Per-case net approximations: OCGN -0.4988%, MITK -1.8685%,
SLDB -1.2139%, HLLY -1.8254%, VUZI +0.2197%. No subset mean or portfolio return
is reported. Entry latency shifts HLLY/VUZI event times but not their observed
prices or outcome classifications in this small sample.

Conclusion: the longer wait reduces unknown quote observations in this sample;
it does NOT improve the detector or establish favorable expectancy. Reject any
claim that resolving these unknowns constitutes trading success. Keep the original
policy unchanged. No quotes prove actual fills, continuous availability, queue
position, halt status or historical receipt latency. Original August 24 unknowns
and all rejected strategy findings are unchanged.

58 Python tests passed locally; CI retains the exact report replay and original
diagnostic checks. No production UI or live endpoint was changed; Cloudflare
tools remain unavailable and news archive coverage remains unknown.

Next bounded research step: freeze a timestamped, pre-signal quote-liquidity
feature study on additional development cases BEFORE retrieving those windows;
use negative controls and full failure accounting. A new untouched future period
and prospective bid/ask observations are necessary before a performance claim.
Do not retune this six-case sample or promote the 30-second policy.
