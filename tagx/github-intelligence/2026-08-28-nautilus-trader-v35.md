# GitHub Intelligence Sweep — 2026-08-28 — NautilusTrader

Repo: nautechsystems/nautilus_trader
Purpose: deterministic event-driven replay/backtesting, market-data adapters, execution simulation, risk controls.
Layer: backtesting/event replay, broker/data adapters, orchestration patterns, observability/risk architecture.

Assessment
- Maturity score: 95/100
- Integration score for TAGX direct dependency: 42/100
- Pattern-borrow score: 92/100
- Data-dependency score: 55/100 (engine is provider-agnostic but realistic replay quality depends on licensed/high-quality market data)
- Latency suitability: HIGH for server-side engine; NOT suitable for GitHub Pages/browser runtime.
- License: LGPL-3.0.
- Maintenance: very active; repository pushed on 2026-08-28.
- Documentation/tests: extensive docs, build status, deterministic simulation/live parity design, broad CI/security controls.
- Security notes: strong documented supply-chain controls, pinned dependencies, vulnerability scanning/fuzzing; still requires normal dependency review before any adoption.
- Look-ahead risk: engine supports deterministic time/event replay, which is useful for preventing accidental future-data leakage, but TAGX must still freeze source timestamps and only expose events available at each replay instant.
- Cost/data caveat: high-fidelity equities replay may require external providers such as Databento/IBKR or another licensed feed; engine itself does not solve data entitlement.

Decision: BORROW PATTERN / SANDBOX CHALLENGER, not direct production integration.

Patterns to borrow into TAGX
1. Deterministic event clock: replay signals using the exact source timestamp available at T.
2. Research/live semantic parity: same decision function for replay and paper mode.
3. Event bus trace: Observe → Detect → Validate → Rank → Track → Outcome, each event immutable and timestamped.
4. Adapter boundary: separate market-data normalization from strategy/scoring logic.
5. Risk engine as an independent gate, not embedded inside discovery scores.

Immediate V35 application
- Introduced a causal Continuation Proof Gate: a detection must survive a 3–18 minute observation window and show post-detection extension without early drawdown before it can become LAB-eligible.
- This is intentionally implemented without adding NautilusTrader as a dependency; benchmark the pattern first.
