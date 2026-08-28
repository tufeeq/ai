# TAGX 2.0

Clean-slate experimental rebuild of TAGX/TAG500. The old `tagx/` application remains untouched as the historical baseline; this build lives at `tagx2/` to prevent old service-worker/runtime layers from contaminating the new decision path.

## Why the reset

Week-of-2026-08-25 learning history showed that broad early discovery was not equivalent to useful actionability. Across Aug 25–27, the stored early cohorts were 1,073 / 1,036 / 887, while only 4 / 3 / 1 later reached +50% and 970 / 979 / 850 remained under +10%. Final-snapshot reconciliation is also currently blocked, so final outcome labels must not be treated as training ground truth.

## Design

`Observe -> Detect -> Cross-Validate -> Challenge -> Rank`

TAGX2 separates four concepts that were previously mixed together:

1. **Coverage** — can we see the mover at all?
2. **Early stage** — is it still inside an executable displacement window?
3. **Continuation proof** — is 5m/15m direction supported by liquidity/float evidence?
4. **Execution eligibility** — fresh HIGH-confidence point-in-time data + strict Sharia VERIFIED status.

Coverage-rescue candidates can improve missed-mover visibility but can never become executable by themselves. Late/Exhausted names are hidden from the default view. Missing or stale data fails closed.

## Current execution status

The legacy LAB is deliberately not carried into TAGX2. `READY_RESEARCH` is a research classification, not a broker order. With the current Sharia screen returning zero fully verified names, no real execution should be generated.

## Tests

`node tagx2/tests/selftest.js`

The deterministic self-test covers stage boundaries, late/exhaustion rejection, stale-data fail-closed behavior, coverage-rescue non-execution, and weekly-learning aggregation.
