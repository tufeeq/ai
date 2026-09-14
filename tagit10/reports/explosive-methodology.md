# TAGit10: learning early single-session moves

This learner addresses a different target from the older +3%/30-minute experiment:
**a remaining 20% rise before a 5% decline within the same regular session**.
A remaining 50% rise is evaluated separately. Neither event is a promised return.

## Collected evidence

The initial collection requested 2,000 common equities selected by a fixed SHA256
ordering of the current Nasdaq Trader directories, before downloading returns.
It obtained 6,496,632 valid five-minute bars for 1,997 equities, from July 17 through
the last completed session before September 14, 2026. Pre-market and after-hours
data are archived; this first model is fitted only to regular sessions.

The source manifest records failed symbols, rejected rows, request boundaries,
download timestamps, and SHA256 hashes of all 16 compressed data shards. Raw bars
are retained for up to 180 calendar days as the archive grows. ETFs, warrants,
preferred shares, rights, units, and obvious funds are excluded from the initial
directory sample. Source instrument metadata is also required to identify equity.

This is a current-survivor sample, not historical exchange membership and not a
complete list of every stock that rose. Historical delisted symbols, historical
float, timestamped news, order books, and executable quotes are unavailable in this
dataset. Current Finviz RVOL is not backfilled as a historical feature.

## What is learned

Twenty closed-bar features describe 5/15/30-minute returns, volume acceleration,
traded dollar value, range compression and expansion, an OHLC-volume VWAP proxy,
retention near the session high, candle rejection, time of day, overnight gaps,
prior-session context, and cumulative volume relative to the same time on prior
completed sessions. The reference uses only earlier completed days.

The fixed candidate family consists of regularized logistic regression and a small
histogram gradient boosting model. Selection uses the calibration period only.
The live scanner consumes the exported JSON model through the same feature code;
inference is checked against scikit-learn before export.

Winner cases and pattern tables are descriptive. A case's earliest measurable
setup is located with hindsight for analysis; it is not presented as an alert that
the live radar actually issued. Both failed patterns and successful ones remain
in the evidence.

## Evaluation contract

- Observe closed five-minute bars at 15-minute checkpoints, after 30 minutes of
  regular-session history and five prior-session volume baselines.
- Limit the historical model domain to prices $0.20–40, less than 10% appreciation
  from the open and less than 20% from the previous close, and at least $100,000
  of traded value in 15 minutes. This intentionally misses some opening gaps and
  very fast first-half-hour moves; missed cases are reported.
- Delay assumed entry by a complete five-minute bar, then use the following open.
  A gain that happened before this delayed entry cannot become a model win.
- Evaluate +20% before −5% through the regular-session close. If one candle touches
  both, stop comes first. A gap through the stop uses the worse opening price.
- Preserve candidates whose future prices are missing. They consume alert capacity
  and do not count as successes. Calibration applies a −100% penalty to unknown
  outcomes when comparing conservative daily results. This is a selection penalty,
  not a claim that the stock actually lost 100%.
- Keep only the first alert per ticker/day, with at most five alerts per day,
  replayed in chronological order. No sorting by the eventual day's best score.
- Split dates 60/20/20, with a whole-session embargo between partitions. Report
  false alerts, unscorable alerts, 20%/50% hits, lead time, adverse excursion,
  per-alert returns after 0.4% and 1% assumed costs, confidence bounds, day-level
  results, and comparisons with momentum/volume rules.

Mean return excludes unscorable outcomes and is explicitly a per-alert simulation,
not a portfolio backtest. Conservative precision uses all alerts in its denominator.
Prior TAGit experiments inspected overlapping dates, so these historical results
are not claimed as a fresh prospective test. Bar highs do not prove that orders
could have filled at those prices.

## Connection and continuing learning

The radar exposes learned pattern scores in stock details without changing its
trade-permission flag or claiming calibrated probabilities. A research alert is
recorded only when the price is fresh and the alert is observed before its delayed
entry time. The original model ID, score, timestamp, and stock are retained across
the two scanner writers and session changes.

After completed sessions, the learning workflow refreshes history and volume
references and evaluates recorded alerts when later bars become available. It
also reports frozen-model replay separately from actually recorded alerts. Models
are frozen for ten later complete sessions before another fit; immutable model
and evaluation files preserve the earlier versions. There is no automatic
promotion to trading recommendations.

The nightly workflow is scheduled for 02:40 UTC Tuesday through Saturday. GitHub
scheduling and source availability can delay a run. Open-session data is excluded.

## Reviewable outputs

- `explosive-learning.json`: coverage, split dates, measured results, and limitations.
- `explosive-cases.json`: the largest observed moves in the downloaded sample.
- `explosive-audit.json`: calibration trials, held-out alerts, and missed movers.
- `explosive-model.json`: the frozen portable fitted model and its threshold.
- `../history/explosive/`: raw history, examples, source manifest, and frozen versions.

Source documentation: [Yahoo/yfinance intraday data limits](https://ranaroussi.github.io/yfinance/reference/api/yfinance.download.html)
and [Nasdaq Trader symbol-directory definitions](https://www.nasdaqtrader.com/trader.aspx?id=symboldirdefs).
