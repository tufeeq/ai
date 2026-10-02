# Review: outcome-measurement pipeline (agent 3 of 5, 2026-09-29)

Scope: are the recorded outcomes correct? This covers `forward.py`, `paper_ledger.mjs`,
`sip_study.mjs` (session/label/summarize), `research/outcome-relabel.mjs`, `src/core/journal.js`,
their workflows, and the committed data.

Worktree branch: `worktree-agent-a4ada74b21702cd63`. Nothing was pushed.

## Bottom line
- **No look-ahead, lag inflation, duplicate or impossible price was found in any committed
  outcome.** Every published summary now recomputes exactly from its raw file:
  `research/recompute-outcomes.mjs` checks 101 numbers and reports 0 problems.
- **The live forward record has never measured a session.** The evaluation date came from the
  runner's clock. GitHub delays scheduled runs, so they wrote empty rows for a Saturday
  (2026-09-26) and for 2026-09-29 before that session opened. Monday 2026-09-28, the forward
  start, was never evaluated. The page therefore showed "2 evaluated days" of nothing.
- **Plan R was flattering in three places.**
  - Stops that gapped through were booked at exactly −1R.
  - Plan R was reported gross of the 0.5 pp cost.
  - The paper ledger's mean R is dominated by stops placed inside the spread.
- **Counts were inflated.** The SIP study still held 1,841 after-close pseudo-signals, which
  inflated `signals` and `no_entry`. The paper ledger counted a live-alert session that was never
  observed.
- **The conclusions do not change.** Every mean return is identical after the fixes, and
  everything stays negative.

## Issues

| # | Sev | Where | Evidence | Fix |
|---|---|---|---|---|
| O1 | **High** | `forward.py evaluate` + `tagit-next-forward.yml` (`day=$(TZ=… date)`) | Commits `6cbf83b` (05:52Z Tue) and `d923ee0` (07:00Z Tue) wrote a 2026-09-29 row before the session opened. The earlier 09-26 row was written 06:11Z Sat. Neither row has a health sample or an event. Monday 09-28 is missing: its ledger cache was keyed by a different date. The Nasdaq chart only serves the latest session, so a late evaluation of the wrong date destroys the day for good. | `session_day()` picks the latest session whose close has passed. It skips weekends and 2026–27 holidays and handles early closes. The workflow keys the ledger cache on that date. Evaluate passes run at 01:20, 02:20 and 05:20 UTC, and a `day` dispatch input was added. The two bogus rows were removed from `data/forward-outcomes.json` (deterministic: both were empty). |
| O2 | High | `forward.py` | A later pass could overwrite a published day with worse data (chart rolled over, cache lost). A symbol with no chart points for the date was labelled `NO_ENTRY` ("no trade in 2 min") instead of "unknown". | `keeps_old()`: a poorer pass never replaces a day. No points for the date now gives `SOURCE_UNAVAILABLE`. |
| O3 | Medium | `forward.py label` | A sampled price below the stop was booked at −1.0R. The test fixture shows the true value, −1.1R. Plan R had no cost. | R is taken at the observed price. `r_after_cost` is added. `plan_mean_r` is now after cost, and the gross value is kept as `plan_mean_r_gross`. |
| O4 | Medium | `forward.py` summary | Extended-hours alerts (horizon 20:00) were mixed into the headline mean and `resolved`. Days with no recorder sample counted as sessions with 0 alerts. Every run committed and redeployed even when only `updated_at` changed. History was trimmed to 90 days. | The headline is regular-session only, with `extended_*` fields beside it. Days carry `recorded` and `complete` flags. `totals.days` counts recorded days only, and `days_not_recorded` is added. There is no write when the data is unchanged. `KEEP_DAYS` is 750. |
| O5 | Medium | `data/sip-events.json` / `sip-outcomes.json` | There are 1,841 signals decided at 16:01 from the after-hours 16:00 bar, across 184 of 185 days. Audit A1 fixed the detector but not the stored days. All of them are `NO_ENTRY`, so no mean moves, but the published totals said 47,539 signals and 5,340 no-entry. | `dropAfterClose()` runs on load and in `buildReport`. Both files were re-derived: **45,698 signals, 42,199 resolved, 3,499 no-entry**. Mean −0.726%, holdout −0.900%, delayed holdout −0.793%, all unchanged. |
| O6 | Medium | `sip_study.label`, `outcome-relabel.mjs planLabel` | A bar that opened below the stop filled at the stop. In the frozen study 8 of 55 stops gapped, at −1.01R to −1.96R. Plan R was gross: the "+0.04R plan" in the SIP study is before cost (the risk report says so too). | A gap exits at the bar's open. The relabel was re-derived from the committed study bars: plan mean R (2m) goes from −0.013 to −0.021 gross, and is **−0.424R after the 0.5 pp cost** (`mean_r_after_cost`). The SIP labels now store `rc` (cost in R), and `plan_mean_r_after_cost` fills in for new days. Past SIP days cannot be costed: the entry and stop were not stored. |
| O7 | Medium | `paper_ledger.mjs` | 2026-09-28 was run at 06:19Z, when forward-outcomes had no 09-28 row. It still counted as `LIVE_ALERTS.sessions: 1` with 0 trades, and a known day was never re-run, so late live alerts could never enter. Other problems: days with a failed bar batch were kept for ever; only the last 5 weekdays were considered; `session()` ignored 13:00 early closes; and the job ran at 20:45 NY, before the forward evaluation. | A day stores `live_source`/`live_alerts_input`, and the live book counts only recorded days. A day is re-run when its forward row appears; its SIP records stay as published. Failed days are retried, and missing days are caught up oldest first. `session()` is now `regularSession`. The ledger crons moved to 02:45/05:45 UTC. Raw and summary were re-derived (LIVE sessions 1 → 0; SIP book unchanged). |
| O8 | Low | `paper_ledger` statistics | The mean net R of −4.39R is carried by plans whose stop sits inside the spread. Example: GOSS, a $0.006 stop on an $11 stock, costs 70.5R. The median is −1.07R. | `median_net_r` and `net_usd_per_trade` are reported beside the pre-registered mean. Prices are stored to 6 decimals, because 4-decimal stops made R impossible to recompute for 2 trades. |
| O9 | Low | `tagit-next-sip-study.yml` | `--today` never looked back, so a delayed or dropped run left a permanent hole, and failed batches were kept. | The daily job now covers the last 7 New York days (known days are skipped), and failed days are retried. |
| O10 | Low | `forward.py record` (not fixed) | A record run delayed past midnight New York saves into the next date's cache. The Actions cache evicts after 7 days unused, so older sessions cannot be re-evaluated. After a scanner restart, the backend `lastSignals` cooldown is empty, so the same burst can alert twice with different `detected_at`. | Documented. |
| J1 | Medium (not fixed) | `src/core/journal.js` | Journal outcomes have no horizon. `change` is the last sample whenever the page was last open, across sessions and overnight. "N higher than the detection price now" mixes horizons, has no cost, and starts from the alert's IEX price. `max`/`drawdown` miss every minute the page was closed. | Not changed: the file is hash-pinned in `evidence-release.json`, which I may not edit. Proposal: ignore samples after `started_at + 30 min` or after that session's close, and show `change − 0.5 pp`. |

Verified correct (no bug found):
- Entry is never before the signal:
  - SIP: decision = bar start + 60 s, entry = the next bar's open; the delayed entry falls in [+17, +19) min for all 60 paper trades.
  - Live: `detected_at` is the backend scan time.
- The stop is checked before the target within a bar, and a gap fills at the open (paper ledger).
- The cost is charged once per round trip.
- The session-block bootstrap and the Wilson interval are correct.
- DST is handled in `regularSession`, `nyTime`, `chart_points` and `session_day`.
- No duplicate `symbol|detected_at` in any file, no weekend or holiday days, no failed batches in `sip-events`.
- `outcome-relabel.json` reproduces byte-for-byte from `research/study/*.json.gz`.

## Recompute (`node tagit-next/research/recompute-outcomes.mjs`)
This is independent code: it does not import any pipeline summary code. It recomputes:
- `sip-outcomes` from `sip-events`: split, and all 3 parts × 2 labels × 8 fields;
- `paper-ledger` from its raw file: books, $, R, hit rate, exits, statuses;
- `forward-outcomes`: days and totals;
- `outcome-relabel`: 2-minute summary and plan R.

It also checks integrity: duplicates, non-sessions, signals outside the session, entry before
visibility, entry window, horizon, and P&L arithmetic.

- Before the fixes it found 1,841 out-of-session SIP signals and 2 net-R rows that could not be recomputed (4-decimal stops).
- After the fixes: **101 numbers, 0 problems**. `tests/outcomes.test.mjs` enforces this.

## Commits
1. `d14665f2e` outcome-relabel: gap exits at the open, R after cost; data re-derived.
2. `5a61fad92` forward: session-day evaluation, no-overwrite, stop R, regular-only headline, day accounting; workflow; two bogus rows removed.
3. `d23cabf7c` SIP study and paper ledger label/bookkeeping fixes, recompute script and tests; `sip-events`, `sip-outcomes` and `paper-ledger(.raw)` re-derived.

Tests:
- `node --test tagit-next/tests/*.test.mjs`: 143 pass.
- `python -m unittest discover -s tagit-next/pipeline -p 'test_*.py'`: 38 pass.
- `verify-evidence-release.py --local`: passes. No hashed file was changed.

## Open / for the lead
- **Recover Monday 2026-09-28 live alerts.** If the Actions cache `tagit-forward-2026-09-28-*` still exists, dispatch "TAGit NEXT forward record" on main with command=evaluate and day=2026-09-28.
  - The Nasdaq chart has already rolled, so events will be `SOURCE_UNAVAILABLE`.
  - The plan levels are kept, so the paper ledger then re-runs 09-28 and trades the live alerts on SIP bars.
- **Data-file conflicts.** `sip-events.json`, `sip-outcomes.json` and `paper-ledger*.json` are rewritten nightly on main, so they will conflict at merge. If they do, take main's files: the code fixes clean them on the next run (`dropAfterClose` on load; the paper ledger re-runs when a live row appears). Alternatively, re-run the two deterministic steps: drop signals whose bar is not regular, then `buildReport`.
- **J1 (journal horizon and cost)** needs a hash update in `evidence-release.json` by whoever owns the release.
- **UI labels (owner: UI agents).** `forward-outcomes` `plan_mean_r` is now **after cost**, so label it as net. Consider showing `median_net_r` on the paper card.
