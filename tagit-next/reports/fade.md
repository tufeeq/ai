# Fade study (role: fade) — fade-study-1

Branch `claude/agent-fade` (from `claude/github-projects-list-g09w0q`). Research evidence only; nothing places orders.

## Verdict
- **Short fade: does NOT hold.** No short survives 0.5 pp plus borrow. Only one of 20 event × horizon combinations was even positive in development, and it was flat on the holdout.
- **Long-side "don't buy" flag: HOLDS on the pre-registered test, but it is fragile.** On the untouched 2018–2022 holdout, stocks bought after an extended move did about 1 pp worse over 5 sessions than every other eligible stock-day. The sign was reversed in 2023 → mid-2025. It is on the site as a clearly labelled warning, not as a signal.
- **"Exit if you hold" test: does NOT hold.** The flagged gross forward return is negative, but its CI crosses 0.

## Protocol (fixed in the header of `pipeline/fade_study.mjs` and committed in 643476cc6 before any result)
- **Why the split is different.** The fade idea came from daily-study-1's own 2023–2026 results, including its holdout. So 2023-01-03 → 2026-09-24 is **development** (already seen). The **holdout is 2018-01-02 → 2022-12-30**, which no TAGit study had examined. The brief's usual 2/3 : 1/3 split inside 2023–2026 is reported too, labelled contaminated.
- **Universe.** 3,548 Nasdaq common listings, 556 of them delisted. SIP split-adjusted daily bars from 2017-11 to 2026-09.
- **Eligibility** is point in time: $0.50–$20, 20-day average dollar volume ≥ $300K.
- **Events.** strong_close, gap_hold and momentum_5d are the daily-study-1 rules. spike_50 is a day return ≥ 50% with dollar volume ≥ 3× average. extended_any is any of the four.
- **Short trade.** Short at the next open. Cover at the close after H = 1, 3, 5 or 10 sessions. Stop at 25% above entry with 2% slippage; if the price gaps through the stop at the open, the cover is at that open. A delisted name is covered at its last close.
  - Costs: 0.5 pp plus borrow at 50%/yr by calendar days. Sensitivity: borrow 0–300%/yr and stops none/15/50%.
  - Selection: highest development CI lower bound among positive means.
  - Holds only if the holdout CI lower bound > 0 AND the holdout mean > 0 at 100%/yr borrow.
- **Avoid test.** Flagged (extended_any, H5) minus unflagged eligible stock-days, compared on the same sessions. Session-block bootstrap. Holds if the holdout CI upper bound < 0.

## Results (run 36309647828; rerun 36315080912 from cache reproduced them exactly)

### Short side at primary costs, holdout 2018–2022
| event | H1 | H5 | H10 |
|---|---|---|---|
| strong_close (446) | +0.11 [−1.12, 1.40] | −0.58 [−2.48, 1.26] | −1.94 |
| gap_hold (939) | −0.94 | −3.09 [−4.43, −1.61] | −5.06 |
| momentum_5d (4,444) | −0.46 | −0.82 [−1.57, −0.18] | −3.66 |
| spike_50 (306) | +0.02 | −1.03 | −1.95 |
| extended_any (5,428) | −0.59 | −1.21 [−1.88, −0.57] | −3.77 |

- **Selected configuration:** strong_close H1.
  - Development: +0.02% [−0.72, 0.74] on 1,061 trades.
  - Holdout: +0.11% [−1.12, 1.40].
  - At 100%/yr borrow it is −0.02%. **Does not hold.**
- **Borrow sensitivity** (holdout, 25% stop), mean %:

  | borrow %/yr | 0 | 20 | 50 | 100 | 300 |
  |---|---|---|---|---|---|
  | mean | +0.25 | +0.20 | +0.11 | −0.02 | −0.57 |

- **Tails, extended_any H5 with the 25% stop:**
  - Development: worst trade −216%; P(loss > 50%) = 0.4%; P(loss > 100%) = 0.1%; stop hit 21% of the time.
  - Holdout: worst trade −83%.
  - The stop cannot prevent losses above 100% when the price gaps or a halt reopens above it.
  - Without a stop, the worst strong_close H1 trade was −94% (holdout) and −73% (development).
- **Per year** (selected configuration): results swing between −1.9% (2026) and +2.2% (2018), with no stable sign.
- **Easy-to-borrow flag** (current flag, not point in time): no consistent difference.

### Long-side avoid flag (extended_any, H5)
| period | flagged net | unflagged net | difference [95% CI] |
|---|---|---|---|
| development 2023–2026 | −0.20% | −0.22% | +0.02 [−0.56, 0.63] |
| **holdout 2018–2022** | **−1.20%** (5,428 trades) | −0.16% (744K) | **−1.04 [−1.72, −0.31]** |
| contaminated dev (2023 → mid-2025) | +0.77% | −0.16% | +0.93 [+0.13, +1.84] |
| contaminated holdout (mid-2025 → 2026) | −1.33% | −0.30% | −1.03 [−1.80, −0.20] |

- **Exit test:** holdout gross forward return is −0.70% [−1.39, +0.09], so it does not hold.
- **Diagnostics** (not part of the pre-registered test): strong_close and spike_50 are worse than baseline at H10 in both eras (holdout −3.8 and −5.0 pp). gap_hold is not.

## What the trader can use
- **Do not chase.** Buying a Nasdaq small cap in the 5 sessions after an extended day (any of the four events) cost about 1 pp more than a random eligible pick on the untouched holdout.
- **Do not short it either.** The expected drift is smaller than the round-trip cost plus borrow plus stop slippage. The tail includes losses above 100%.
- **Treat the flag as a warning.** It had the opposite sign in 2023 → mid-2025, so it is regime-dependent.

## Integrated (commit 33cf1eada)
- **`src/core/fade.js`**: the same rules as the pipeline, checked by a parity test on random series. `fadeWarning()` covers a 5-session window.
- **Dossier warning.** `src/views/dossier.js` shows `fadeBanner`, an Arabic RTL warning that states the evidence, the reversal in 2023–2025, and that the result does not support shorting.
- **Evidence card.** `src/views/evidence.js` has `fadeCard`, covering both verdicts, the eras, tails and borrow sensitivity. `app.js` loads `data/fade-study.json` and `data/fade-flags.json`.
- **Pipeline flag mode.** `pipeline/fade_study.mjs --flags` builds the daily flag list, about 32 relay requests. The latest list, as of 2026-09-25, has 53 symbols.
- **Workflow** `.github/workflows/tagit-next-fade-study.yml`:
  - runs tests, restores the bar cache, runs the study, saves the cache (`fade-bars`, 75 MB, 30-day retention), builds the flags;
  - publishes to main, or back to the `claude/**` branch that ran it;
  - a weekday schedule at 21:41 UTC refreshes the flags once the workflow is on main.
- **Checks.** Tests: `tests/fadestudy.test.mjs` and `tests/fadecard.test.mjs`; all 70 tests pass. The evidence-release hashes are updated and `verify-evidence-release.py --local` passes.
- **Relay load.** The full fetch was 615 requests paced at 3.2 s over 80 min. Reruns make 0 bar requests.

## Still open / limitations
- **Price band.** Split-adjusted prices make the price band slightly forward-looking for names that later reverse-split.
- **Survivorship.** Delistings before about 2020 may be missing from the asset list. That biases the study against shorts and affects both sides of the avoid test.
- **Bars, not fills.** These are daily bars, not fills. The data has no locates, SSR, halt timing or borrow recalls.
- **Deployment.** The lead has to merge for the scheduled flag refresh and the Pages deploy.
