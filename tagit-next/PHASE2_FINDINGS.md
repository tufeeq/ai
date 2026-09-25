# Phase 2 — isolated development comparisons

As of 2026-09-24. **Neither filter is approved. No demonstrated improvement in
accuracy, executable expectancy or profitability.** This is research implementation
while Phase 1's data qualification remains incomplete. Live rules are unchanged.

## Reproduce offline

```sh
make -C tagit-next phase2
```

Python 3.12+ and Node 24. Tests causal features and byte-checks both generated
reports. Full project checks: `make -C tagit-next verify`. No network, credentials
or holdout access. Sources: [protocol](research/phase2-protocol.json),
[hashes](research/phase2-inputs.json), [full ledger](data/phase2-development.json),
[public evidence](web/phase2-evidence.json). Protocol committed before calculations
in [99d67d3](https://github.com/tufeeq/ai/commit/99d67d31812673da7a4a1ec68a4b577920daef0d).
These dates were already exposed; preregistration does not make them independent.

## Population, features and labels

All 322 events in the unchanged current `discovery-1` bar audit: 96 previously
selected symbols, ten sessions August 24–September 4, 2026. All 84 known and 238
missing outcomes remain. No outcome ranking, exclusions or threshold search.
Previously rejected separate Python strategies/liquidity studies remain separate.

The preserved outcome is next-minute open to 30-minute close, minus an assumed
0.5 percentage points round-trip cost. **Not** bid/ask execution, triple-barrier,
remaining-upside trades or live profit. All means/intervals below are conditional
on observed outcomes. All-signal expectancy remains unknown.

Frozen single-feature ablations, never combined:

- Core session: >=30 minutes after exchange open and strictly before the last 30
  minutes. Signals exactly at close are known exclusions. Calendar strings are
  explicitly localized to America/New_York; DST and early closes are tested.
- Momentum / prior ATR: three-completed-minute price rise >=one prior ATR unit.
  ATR is the arithmetic mean of 14 true ranges, excluding the expansion window;
  a prior close is required, for 18 contiguous minutes total. This is a scale
  diagnostic, not an ATR stop or a fitted profitable threshold.

Future bars/receipts and late revisions cannot change earlier features. Historical
final bars lack receipt/revision times: this run explicitly assumes availability
at minute end. Causality tests under that assumption do not prove actual historical
observability. The fixed signal ledger is a post-detection ablation: exclusions do
not release cooldown or re-run a changed shortlist/strategy frequency.

## Results, including missing cases

| Comparison | Feature observable | Selected / evaluable / missing outcome | Excluded / evaluable | Feature unknown | Comparator mean | Selected mean | Difference, pp | 95% difference interval | Bonferroni 97.5% interval |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| Core session | 322 | 231 / 79 / 152 | 91 / 5 | 0 | -1.4259% | -1.3207% | +0.1052 | [-0.0592, +0.3378] | [-0.0811, +0.3726] |
| Momentum / ATR | 123 | 119 / 63 / 56 | 4 / 3 | 199 | -1.6385% | -1.4532% | +0.1853 | [-0.1034, +0.6426] | [-0.1243, +0.7261] |

Comparator and selected populations share feature availability. ATR's comparator
is 123 signals / 66 observed outcomes, **not** the full 84-outcome baseline.
The 199 ATR-unknown signals include 18 known returns averaging -0.6463%; they are
retained separately. ATR excludes only three scored cases, including one positive
outcome. Core session excludes 91 signals but 86 outcomes are missing, strongly
affected by the closing horizon. Neither supports a false-signal reduction claim.

Both selected means remain negative; both difference intervals include zero. No
filter was adopted, combined or retuned. P-values/significance are deliberately
not asserted on this biased development sample.

5,000 paired session-block bootstrap draws, seed 20260924: each draw uses the same
sessions for selected and comparator means. Sessions without observed labels remain
in the sampling frame; empty replicates are counted, with >=99% valid required.
Both comparisons have 5,000/5,000 valid. The two-comparison family uses 97.5%
per-interval percentile bounds as an exploratory Bonferroni adjustment. Ten
clusters, biased selection and missing labels preclude confident generalization.

Saved fixed round-trip cost scenarios: 0.5, 1.0, 2.0 percentage points. Selected
means are -1.3207%, -1.8207%, -2.8207% for core session and -1.4532%, -1.9532%,
-2.9532% for ATR. These are not measured slippage/spreads. A common constant cost
change does not alter the conditional mean difference.

## Session breakdown — descriptive, not walk-forward

| Session | Core evaluable | Core mean | ATR evaluable | ATR mean |
|---|---:|---:|---:|---:|
| 2026-08-24 | 7 | -4.2139% | 4 | -4.1390% |
| 2026-08-25 | 6 | -2.5672% | 6 | -2.5672% |
| 2026-08-26 | 6 | -3.0362% | 2 | -0.0848% |
| 2026-08-27 | 5 | -0.9733% | 6 | -0.8463% |
| 2026-08-28 | 6 | +2.1275% | 5 | +1.4266% |
| 2026-08-31 | 10 | -1.1817% | 7 | -2.4652% |
| 2026-09-01 | 12 | -0.4530% | 9 | -1.3203% |
| 2026-09-02 | 9 | -2.4307% | 8 | -2.4347% |
| 2026-09-03 | 8 | +0.3334% | 7 | +0.2053% |
| 2026-09-04 | 10 | -1.2652% | 9 | -1.5887% |

JSON includes all daily denominators and differences. These are not independently
held-out windows, and nothing here measures portfolio drawdown or capacity.

## Later phases and next evidence gate

Same-time RVOL now has a tested causal implementation: current three-minute volume
divided by the identical window's mean over the immediately preceding 20 sessions.
Missing minutes/sessions and unverified split-volume basis yield UNKNOWN. No zero
fill or skipping missing sessions. Performance remains untested with only ten saved
sessions. Float turnover, trade-side pressure, PIT float/short interest, news,
halts/SSR, dilution/reverse-split risk, calibrated models and ATR exits are untested.
Unconnected news is not evidence of no catalyst.

The RTL performance page now shows comparison denominators, conditional means,
both intervals and unknown features from the reproducible artifact. It rejects
inconsistent counts, unsupported significance or fabricated approval. The existing
server journal, stream and paper evaluator remain in the branch; operational
activation still requires the decisions in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).
No Sharia verdict is inferred from incomplete provider data.

This cycle: **zero new price/quote/trade requests**, one Alpaca calendar metadata
request, no purchase, deployment, trade or production merge.

Next: qualify historical listing/share/float and split basis, then freeze a
retrieval manifest for sufficient preceding RVOL sessions and new development
dates. Independent comparisons require new qualified dates and full quote entry/
exit labels, preserving gaps and failures. Do not tune these thresholds on this
sample. Complete walk-forward qualification before selecting a final configuration;
open the final holdout once. No final configuration exists, holdout opens=0, and
the >=500 independent evaluable-signal criterion remains unmet.
