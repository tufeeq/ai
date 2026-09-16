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
