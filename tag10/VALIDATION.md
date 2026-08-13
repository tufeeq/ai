# TAG10 Validation Log

## Build 0.1
- Branch: `tag10-rebuild`
- Architecture: state machine + evidence graph + path probabilities + tradeability + ABSTAIN
- Data: connected to existing reconciled Finviz snapshot feed with freshness/reconciliation metadata
- Sharia: strict gate; UNVERIFIED never becomes NOW/FORMING
- Tests: syntax checks + behavioral tests
- Cases: early-pressure, late-risk, Sharia-unverified, missing-data
- First CI failure: Node runtime hit browser-only `window` export
- Fix: dual browser/Node export guard
- Subsequent CI: PASS

## Not yet validated
- Prospective Top-20 Early-Capture Rate
- Brier calibration on out-of-sample sessions
- Execution-adjusted expectancy
- SEC filing/catalyst enrichment
- True order-book microstructure feed

No production-performance claim is authorized until walk-forward multi-session validation is complete.
