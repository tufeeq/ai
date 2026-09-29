# Review: the market workspace from a small-cap day trader's seat (2026-09-29)

Role: agent 1 of 5. Scope: list → dossier → analysis, plan, calculator, news, outcome chart.

## Method
- Served `tagit-next/` locally and drove it in headless Chromium (Playwright). The page clock was set to the scenario time.
- Every call to the quote service (`live-config.json` → `https://ai-production-85c7.up.railway.app`) was answered by mocks. The mocks follow the backend shapes on `tagit-next-independent-20260914`: `scanner.mjs` rows, `http.mjs decorate` (halt and consolidated overlay), `market.mjs` quote rows, and `/api/live` returning 404.
- Scenarios: market open with fresh data, stale quotes (20 min), pre-market (08:30 ET), Saturday, 503 errors, and an empty scanner.
- Rows in the mocks: a good plan, a tight-stop plan, a confirm-only row, an extended row, a halted row, an old print, a consolidated-overlay row, a sub-dollar row and a row with no signal.
- I read the screenshots and checked the DOM text.

## Issues

| # | Sev | Issue (evidence) | Status |
|---|---|---|---|
| T1 | **High** | **A plan was advertised while the execution gate blocked it.** The tight-stop row (0.6 % stop, estimated cost 0.84 R) showed «خطة مشروطة» in the list, passed the «خطة مستوفية» filter and counted in the «خطط مشروطة الآن» KPI. The dossier overview said «كل الشروط مستوفاة الآن، والخطة صالحة». The plan tab of the same stock said «غير قابل للتداول الآن». The journal also recorded the plan. | Fixed. `assessRow` computes the gate with the assessment. A plan the gate blocks becomes state `BLOCKED` («غير قابل للتنفيذ») in every view. The dossier reads `a.gate`. |
| T2 | **High** | **Pre-market and after-hours plans were offered with a working calculator.** They only carried a "caution". The plan is a stop entry with a stop exit, and most brokers do not trigger stop orders outside the regular session. Every study covered the regular session only. | Fixed. PRE/AFTER is now a BLOCK reason in `tradeability.js`. |
| T3 | Medium | **The calculator dropped Arabic-Indic digits.** On an Arabic keyboard, typing `١٢٥٠` gave capital `12` and `٤٫٥` gave risk `4`. Position sizes were silently wrong. | Fixed with `cleanAmount` in `sizing.js`. |
| T4 | Medium | **A stale spread was shown and costed as current.** With a 20-minute-old quote, the gate showed "spread 0.20 % · 0.13 R" next to «لا عرض وطلب حديث». | Fixed. The gate's spread is null unless the quote is fresh. |
| T5 | Medium | **Quote rotation wrapped mid-list** (cursor `% length`). With 25 rows, rows 0–6 (the top-ranked) were skipped on most rounds and went stale sooner. | Fixed. The cursor now restarts at 0. |
| T6 | Low | **Auto-selection opened the halted stock.** It took the first row of the unsorted order, not the first row the list shows. | Fixed with `displayOrder`. |
| T7 | Low | **The empty list looked broken.** The message sat under the list's 320 px minimum height, out of view. It always blamed the filters, even when the scan itself was empty. | Fixed. The message now renders inside the list and gives the reason: empty scan, filters, no connection yet, or all rows extended. |
| T8 | Low | **The VWAP check showed `$2`** for $1.95, next to a $2.00 price, because of compact formatting. | Fixed. |
| T9 | Low | **The plan tab labelled bid/ask "IEX" even for consolidated quotes.** It had no age, and its spread came from the raw row. | Fixed. It now shows source and age, and the spread comes from the gate. |
| T10 | Low | **Outcome chart:** the start-time axis was clipped by the RTL direction, and the start and last price tags overlapped. The ladder labelled a stale price «الآن». | Fixed. |
| T11 | Low | The calculator was disabled without a plan, so limits could not be preset. A row with no signal showed «—×». | Fixed. |

## Not fixed: other owners or needs a decision
- **HALT row meter reads 12/12** (and shows fresh trade dots) while halted. The check logic belongs to agent 2 (`checks.js`); the state badge and gate do block it.
- **Day change on weekends and pre-market** shows «—» when the relay's SIP closes are unavailable. The server nulls `previous_close` for prices from an earlier session. This is correct, but the page gives no reason.
- **Exchange holidays** read as trading sessions (documented limitation). The gate would say "stale", not "closed".
- **Tier label:** «الأعلى استيفاءً» still lists BLOCKED rows (≥ 8/12). Its hint says it is no guarantee of entry. Excluding them is a product call.
- **Error state:** with the service down, the page makes many relay requests (SIP scan and closes) in the first seconds. This is resilience work (agent 5).

## Files changed
`app.js`, `src/state.js`, `src/core/tradeability.js`, `src/core/sizing.js`, `src/views/{dossier,list,charts,common}.js`, `style.css` (one line: `.s-BLOCKED`), and the new `tests/trader.test.mjs` (12 tests).

`node --test tagit-next/tests/*.test.mjs tagit-next/phase2-view.test.mjs`: 151 pass.

**Lead:** the SHA-256 hashes in `evidence-release.json` must be updated for all of these files except the tests. I did not edit that file.
