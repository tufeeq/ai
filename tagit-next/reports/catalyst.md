# Catalyst (SEC filing) study — role: catalyst

**Verdict: no tradeable catalyst edge.** None of the 6 pre-registered primary specs held on the holdout. The one secondary cell picked on development (insider cluster buys, long H10) also failed. The only thing that passed its pre-registered rule is an **avoid** flag (dilution risk). It is not a trade, and it showed no effect in development. It ships as a warning in the dossier.

## What was done
- `tagit-next/pipeline/catalyst_study.py` (protocol **catalyst-study-1**). The hypotheses, horizons, costs, split and decision rule sit in the file header. They were committed (9409d2f59) before any return was computed; the first run printed only data diagnostics.
- Tests: `tagit-next/pipeline/test_catalyst_study.py` (12 tests). They cover timing and entry, eligibility, events, insider clusters, point-in-time dilution flag, ticker-reuse ownership, bootstrap, the verdict rule, and an end-to-end synthetic run.
- Workflow: `.github/workflows/tagit-next-catalyst-study.yml`. It runs tests, restores the cached data artifact, runs the study and uploads cache and results.
- Data (free only):
  - SEC submissions JSON for 3,101 companies: form, 8-K items, acceptance time.
  - SEC insider-transactions data sets 2022Q4–2026Q1. 2026Q2 and Q3 are not published yet, so the insider holdout ends around 2026-03.
  - XBRL cash (companyconcept).
  - Relay SIP daily bars (split-adjusted), 2022-11-15 → 2026-09-24. There are 3,548 Nasdaq listings (556 inactive); 3,053 have bars in the window.
  - Relay pacing was 3.2 s per request; the data is cached as an artifact.
- Timing:
  - Entry is at the open after EDGAR acceptance: the same session if accepted before 09:15 NY, otherwise the next session.
  - Form 4 events enter at the first session after the filing date.
  - Eligibility is judged on the bar before entry ($0.5–20 close, ADV ≥ $300K).
  - Costs are 0.5 pp round trip plus 0.1 pp per session borrow on shorts. The sensitivity case uses 1.0 pp and 0.3 pp per session.
  - The split is by session: 935 sessions, development 623, holdout 312 from 2025-06.
  - Confidence intervals come from a moving-block bootstrap (block of 10 sessions, 2,000 draws).

## Results (net of costs, % per trade; holdout 95% CI)
| Primary (pre-registered) | Dev n / mean | Holdout n / mean [CI] | Baseline holdout (same dir/H) | Holds |
|---|---|---|---|---|
| P1 offering (424B1/4/5) SHORT H5 | 979 / −0.78 | 969 / **+1.66 [+0.35, +3.31]** | −1.20 | no (dev < 0; Bonferroni LB −0.13) |
| P2 insider cluster buys LONG H10 | 683 / +3.14 | 225 / +1.64 [−1.92, +4.52] | −0.05 | no |
| P3 8-K 1.01 without financing LONG H5 | 1036 / −0.42 | 798 / −1.02 [−2.22, +0.13] | −0.30 | no |
| P4 8-K 3.01 delisting notice SHORT H5 | 467 / −2.01 | 391 / +0.33 [−1.71, +3.25] | −1.20 | no |
| P5 earnings gap-up ≥5% fade SHORT H3 | 1036 / −3.07 | 603 / −0.63 [−1.73, +0.55] | −0.89 | no |
| P6 dilution flag SHORT H10 | 36,449 / −2.22 | 55,214 / +0.05 [−1.92, +2.18] | −1.95 | no |

- **Secondary selection:** insider_cluster long_H10 was the best development lower bound (+0.90). On the holdout it was +1.64 with CI [−1.92, +4.52], so it does not hold.
- **Regime flips seen in the grid:**
  - Earnings gap-up LONG was positive in development (H1 +0.95, H5 +2.18) and negative in holdout (H1 −0.99, H5 −0.18). This is the same flip seen in the price-pattern studies.
  - Offering SHORT is only positive in the holdout (H5 +1.66, H10 +2.43). It is negative in development and does not survive 1.0 pp + 0.3 pp/session borrow (+0.16 / −0.07). In any case, post-offering small caps are often hard or impossible to borrow.
- **Robust negatives, useful as avoid rules:**
  - Buying after an offering: long H5 holdout −3.16 [−4.80, −1.84]; H10 −4.43.
  - Buying after an earnings gap-down: H5 dev −1.71, holdout −1.30 [−2.42, −0.27].
  - Buying after a delisting notice: H1 −0.91 / −1.51.
- **Dilution avoid filter (pre-registered form of P6):** flagged minus unflagged, long H10.
  - Development: −0.09 pp, CI [−1.61, +1.64].
  - Holdout: **−2.56 pp, CI [−3.98, −1.07]**.
  - This meets the pre-registered "useful" rule (holdout CI below 0 and development point below 0). The development effect is essentially zero, so treat it as a regime-dependent warning, not an edge.
- **Baseline** (every eligible stock-day): long H1 −0.54, H5 −0.30, H10 −0.05 in holdout.

## Integrated (branch only; the lead merges)
- `pipeline/enrich.py` now emits `dilution` per symbol:
  - the latest S-1/S-3/F-1/F-3 in the last 365 days;
  - the count and date of 424B1/4/5 priced offerings in the last 12 months;
  - latest XBRL cash, with a stale flag;
  - 1-year change in shares outstanding.
  - Levels: HIGH (registration and cash < $10M, the P6 definition) or WATCH (registration, repeated offerings, or shares +50%).
  - Tests are in `test_enrich.py`; enrichment run 36309767578 succeeded.
- `src/core/risk.js`: `dilutionOf()` adds a DILUTION risk item (Arabic RTL). HIGH items carry the study caveat.
- `src/views/dossier.js`: the company stats now include "النقد المعلن" (reported cash) and "تغير الأسهم خلال سنة" (change in shares over a year).
- Evidence hashes updated; `verify-evidence-release.py --local` passes and `node --test` passes 60/60.
- No catalyst buy or sell tag was added, because nothing held.

## Still open / caveats
- Delisted coverage is thin: only 61 inactive symbols have bars in the window (55 mapped to a CIK). The Alpaca inactive list mostly holds older delistings, so some survivorship bias remains.
- Earnings timing: many 8-K 2.02 filings follow a press release that came earlier, so entry is late (conservative).
- Not done:
  - Alpaca news (relay budget);
  - FINRA short interest as a history;
  - reverse splits (no clean timestamped free source);
  - 13D/13G.
- `data/catalyst-study.json` exists only as the run artifact because the workflow publishes on main only. The full grid is printed in the run log (`GRID` lines).

## Runs
- Data fetch and diagnostics: https://github.com/tufeeq/ai/actions/runs/36309661477 (cache artifact 10929033541)
- Full study: https://github.com/tufeeq/ai/actions/runs/36314921167
- Enrichment with the dilution block: https://github.com/tufeeq/ai/actions/runs/36309767578
