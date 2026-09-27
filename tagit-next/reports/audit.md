# Audit of the TAGit NEXT studies and the live detector (role: audit, 2026-09-27)

Branch `claude/agent-audit`. Commits: `23af8bf6` (fixes, tests, audit checks), `22d384fa` (filter features, live-vs-study check), `0bd1ca5e` (daily-study log). All of `node --test tagit-next/tests/*.test.mjs` pass (67). `evidence-release.json` hash updated for `src/core/sipscan.js`, and `verify-evidence-release.py --local` passes.

Runs (all on `claude/agent-audit`):
- Full daily study, corrected: https://github.com/tufeeq/ai/actions/runs/36309947296 (dispatch, 64 min, 3,548 symbols)
- Audit checks C1–C3: https://github.com/tufeeq/ai/actions/runs/36309718418
- Audit check C4 (live vs study): https://github.com/tufeeq/ai/actions/runs/36309860392
- Push runs: daily 36309718376 and 36309945019, SIP 36309718378, filter 36309860379 (branch smoke runs, not published)

## Bottom line
The "no edge" conclusion **still holds after the corrections**. Two errors made earlier numbers look better or worse than they were:
- The daily study's one "promising" development result (momentum_5d H5, +0.52%) came mostly from a look-ahead universe bug. With the bug fixed, no hypothesis is positive in development, so nothing is selected.
- Picking the intraday universe by today's market cap makes intraday results about 0.3 pp *more* negative than a point-in-time universe would. The complement universe is still negative after costs.

The largest accuracy problem for users is the live tool: **the main list does not show the signal that was studied** (see A6).

## Findings

| # | Severity | Where | Finding | Fix | Conclusion changed? |
|---|---|---|---|---|---|
| A3 | **High** | `pipeline/daily_study.mjs:51` (`eligible`) | The $0.50–$20 price band used **split-adjusted** closes. These prices include future reverse splits: a stock at $0.30 that later does a 1:20 reverse split shows as $6, and a $5 stock that later does a 1:10 reverse split shows as $50 and is excluded. That is look-ahead in the universe. The corrected run found that **258,990 symbol-days** changed band membership, and 452,385 symbol-days had adjusted ≠ raw prices. | Fetch raw and split-adjusted bars. Apply the band on the raw close; returns still use adjusted prices. Test `A3`. | **Numbers yes, conclusion no.** See the table below. |
| A6 | **High (live accuracy)** | backend `quote-service/src/scanner.mjs` (frozen), used by `app.js` scan and `src/core/checks.js` | The main list runs the detector on **IEX** bars. IEX is a single exchange and is the backend default `TAGIT_DATA_FEED=iex`. The list also uses a 90-minute lookback that reaches into pre-market, applies only to a 120-name shortlist, and adds an `extended` filter. Every study used **SIP** bars in the regular session only. Check C4 (3 sessions, study universe) produced 766 SIP signals and **32 IEX signals, of which 4 are exact matches** (17 within 5 minutes). The IEX signals averaged −3.6% (n=30, too few to trust), against −1.10% for SIP. So users see a different, much rarer signal that no study has tested. | Cannot edit the frozen scanner. The recommendation is in "Open items". The SIP list (`sipscan.js`) is the one that matches the studies, and A1 now makes it match exactly. | Nothing studied applies to the IEX list. |
| A1 | Medium | `src/core/sipscan.js:17-19,58` (live SIP window); every study's inclusive `end=16:00` | The detector could see bars outside the regular session. (a) The **live** SIP scan window runs 230 minutes back without session clipping. This showed pre-market and after-hours "signals" the studies never measured, and at 09:30–09:43 pre-market volume served as the baseline. (b) The **studies** asked the relay for `end=16:00`, which is inclusive, so the 16:00 bar (closing cross plus after-hours) came back. **1,841 study signals fired at 16:01** from the closing-auction volume. Another 1,586 fired at 16:00. All 3,427 were untradeable and counted in `signals`/`no_entry`, which is 7.2% of the headline 47,365. Returns were not affected, because labels already excluded bars at or after the close. | `detectSymbol` now uses regular-session bars only (`regularSession`/`isRegularBar`, EDT/EST aware, with early closes). `session()` shares that code. Tests `A1` ×3. | No. The recomputed SIP study has 43,938 signals; resolved counts and means are unchanged: all −0.724, dev −0.648, holdout −0.889. |
| A5 | Medium | `pipeline/filter_study.mjs:88-89` | The `gap` and `day` features used **raw** daily bars. On a reverse-split day a 1:10 split appeared as a +900% gap or day change, which mislabels `gap_up_10`, `gap_small` and `day_*`. | Fetch adjusted bars as well. Compute the gap on adjusted bars, and convert the previous close into today's raw terms with the split ratio from today's open. Test `A5`. | Not re-run (320 min). Only a few rows are affected (split days), and no filter came close to holding (best holdout −0.35%). Very unlikely to change the conclusion. |
| A4 | Low | `pipeline/daily_study.mjs:95,120` | The `holdout_cost_1pp.win_rate` column counted wins at 0.5 pp, not 1.0 pp. | Added a separate 1.0 pp win counter. Test `A4`. | No (display only). |
| A7 | Low | `pipeline/sip_study.mjs:32-38` | The relay was paced at 2.4 s, faster than the ≥3 s rule for the shared 40/min limit. | `RELAY_PACE_MS`, minimum 3 s. | No. |
| A8 | Low | `sip_study.mjs:25` (`DELAY` 17 min) vs `app.js` `SIP_INTERVAL_MS` + `sipscan.scanWindow` | In the live SIP list a signal becomes visible after 16.5 minutes plus up to 5 minutes (bucket) plus up to 5 minutes (scan interval): 16.5–26.5 min, mean about 21.5. The "delayed" label assumes 17. | Not changed. A delayed variant at 22 minutes should be reported. | Unlikely to matter: both entry timings are negative. |
| A9 | Low (protocol) | `sip_study.mjs:182-186` | The SIP holdout is a *rolling* last third (the latest 250 sessions, cut at 2/3). Each new session moves days from holdout to development. That is acceptable for descriptive reporting, but a rule selected on today's development split will later be "tested" partly on days that were already seen. | Not changed. When a rule is selected, freeze `holdout_from` as a date. | No. |
| A10 | Info (bias, not fixable for free) | `sip_study.mjs:53`, `daily_study.mjs:180` | Intraday universe = **today's** names below $100M, applied back to January. That selects names that fell. Check C3 (10 sessions, Feb 2026) on the point-in-time complement (1,201 Nasdaq names not in today's list, previous-month median price $0.50–$20, ADV ≥ $300K): the complement averaged **−0.49%** after 0.5 pp (n=4,728, win 30.5%, every day negative, −0.19 to −0.83), versus **−0.81%** for the study universe on the same sessions (n=2,101). The bias makes results worse by about 0.3 pp, but the complement is about 0 gross and still negative net. The daily-study universe also misses Nasdaq names that now trade OTC (Alpaca lists them as active OTC). Those names are mostly losers, so the true baseline is if anything worse. | Documented. | The direction is noted. **Conclusion unchanged**: bursts do not pay after costs even in the complement. |

### Verified correct (no bug found)
- **No look-ahead or same-bar entry.** The decision time is the close of the signal bar (`t+60s`). Entry is the *next* bar's open, within 2 minutes (test `A2`). Exits use the close of the last bar that starts before the horizon.
- Stop before target within a bar. A gap through a stop fills at the open. Cost is charged once per round trip, including the half exit (test).
- There is no cost double-counting in the SIP, exit, filter or daily studies. Win rate is defined as net return > 0.
- DST: `session()` handles EST/EDT and the March 2026 switch (test). There are no half-days inside the 2026 SIP sample. Early closes are now handled anyway.
- The 2/3–1/3 split is by sessions (`floor(2n/3)`). The bootstrap resamples whole sessions and uses a ratio of sums. Percentile indices are off by at most one draw (negligible).
- SIP coverage: 789–823 of 823 symbols had bars on every session, and failed batches were 0. The 10-page cap per batch is never reached (at most about 4 pages). Missing minutes mean no trades, and the label carries the last trade forward correctly.
- SIP headline with a session-block 95% CI (computed here from `sip-events.json`): holdout at detection −0.889% [−1.007, −0.776]; delayed −0.793% [−0.916, −0.679]; development −0.648% [−0.731, −0.567]. Holdout gross (before 0.5 pp) is about −0.39%.

## Independent check of a headline number (C1/C2)
Twelve names (AAPL … AEHL) over 22 sessions, SIP 1Day bars compared with SIP 1Min bars aggregated by hand:
- The daily **open equals the first regular-session trade** (median difference 0; within 0.1% on 84% of days), so "entry at next open" is the opening print. The daily high and low are regular-session only (100%). The daily close is the official close, with a median 0.08% difference from the 15:59 bar. Daily **volume includes extended hours** (median 1.13× regular volume), so the $300K ADV filter is slightly loose (minor).
- The **H1 baseline recomputed from minute bars** (first regular open to last regular close, 0.5 pp) matches the daily-bar computation: **−0.082% vs −0.122%** over the same 195 symbol-days. The differences are concentrated in auction prints of illiquid names (AEHL).

## Daily study, corrected (run 36309947296, 3,548 names incl. 556 delisted, 935 sessions, holdout from 2025-06-30)

| | published dev | published holdout | corrected dev | corrected holdout [95% CI] |
|---|---|---|---|---|
| baseline H1 | −0.552 | −0.542 | −0.626 | −0.585 [−0.759, −0.426] |
| baseline H5 | −0.154 | −0.306 | −0.566 | −0.535 [−0.910, −0.147] |
| momentum_5d H5 | **+0.521** | −1.105 | **−0.226** | −1.640 [−2.566, −0.829] |
| gap_hold H5 | +0.669 | −3.033 | −2.220 | −4.874 [−6.933, −2.642] |
| spike_pullback H5 | +4.632 | −9.589 | −1.601 | −10.982 [−13.937, −8.267] |
| quiet_breakout H1 | −0.842 | −0.930 | −1.011 | −1.006 [−1.332, −0.700] |

Selected on development: published `momentum_5d H5`; corrected **none**, because no hypothesis or horizon is positive in development. `holds=false` in both. Every "positive in development" row in the published table disappears once the price band is point in time. The earlier "dev +0.52% → holdout −1.11%" story reads as overfitting, but it was partly a universe artefact.

## Open items for the lead
1. **Live list (A6).** Either run the main list's signal on SIP data (the delayed SIP list, which is what was studied), or label the IEX list clearly as an *unstudied* signal. The backend scanner is frozen, so this is the owner's call. Do not describe IEX-list alerts using the SIP study's numbers.
2. Publish the corrected `daily-study.json`. The artifact is on run 36309947296. Workflows publish only from main, so merging this branch and re-dispatching on main publishes it.
3. Re-run the filter study (A5) on main when the relay has capacity. This is optional; the conclusion is not expected to change.
4. Report the delayed label at the true mean visibility delay of about 22 minutes (A8). Freeze `holdout_from` before any future rule is selected (A9).
