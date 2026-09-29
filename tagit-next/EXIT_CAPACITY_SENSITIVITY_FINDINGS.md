# Exit-capacity sensitivity — 29 September 2026

**Result: extending the frozen exit-capacity allowance from 3 to 30 seconds
resolved one additional outcome among all 20 exposed development cases. It did
not establish strategy expectancy, improve discovery accuracy, or justify a live
rule change.**

## What was fixed before measurement

Commit `80313dd1824fd2c310999023d9bce979351984f3` froze the 20 cases and the
paired comparison before this calculation. It combines the existing 12-case
24 August sample with the existing eight-case 25–28 August sample in chronological
order. No outcome, later high, target, stop or missingness result reselected a case.

Entry remains 100 shares with a 30-second window, fixed 1/3-second latency arms,
0.8% maximum midpoint spread, 1% maximum participation, BASE/STRESS costs,
−3% stop, +10% target and 45-minute horizon. The only changed measurement input
is whether qualifying bid capacity may be observed within 3 or 30 seconds. A
trigger remains latched: a later rebound cannot turn a stop into a target, and a
later target cannot replace a timeout.

No market history was requested. The calculation uses only SIP quotes already
saved before the protocol was frozen. The Alpaca connection was checked separately
with the market clock; it did not add a price, quote, trade or bar observation.

## Paired full-denominator result

All four entry-latency/cost scenarios have the same classifications:

| Classification | 3-second allowance | 30-second allowance |
|---|---:|---:|
| Frozen cases | 20 | 20 |
| Simulated entries | 14 | 14 |
| Target | 1 | 1 |
| Stop | 2 | 2 |
| Timeout | 0 | 1 |
| Unknown exit coverage/capacity | 11 | 10 |
| No entry | 5 | 5 |
| No qualified decision quote | 1 | 1 |

The single transition was
`BTCT:2026-08-28T14:09:00+00:00`, from unknown exit coverage to a modeled
timeout. The other ten unknown exit cases stayed unknown. This is a one-case
reduction in missingness, not evidence that 30 seconds is a better trading rule.

Four of 20 cases have modeled returns under the 30-second arm. Sixteen do not:
ten unknown exits, five no-entry cases and one case without a decision quote.
Therefore full-sample expectancy is unavailable. The mean of the four resolved
cases is deliberately withheld because it would not represent the full sample.

## Reproduce

From the repository root with Python 3.12+ and Node 24:

```sh
make -C tagit-next quote-anchored
make -C tagit-next verify
```

`research/exit_capacity_sensitivity.py` validates hashes for every frozen source,
rebuilds the 20 paths, and compares the checked-in JSON report byte-for-byte.
Tests cover the full denominator, zero market requests, paired transitions and
the rule that an illiquid stop remains a stop while capacity is awaited.

## Limits and next step

These are exposed development observations, not an independent test. Historical
SIP event timestamps do not prove historical receipt time, actual queue position
or fills. Increasing the allowance cannot repair missing cached coverage, and the
ten remaining unknown exits prevent a defensible expectancy estimate. The final
holdout remains sealed; no live detector, UI recommendation or execution policy
changed.

The next bounded research step is to freeze one causal, timestamped pre-signal
feature and its acceptance criterion before running it on a separate validation
manifest. The comparison must retain all failures and missing cases and may not
use this exposed 20-case sample to retune thresholds.
