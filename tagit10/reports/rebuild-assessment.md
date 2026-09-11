# TAGit professional assistant assessment — 11 September 2026

## Decision
The research model does not demonstrate a profitable edge and is not promoted into live ranking. Neither 95% precision nor a profitable trading system has been established. The rebuilt workspace supports opportunity review, explicit trade assumptions, cash-aware sizing, manual paper tracking and transparent evaluation.

## Capital objective
Growing $200 to $1,000,000 requires 5,000× capital, a 499,900% gain, approximately 14.47% compounded each of 63 trading sessions (or 9.93% daily for 90 calendar days), before costs and taxes. This is not a credible operating assumption. Software functionality cannot establish achievable investment returns.

## Audit findings
Earlier detection reports mixed retrospective selection and simulated same-session labels. An older symbol holdout selected 69 signals with six positives: 8.70% precision despite 100% recall. Tuning repeatedly against that holdout invalidates its use as untouched evidence. Archived snapshots hours apart cannot resolve a 30-minute target-before-stop outcome.

The preceding engine repairs introduced timestamp-based windows, missing-volume handling, quote freshness, independent confirmations, forward signal records, complete future-minute labeling and uncertainty reporting. Rank scores remain heuristic scores, not success probabilities. Live evidence must continue accumulating; code tests do not validate trading accuracy.

## Historical collection and new research
Completed workflow: https://github.com/tufeeq/ai/actions/runs/34645981835

- Archived observations: 10,108.
- Historical symbols: 160 of 160 requested, selected deterministically by hash from the archived cohort.
- Five-minute regular-session bars: 228,846 across 32 sessions, July 28–September 10, 2026.
- Labeled examples: 18,311; train 10,813, calibration 3,368, untouched temporal test 4,130.
- Eight closed-bar features; standardized logistic regression; threshold chosen only on calibration data.
- Label: next-bar open entry, +3% before −2% within 30 minutes. Ambiguous bars resolve stop first; downward gaps use the lower opening price. Deducted assumed round-trip costs: 0.4%.

| Held-out metric | Result |
|---|---:|
| Selected examples | 82 |
| Target-hit precision | 26.83% |
| Recall | 19.64% |
| Mean net return per selected example | −0.7095% |
| Positive mean-return test sessions | 2 of 7 |
| Brier score | 0.02508 |
| Select-all baseline mean return | −0.4461% |

Selection increased target-hit precision but worsened mean return relative to selecting every example. Low Brier error partly reflects rare positives; it is not 97.5% trading accuracy. The test is research evidence, not a capital-constrained portfolio backtest. No parameters were retuned using these test results.

Compressed observations, OHLCV bars and labeled examples, with checksums, are in `tagit10/history/`; report and model are in `tagit10/reports/`.

## Rebuilt workflow
1. Radar: inspect quote age, stage, reference levels and signal reasons.
2. Plan: import an opportunity reference or type assumptions; enter stop, target, risk budget, fees and slippage. Whole shares by default, fractional shares optional. Size is bounded by available paper cash and estimated stop loss. Gaps can exceed that estimate.
3. Journal: record hypothetical entries and manual exits; cash is reserved for open positions. Show realized P&L, closed-trade win rate and realized drawdown. Export JSON backups. Browser-local storage; no broker integration or automatic fills.
4. Research: display the actual historical report, sample sizes, temporal test dates, precision, returns and limitations. A losing research model stays out of live ranking.

## Material limitations and next evidence
The symbol universe is retrospective and subject to selection/survivorship bias. Yahoo bars are not executable bid/ask quotes. Corporate actions are handled only as supplied by the source. Halts, settlement, order-book liquidity, market impact, borrow and brokerage constraints are not modeled. Paper results are manually entered and exclude open-position mark-to-market. A multi-user backend, broker integration, market replay and validated profitable strategy are not delivered by this rebuild.

Before deploying any predictive ranking: collect point-in-time universes and prospective labels, evaluate successive untouched time windows, build a chronological portfolio simulator with concurrent capital constraints, stress execution costs, and measure confidence intervals and drawdowns. Freeze each candidate before forward paper evaluation. Do not repeatedly optimize against the published holdout or substitute a 95% target for measured performance.

## Verification
19 Python tests passed for the engine, quality evidence and research contracts. JavaScript sizing tests cover cash/risk limits, whole and fractional shares, costs, invalid inputs, and stop/target exit accounting. Frontend syntax and deployment checks are required by Pages CI. These checks verify implementation behavior, not investment performance.
