# Continuous multi-session learning

The existing historical research workflow now runs at **02:17 UTC Tuesday–Saturday** (after the preceding US trading session), and on changes to the learning source. No browser needs to remain open. GitHub scheduled jobs can run late; inspect the workflow run and report timestamp when monitoring operation.

## Data and memory
Fetch the last 45 calendar days of regular-session five-minute bars. Merge by symbol/timestamp with retained bars, keeping up to 180 days. Freeze the initial sampled universe in `history/learning-universe.json`; this prevents nightly cohort changes, but does not remove the original retrospective selection bias. Abort on less than 80% download coverage, retaining the last published state. Gaps and incomplete windows remain excluded. Reports name the last actual data session, so a successful job does not imply a new market session.

## Patterns and learning
Describe recurring combinations of 15-minute direction, volume expansion, dollar-volume bands and position relative to VWAP across the most recent 20 sessions. Dollar volume is a liquidity proxy, not an order-book measure. Show sample counts, distinct sessions, target-hit precision and cost-adjusted average return. These descriptions are exploratory, not validated signals.

Fit a bounded family of standardized logistic models (C = 0.03, 0.3, 3) and predeclared probability thresholds using only training and the last five calibration sessions. This calibration selection is allowed to adapt as new data arrives. The existing historical report continues nightly; its rolling retrospective holdout is descriptive, not repeated independent validation.

Freeze a challenger with model ID, coefficients, universe, calibration metrics, data cutoff and actual creation time. Never score its training/calibration examples as prospective evidence. Evaluate only decisions after the freeze timestamp, from later sessions and symbols known at freeze. While it waits, data collection and pattern/drift analysis continue; it is not refitted during its test.

Close evaluation once, after five future observed sessions. Accept a **shadow research champion** only with at least 100 selections spread across all five sessions, four positive session means, a positive conservative session-mean lower bound, and better mean returns than select-all and the incumbent on the same dates. The lower bound uses a conservative t multiplier; dependence between sessions and repeated model attempts mean it is not a guarantee or a global 95% significance claim. Insufficient coverage closes as rejection; no repeated testing of the same candidate until it passes.

Record acceptance/rejection, comparisons and the methodological lesson in persistent `learning/state.json`; preserve report snapshots alongside it. Then freeze the next challenger. Measure feature-distribution shifts between the most recent five sessions and preceding twenty; flag standardized mean shifts above 1. The alert is diagnostic, not an automatic live trading action.

## Boundaries
The scanner ranking is unchanged. No orders are sent. Shadow acceptance does not establish profitability, authorize live promotion or prove 95% accuracy. Original cohort bias, source revisions, intrabar ambiguity, assumed costs, corporate actions and unmodeled portfolio constraints remain. Future work may expand the predeclared methodology, but must reset evaluation rather than tune against previously published test results.

## Operation
- Workflow: `.github/workflows/tagit10-historical-research.yml`.
- Worker: `tagit10/continuous_learning.py`.
- Latest report: `tagit10/reports/continuous-learning.json`.
- UI: Research → Continuous learning.
- Manual rerun: GitHub Actions → TAGit historical collection and temporal training → Run workflow.
- Stop scheduled execution: disable that workflow in GitHub Actions.
- GitHub schedule behavior: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
