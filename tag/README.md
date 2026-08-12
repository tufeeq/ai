# TAG6 Web Scanner

Browser-based research prototype of the TAG6 early-momentum and pre-move behavioral learning framework.

## TAG6 core
- Retains all TAG4/TAG5 logic and gates
- Early Regime Shift Score
- Discovery / Ignition / Late / Exhaustion classification
- Extended-Hours Persistence Gate and Persistence Slope
- After-Hours Volume Participation and Extended-Hours Volume Takeover
- Mandatory Fresh-Catalyst Sweep, Event-Timing Context and Catalyst Clock
- Catalyst Attribution Error and Exhaustion Memory Penalty
- No-News Momentum Path and Hour-to-Hour Gain Retention
- Visibility Saturation Gate: huge RVOL after a large move is not early discovery
- Incremental Upside Gate: measures opportunity remaining after the signal

## TAG6 behavioral-learning layer
- Rolling 20-session stock-specific behavioral memory across pre-market, regular session and after-hours
- Post-Mover Reverse Study after Final Snapshot Reconciliation
- Earliest behavioral-deviation timestamp
- Behavioral fingerprints rather than single-indicator snapshots
- Matched-control learning to compare winners with similar setups that failed
- Pattern Family Library: Quiet Accumulation, Compression Breakout, Liquidity Migration, Reversal Ignition, Extended-Hours Build, No-News Momentum and Catalyst Anticipation
- Catalyst regimes: NEWS_SHOCK / PRECONDITIONED_MOVE / CATALYST_ON_PRECONDITION / NO_NEWS_MOMENTUM
- Hindsight guard: retrospectively discovered patterns are HYPOTHESIS_ONLY and never count as prior predictions
- Prospective/out-of-sample validation required before patterns receive predictive weight

## Data integrity
Final Snapshot Reconciliation is mandatory. Intraperiod snapshots must be timestamped and cannot be treated as final after-hours close. Final mover facts should be reconciled against at least two independent reliable sources when possible. Material disagreement is a DATA_INTEGRITY_ERROR and blocks the case from training or version-promotion evidence.

## Sharia gate
Core prohibited activities are excluded. Financially unverified names remain UNVERIFIED and cannot be promoted to actionable status.

## Important
This static web version does **not** by itself constitute a licensed live market-data feed. It analyzes connected/imported data. Reliable production operation requires authorized market-data sources and timestamped reconciliation.

## CSV schema
`ticker,price,changePct,volume,avgVolume,float,pmChange,ahChange,ahVolume,catalystAgeHours,spreadPct,sharia`

## Model files
- `model/TAG6-policy.json` — official TAG6 policy
- `model/tag6-behavioral-learning.js` — multi-session fingerprint/control-learning utilities
- `model/extended_hours_integrity_guard.py` — extended-hours integrity controls

Research and decision-support only; not investment advice.