# Scheduled-catalyst study (calendar-study-1)

**Verdict.** There is no tradeable run-up into known dates:
- **Earnings:** the run-up is flat.
- **FDA run-up:** strong in development but not confirmed on the holdout.

One thing did hold: an **avoid rule**. Buying after an earnings report that followed a run-up of 10% or more loses money over the next 3 sessions. The site now shows this as a warning.

## Protocol
- **Where it is:** `tagit-next/pipeline/calendar_study.py`. The header holds the hypotheses, timing, costs, split and decision rule.
- **When it was fixed:** committed (7b3bd58ec) before any return was computed.
- **Diagnostics run:** printed data checks only.
- **Amendment 1:** after the diagnostics and before any aggregate return.
  - A decision notice is now detected from the headline only. The broad rule had flagged 754 of 1,737 filings, mostly past approvals of other products.
  - Disclosure: the diagnostics run printed a 15-row sample of individual FDA trade returns by mistake. It was removed.
- **Data:**
  - Prices and SEC filings come from catalyst-study-1's cache: SIP daily bars 2022-11 → 2026-09 for 3,053 Nasdaq symbols, and SEC submissions for 3,101 companies.
  - PDUFA dates come from SEC EDGAR full-text search (8-K/6-K): 1,737 filings, 1,160 with a parseable date, 283 companies.
- **Trades:**
  - Long only, entry at the open and exit at the close of the session before the date.
  - Costs: 0.5 pp per round trip; the sensitivity check uses 1.0 pp.
  - Split: by session. Development is the first two thirds; the holdout starts 2025-06.
- **Statistics:** moving-block bootstrap.

## Results (net % per trade, holdout 95% CI)
| Spec | Dev n / mean [CI] | Holdout n / mean [CI] | Baseline holdout | Holds |
|---|---|---|---|---|
| **E_run5** predicted earnings date, buy 5 sessions before | 5,826 / +0.03 [−1.44, +1.31] | 3,604 / +0.03 [−1.62, +1.80] | −0.30 | no |
| **B_run10** PDUFA date, buy 10 sessions before | 51 / **+7.57 [+0.67, +17.13]** | 41 / +2.05 [−6.50, +10.42] | −0.05 (PDUFA names +1.46) | no |
| Avoid **A**: buy after earnings that followed a ≥ 10% run-up, H3 | 745 / −0.37 | 536 / **−1.40 [−3.01, −0.34]** | | **useful** |
| Avoid **BA**: buy after the PDUFA date, H3 | 54 / +0.02 | 41 / +2.06 [−2.83, +8.20] | | no |

Other findings:
- **Prediction:** a date one year after last year's report falls within 3 days of the actual report 59% of the time, and within 7 days 82% of the time.
- **Oracle earnings date** (the real 2.02 date, as if confirmed in advance): also flat, from −0.49 to +0.32 across horizons.
- **FDA run-up by horizon:** H3 −0.2 / −4.0, H5 +2.8 / −2.0, H10 +7.6 / +2.0 (development / holdout). The longer run-up looked strongest in development. 41 holdout trades are too few to confirm it. The future dates are collected daily, so this can be tested forward.
- **After the PDUFA date:** the stocks did not sell off. Holdout H5 was +5.5 with a CI that includes zero.

## Shipped
- **`data/catalyst-calendar.json`**, built daily by `.github/workflows/tagit-next-catalyst-calendar.yml`. It contains:
  - upcoming earnings for the next 21 days (Nasdaq.com calendar);
  - upcoming PDUFA dates (SEC full-text search, cancelled when an extension is announced, dropped after a decision notice);
  - `after_news`: symbols that reported after a ≥ 10% run-up, still inside the 3-session window.
- **Dossier:**
  - a 📅 note with the date and the study result: earnings show no edge; FDA is unconfirmed and not to be held through the decision;
  - a ⚠ «بيع على الخبر» ("sell the news") warning for avoid rule A.
- **No buy signal was added.**

## Runs
- Diagnostics: https://github.com/tufeeq/ai/actions/runs/37064024448 and https://github.com/tufeeq/ai/actions/runs/37064423209 (after amendment 1)
- Full study: https://github.com/tufeeq/ai/actions/runs/37065026703
