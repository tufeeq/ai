# SIP quote-size correction and six-case capacity audit — 2026-09-24

## Correction to the previous methodology

The paper observer treated every Alpaca SIP quote size as a number of round lots.
That was wrong for these 2026 records. Alpaca's dated October 30, 2025 changelog
specifies a switch to **shares**, effective November 3, 2025:
https://docs.alpaca.markets/us/v1.1/changelog/marketdata-bid-and-ask-size-display-change

The dated notice supersedes the older generic streaming-schema description used
in the previous implementation. `research/quote_units.py` now identifies the
provider, feed, effective market date and version; it uses a multiplier of **1**.
`research/paper.py` no longer requires a lot file for qualifying post-transition
SIP records and cannot inflate 100 displayed shares into 10,000 shares. Older
encodings and other providers/feeds remain unqualified. Invalid quantities stay
invalid. The legacy `--lots` argument remains accepted but does not convert sizes:
a security's round-lot definition alone does not establish a provider's encoding.

This removes an erroneous paper-observer blocker and prevents overstated quantity.
It does not change the live detector or demonstrate any successful live fills.
Existing terminal journal outcomes remain frozen; no old report is silently
rewritten. Historical reports/protocols retain their original lot-metadata gate
as an audit trail, **superseded for these post-transition SIP sizes by this note**.

## Frozen diagnostic and result

Protocol committed before calculating the capacity results:
`2a190a743cc7d1ba305d9e02bd91e8ac835b82c1`.
All six previously selected development cases are retained. This is a measurement
audit of already-inspected price checkpoints, **not a new independent test**.
No market-data requests, data purchases or holdout access were needed.

Check ask size at the previous first-ask anchor and bid size at the previous
observed barrier/timeout timestamp. Use shares directly and require quantity no
greater than the existing **1% lagged-minute-volume scenario cap**. The latest
completed minute must end before the quote and be at most 90 seconds old.
Historical end-of-minute availability is an explicit assumption: actual bar
receipt times and revisions are unavailable. Sizes at repeated/same-time quotes
are never summed; ambiguous observations use the lowest displayed size and any
invalid record leaves snapshot evidence unknown.

| Quantity (shares) | Cases | Both checkpoints meet size/volume scenario | Known capacity failure | Remaining unknown | Exit price still missing, including failures |
|---:|---:|---:|---:|---:|---:|
| 1 | 6 | 3 | 0 | 3 | 3 |
| 100 | 6 | 1 | 4 | 1 | 3 |
| 1,000 | 6 | 1 | 5 | 0 | 3 |

A capacity failure can coexist with a missing exit. All three missing exits stay
in the machine-readable results for every quantity; failure does not resolve them.
At 100 shares all four known failures are due to the unchanged volume cap, **not
insufficient displayed ask size**. These are scenario limits, not a claim that a
broker would reject the orders or that small positions are profitable.

| Frozen case | Entry ask size (shares) | Latest completed-minute volume | 100-share entry status | Exit checkpoint |
|---|---:|---:|---|---|
| BTCT · Aug 24 | 7,400 | 2,327,438 | Pass snapshot | Stop-price snapshot, size/volume pass |
| SGLY · Sep 1 | 200 | 550 | Above 1% volume cap | Stop-price snapshot, volume cap fails |
| AKTX · Aug 28 | 200 | 2,507 | Above 1% volume cap | Immediate spread-loss snapshot, volume cap fails |
| FWRD · Sep 1 | 200 | 1,108 | Above 1% volume cap | Unknown fresh timeout price |
| NKLR · Sep 4 | 100 | 212 | Above 1% volume cap | Unknown fresh timeout price |
| BTCT · Aug 31 | 21,400 | 20,366 | Pass snapshot | Unknown fresh timeout price |

The remaining size-qualified BTCT Aug 24 checkpoint is the previously observed
**stop-first price indication**, not a new winning opportunity. No return average
is computed from the qualifying subset. Verified execution outcomes remain **0**;
net expectancy remains null. The signal period, original labels, missing-data
ledger, negative baseline and previous rejected hypotheses remain unchanged.

## Reproduction and checks

From repository root, Python 3.12+ (standard library only):

```
make -C tagit-next share-capacity
```

This verifies the frozen protocol, source/report/bar hashes, shared quote-size
normalization, paper-observer integration and capacity report. `make -C tagit-next
verify` also reproduces all existing phase/continuation reports and runs the full
Python/Node suite. Tests include a 101-share order against 100 displayed shares:
the correct conversion cannot fill it; the old 100x conversion would fabricate a
target outcome. Future/incomplete volume, duplicate bars, quote-size inflation,
same-time observations, page-boundary gaps and missing exits are covered.

## Limits and next step

Displayed size at two timestamps does not establish a standing quote, queue
position, arrival-time latency, a fill or a complete executable price path. This
audit does not simulate costs or returns; the existing uncalibrated paper cost
policy is unchanged. The 1% cap was not optimized, and these results must not be
used to relax it on this sample. The historical universe is the earlier 96-stock
sample, not the requested complete PIT NASDAQ under-$100M universe.

Next, freeze a quantity/latency/cost replay at the **original signal time**. The
six saved paths start at the following minute: retrieve only the missing original
30-second entry windows (with a frozen manifest and <=20-request limit), preserve
existing paths and unknown exits, and reuse this unit contract. Receipt timing
must remain labelled as a scenario until forward observation supplies it. A final
independent holdout of at least 500 evaluable signals and qualified PIT metadata
is still required before any trading-efficacy claim. No strategy is approved.
