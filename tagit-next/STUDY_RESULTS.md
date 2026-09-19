# Independent expanded study — September 14, 2026

**Decision: reject all three hypotheses. No strategy is ready for live trades.**

This continues the independent rebuild with 164,248 newly retrieved SIP minute bars,
96 sampled stocks and 10 sessions. It is materially broader than the earlier
winner-selected 24-stock diagnostic. It does not prove trading profitability.

## Selection and chronology

- Broad reference: 7,264 securities; 2,193 equities below $1 billion after excluding
  ETFs, closed-end funds and shell companies. The source applies average volume
  above 50,000 shares; this is not every US-listed equity.
- Sample: 32 deterministic SHA256 selections from each current-cap stratum:
  under $50M, $50M–$250M and $250M–$1B. No daily change, winner lists, or outcomes
  entered the sample-selection function.
- Training/development: August 24–28 (5 sessions).
- Validation/selection: August 31–September 1 (2 sessions).
- Held-out test: September 2–4 (3 sessions), fetched only after the selection was
  frozen in commit `2f8d951d441309959398a8643a691bf85fdf0479`.
- Metadata remains a September 14 snapshot, so current-cap and survivorship bias
  remain. This is a chronological historical diagnostic, not a prospective trial.
- One requested stock/session, JFB on September 4, returned no bars. It remains
  recorded as missing. Missing individual minutes are not manufactured.

## Results

Means below use resolved next-minute-entry approximations, 0.25% costs on each side,
and the frozen stop/2R/45-minute policy. They are not portfolio returns.

| Hypothesis | Development resolved / mean net | Validation resolved / mean net | Selected |
|---|---:|---:|---|
| Base breakout / VWAP reclaim | 26 / -0.5576% | 12 / -0.3509% | No |
| Stronger volume acceleration (2x) | 20 / -1.4684% | 9 / -0.5651% | No |
| Tighter base and stop | 22 / -0.8045% | 12 / -0.3509% | No |

No alternative qualified for the held-out test. The original baseline was tested
as the predeclared comparator, not selected retrospectively as a winner:

- 125 setups across 37 symbols; **not 125 trades**.
- 26 resolved entry approximations: 6 positive and 20 non-positive after costs.
- Mean net return **-0.7071%**; worst individual resolved return **-5.603%**.
- One 2R target, 12 stops, 13 timeouts.
- 39 next opens outside the allowed entry range; 12 missing entry minutes;
  32 paths with intervening minute gaps; 16 unresolved horizons.
- These exclusions are substantial. The 23.08% positive share among resolved
  cases must not be presented as a full-population accuracy estimate.
- The separate counterfactual hold-to-session-end label found one net +15% and
  one net +20% target-before-stop case (the same signal). This is **not** an
  actual 2R-policy return, nor a top-30 mover capture rate. Gaps remain unknown.

## What this changes

The stronger-volume hypothesis made results worse on development data and also
failed validation. Tighter bases did not repair expectancy. Neither should be
promoted just to make discovery look more selective. There is no trained ML model;
this study compares three predeclared rule hypotheses, all rejected.

The continuous recorder now explicitly reports `REJECTED_BY_STUDY_RECORD_ONLY`.
A price quote that fits the conditional entry range is labelled execution data,
not an endorsement of the strategy. It still cannot place brokerage orders.

The next research question is whether early event/catalyst information and actual
quote liquidity add predictive value beyond price/volume. This study does not
answer that question. It does establish that repeating these three price/volume
rules or merely tightening their thresholds is not a supported fix.

## Reproduction

```
python -m unittest discover -s tests -v
python verify_study.py
```

The protocol, frozen selection, complete signal ledgers, original compressed inputs,
and checksums are committed. The study scripts do not import earlier TAGit engines.
No live entitlement, deployed runtime, or production app replacement is claimed.
