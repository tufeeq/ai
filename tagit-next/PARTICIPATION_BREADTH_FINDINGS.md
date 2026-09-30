# Persistent participation temporal replication — 30 September 2026

**Decision: reject the three-minute persistent-participation feature. It produced
only a one-percentage-point conditional target-rate lift in the exposed validation
period and failed the preregistered minimum outcome and target counts. It is not
added to the detector.**

## Frozen question

Commit `0949c6a258a4a886c66f42b5e91628e237ac6674` froze the feature, periods,
label and acceptance rules before this runner evaluated the validation period.
The feature requires 13 consecutive completed minutes ending at the signal:
ten reference minutes and three signal minutes. Every signal-minute volume must
be at least the median volume of the ten reference minutes. Zero, missing or
non-contiguous volume remains unknown.

The rationale was causal rather than return-fitted: the existing detector already
requires elevated average three-minute volume and limits one-minute concentration,
but can still accept a short burst. This diagnostic asks whether participation
persists in all three completed signal minutes.

The label is the already defined bar-path proxy: next whole-minute open after a
one-second delay, +10% target, −3% stop and 60-minute horizon. It measures remaining
movement after a modeled entry. It is not a bid/ask fill or profitability estimate.

## Full-denominator results

| Metric | Development 24–28 Aug | Validation 31 Aug–1 Sep |
|---|---:|---:|
| Frozen signals | 155 | 59 |
| Feature observable | 70 | 31 |
| Feature selected | 59 | 23 |
| Known outcomes in observable baseline | 48 | 25 |
| Known targets in observable baseline | 3 | 1 |
| Selected known outcomes | 41 | 20 |
| Selected known targets | 3 | 1 |
| Baseline conditional target rate | 6.25% | 4.00% |
| Selected conditional target rate | 7.32% | 5.00% |
| Target-rate lift | +1.07 pp | +1.00 pp |
| Known non-target proxy, baseline → selected | 93.75% → 92.68% | 96.00% → 95.00% |

Development passed the mechanical thresholds, but its effect was tiny and based
on three targets. Validation failed because the observable population had only
25 known outcomes versus the required 30 and one known target versus the required
three. Two additional validation targets occurred in the 28 cases where the
feature itself was unknown, so they cannot be credited to either selected or
excluded groups.

The final decision is `REJECT`. A one-point descriptive lift does not overcome
the missing-feature coverage, sparse targets, overlapping signals or wide Wilson
intervals. No resolved-subset mean, expectancy or profitability is reported.

## Integrity and reproduction

- All 214 development/validation signals remain in the report.
- No price, quote or trade request was made; saved bars were used.
- Alpaca connectivity was checked only with the market clock.
- Sessions 2–4 September were not loaded; holdout opens remain zero.
- No live rule, recommendation, deployment or order changed.

Reproduce offline:

```sh
make -C tagit-next verify
python -m research.participation_breadth --check
```

## Next bounded step

Do not loosen this feature after seeing the result. The next distinct feature
should use timestamped pre-signal trades rather than another bar-volume threshold:
freeze an outcome-independent sample of at most 20 exposed development/validation
signals, then test executed-at-ask share as a buy-pressure proxy. Preserve provider
errors and incomplete windows, and require a later separate replication before
any detector change. Dated news remains unconnected; absence of a retrieved article
must remain unknown rather than “no catalyst.”
