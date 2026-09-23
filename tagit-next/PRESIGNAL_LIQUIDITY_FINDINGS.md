# Pre-signal quote-liquidity study — September 23, 2026

## Frozen design

Protocol frozen before quote retrieval in commit `19bc2b9e593a5b7bf857bcf51bc859b1b4ae89cf`.
Eight BASE signals on August 26 development data were selected by the eight
smallest SHA256 values of a fixed seed plus signal ID. Outcomes did not enter
selection. Each matched control is the same symbol ten minutes earlier and is
not another BASE signal. This is development evidence, not validation or test.

The predeclared primary feature check requires at least six of eight signal
windows to have both a higher valid SIP quote-event rate and no wider median
spread than its matched control. The secondary check asks whether the already
frozen liquidity-ready rule (at least five quotes, p90 spread <=80 bps and a
terminal quote within three seconds) improves observed quote-entry availability.
No trading threshold may be changed from these results.

## Data and results

Eight Alpaca SIP requests returned 10,607 quotes. Counts by symbol:
STIM 552, BTCT 201, SENS 475, LTRX 4,979, SLDB 2,306, PAL 791,
NHP 477 and METC 826. None hit the 10,000-record limit; no provider failures
or pagination calls occurred. Data are saved exactly in
`data/presignal-liquidity-quotes.json`.

Primary descriptive hypothesis: **passed 7 of 8 pairs**. LTRX was the only
non-win because its signal minute had fewer quote events than its matched
control, despite a slightly narrower median spread. This indicates that quote
activity usually rose around these already-detected signals. It does not show
that the feature predicts remaining price movement or profitable execution.

Secondary false-signal/executability hypothesis: **not evaluable**. Six cases
were liquidity-ready and two were not, below the frozen minimum of three in
both groups. Observed quote entries occurred in 5/6 ready cases and 2/2
not-ready cases; the limited evidence does not support using this gate to
reduce false signals. Five of six candle ENTRY_NOT_AVAILABLE labels had later
eligible quotes, again demonstrating measurement differences rather than
profitable trades.

Known candle outcomes of the eight selected signals were six
ENTRY_NOT_AVAILABLE, one STOP and one TIMEOUT. They were retained for audit,
not used in selection. No exit quote replay or return aggregation was performed.
No subset average, accuracy, or profitability is reported.

## Integrity and limitations

`presignal_liquidity.py` uses only quotes strictly before the signal/control
time for features and the already-corrected causal entry audit after the signal.
Eight new tests cover boundary exclusion, quote validity, nearest-rank p90,
freshness, exact sample accounting, truncation, primary decision and inadequate
secondary group size. All 73 Python tests passed locally; CI also replays the
saved report byte for byte alongside prior studies.

Historical exchange event timestamps are not receipt timestamps, fills, queue
position or continuous liquidity. The sample is small, drawn from one development
session, and the same price/volume activity that generated signals may also
increase quote updates. News coverage remains UNKNOWN_NOT_CONNECTED. No orders,
deployment, subscription purchase, old TAGit engine import or production
recommendation occurred.

## Decision and next step

Do not add a liquidity gate or promote a strategy from this result. The activity
feature is worth replication because its paired descriptive threshold passed,
but the feature did not demonstrate false-signal reduction or favorable outcomes.

Next: freeze the identical feature definitions on a deterministic validation
sample from August 31–September 1 before requesting quotes. Do not change the
80-bps, three-second or five-quote rules. Report every case and require adequate
ready/not-ready group sizes; only then consider an untouched future/prospective
test with actual receipt timestamps.
