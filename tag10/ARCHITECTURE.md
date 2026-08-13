# TAG10 Architecture

TAG10 is intentionally independent from TAG8/9 scoring logic.

Pipeline:
1. Connected market snapshot ingestion with freshness/reconciliation metadata.
2. Evidence normalization: volume acceleration, float velocity, microstructure when available, persistence, catalyst freshness, sector sympathy, execution risk, dilution, halt and exhaustion.
3. State machine: DORMANT → ACCUMULATION → PRESSURE → IGNITION → EXPANSION / FAILURE_RISK.
4. Conditional path probabilities for +10%, +20%, +40%, failure and halt.
5. Tradeability gate separated from predictive probability.
6. Strict Sharia gate and ABSTAIN for insufficient evidence.
7. Dynamic targets and invalidation derived from state/probability/risk.
8. Walk-forward validation before any production promotion.
