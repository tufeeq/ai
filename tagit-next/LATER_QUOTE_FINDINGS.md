# Later quote-anchored development sample — 28 September 2026

**Result: the unchanged policy found no +10% or +20% target-first case in this
eight-case later development sample. Four of five simulated entries still have
an unresolved exit, so full-sample expectancy remains unavailable. No rule is
promoted and the final holdout remains unopened.**

## Frozen selection and retrieval

Commit `63cbefed82193037f431f5f918915eb77b2ea40b` froze the question, policy and
eight cases before SIP retrieval. The sample is the first two chronological BASE
signals on each exposed development session from 25–28 August. No future return,
session high or mover rank entered selection.

Nine Alpaca SIP requests returned 34,718 quotes. Eight initial 48-minute windows
were requested; NUAI reached the 10,000-record limit and used one overlapping
continuation request. The overlap is conservatively deduplicated by timestamp.
All raw responses, request parameters, hashes and the retrieval ledger are saved.

The detector and quote policy are unchanged: first qualified SIP decision quote,
100 shares, 30-second entry window, 1/3-second latency, spread at most 0.8%, at
most 1% of the last completed minute's volume, −3% stop, +10% target and a
45-minute horizon. BASE and STRESS costs alter prices, not classifications here.

## Full-denominator execution result

Each of the four fixed latency/cost scenarios produced the same counts:

| Classification | Cases |
|---|---:|
| Frozen cases | 8 |
| Simulated entries | 5 |
| Modeled stop exits | 1 |
| Modeled target exits | 0 |
| Unknown exit coverage/capacity | 4 |
| No entry | 3 |

Only one return is resolved, a stop. It is not averaged or presented as strategy
expectancy. The other four entries lack a qualified exit quote within the frozen
three-second allowance at a barrier or timeout. Missing outcomes are not converted
to zero, wins or losses.

## Remaining-move diagnostics

Quote-side +10% and +20% labels were identical: one stop-first, two confirmed
not reached through a fresh 45-minute timeout quote, and five unknown because the
strict timeout quote was absent. There were zero target-first cases.

The separately saved one-minute trade-bar diagnostic extends from the first whole
minute after the decision quote to the regular-session close. For both +10% and
+20%, three cases were stop-first and five did not reach either barrier. Again,
there were zero target-first cases. These bars do not prove executable prices and
are not substituted for missing quote exits.

Across this and the prior 12-case quote-anchored development audit, the cumulative
classification per fixed scenario is 20 cases: 14 simulated entries, one target,
two stops, 11 unknown exits, five no-entry cases and one case without a qualified
decision quote. This cumulative count is descriptive; it is not an independent
test or a profitability estimate.

## Reproduce

From the repository root with Python 3.12+ and Node 24:

```sh
make -C tagit-next quote-anchored
make -C tagit-next verify
```

The later report is reproduced byte-for-byte from the frozen protocol, compressed
raw SIP responses, checksummed retrieval ledger and already saved minute bars.
Unit tests cover the two-minute decision boundary, conservative same-timestamp
target rule, opposing barriers, bar ambiguity and the complete eight-case sample.

## Limits and next step

These are eight exposed development observations from four sessions and the
existing 96-symbol sample. They do not measure all NASDAQ stocks under $100 million,
top-mover recall, forward performance or actual fills. Historical event timestamps
are not receipt timestamps; queue position, halts and point-in-time universe
eligibility remain unknown. No live rule, UI recommendation or order was changed.

The next bounded step is to preregister an exit-measurement sensitivity on the
combined 20-case development sample using fixed 3-second and 30-second capacity
allowances, then measure whether uncertainty falls without changing entry or
barrier rules. Only after that measurement is fixed should a timestamped pre-signal
feature be tested on a separate validation sample. The final holdout stays sealed.
