# Review: secondary surfaces (Market Insights, Journal, Lab, evidence page), 2026-09-29

Agent 4 of 5. Method: served this checkout locally in Playwright/Chromium (390 and 1360–1440 px, light and dark)
with the quote service mocked by `page.route` and the committed `data/*.json` files. I used each surface as a trader
would, took screenshots, checked the numbers against their source files and the rules in `pipeline/insights.mjs`,
and tested the error and empty states (404, invalid JSON, stale data).

## Issues and fixes

| # | Surface | Issue | Sev. | Evidence | Fix |
|---|---|---|---|---|---|
| 1 | Evidence page | The page led with the phase-1 figure "84 of 322 signals, −1.43%". `outcome-relabel-1` superseded that biased number (295/322, −0.58%). The page also left out every later study: 47,539 SIP signals, exits, 332 filters, the daily study, the fade study and the paper ledger. | High | `performance.html` screenshot; `phase1-evidence.json` against `data/outcome-relabel.json` and `data/sip-outcomes.json` | Rebuilt the page. It has a headline KPI row computed from `data/*.json` (`evidenceSummary` in `phase2-view.mjs`): SIP holdout −0.90% on 14,929 signals, best exit −0.71%, 0/332 filters held, paper ledger −$933 over 60 trades. It states plainly that no rule held, and names the one finding that did (avoid extended names, −1.04% over 5 days in the holdout). All studies render through the workspace's `renderEvidence`. Phases 1 and 2 moved to a labelled archive. |
| 2 | Methodology (market tab) | `phase1.js` appended the stale "−1.43% on 84 evaluable" note inside the same section that shows the corrected −0.58%. Two contradictory baselines appeared side by side. | High | `phase1.js`, `index.html` `.method details` | `phase1.js` now only adds a link to the evidence page. |
| 3 | Evidence page | The page had no styling: no topbar or container, the saved theme was ignored, and there was no dark mode. | Med | screenshot | Added the app topbar and navigation, applied and saved the theme, and removed horizontal overflow at 390 px (it was 489 px). |
| 4 | Insights · calendar | Economic events were shown 4 h early. Nasdaq's `gmt` field is New York time (Dallas Fed "10:30", bill auctions "11:30", Singapore IP "01:00" = 13:00 SGT), but the pipeline read it as UTC. | High | `data/insights.json` calendar; UI showed "Dallas Fed 06:30" | `parseEconomic` converts the time with `nyTime`. |
| 5 | Insights · calendar | The rows belong to another day. The file built at 01:35 ET on 09-29 lists Monday's releases (Dallas Fed 9.8, 3/6-month bill results) under Tuesday, with actual values before those releases could have happened. | High | `run.diagnostics`, `calendar.economic` | Pipeline: `economicDayMismatch` drops these rows and adds a note. UI: `economicRows` rejects them in files that are already published, so the live file stops showing them. |
| 6 | Insights · themes | "Biotechnology … average move +31.3%": KOD at +178% drives the mean while 2 of 4 names fell 19–30%. | Med | `themes[0]` | Themes now show the median and the range (`median_move_pct`, `min/max_move_pct`). `avg_move_pct` stays for the contract. |
| 7 | Insights · news | HTML entities showed on screen ("Goldman Sachs&#39; board"). | Low | news summary | `plainText`/`decodeEntities` decode the text once in the pipeline. The page still escapes on render. |
| 8 | Insights · industries | The large number was the cap-weighted change, but the list is ranked by median. The "weakest" list read −5.35, −5.44, −2.95, −4.77 … and Textile showed +0.13% while ranked 4th strongest. | Med | screenshot against `industries.top/bottom` | The large number is now the ranking metric (median). The cap-weighted change moved to the meta line. |
| 9 | Insights · movers | On desktop the half-width card scrolled the table sideways, so the "خبر" (news) column was off-screen. | Med | screenshot | Moved the news column right after "التغير" (change). |
| 10 | Insights · pulse | The ETF cards were stamped with the Finviz snapshot time (21:56) but credited to "Alpaca SIP daily bars". | Low | `pulse.as_of` against `bars_as_of` | The stamp now uses `bars_as_of`, and the last daily close date is shown. |
| 11 | Insights · header | "السوق مغلق" (market closed) was the state when the file was built, but it read as the current state. The page showed "closed" during pre-market. | Low | screenshot at 07:53 ET | Label changed to "عند إنتاج الملف" (when the file was produced). |
| 12 | Insights · breadth | The "قمة ٢٠ يومًا" (20-day high) tile is always "—" because the pipeline never fills it. | Low | `new_high_20d: null` | The tile is hidden while the value is null. |
| 13 | Journal | After you deleted today's manual record for a watched symbol, the next scan recreated it from a new start price within about 30 s. This rewrites the user's own record. | Med | Browser: count 0 → 1 after 35 s | `removeEvent` also removes the symbol from the watchlist, and the toast says so. |
| 14 | Lab | `lab.css` uses `--green/--amber/--panel/--red/--soft`, which the NEXT `style.css` does not define. The primary "تحديث الحالة" (refresh status) button was invisible and cards had no background. | High | screenshot | The tokens now alias the theme on `body`, so dark mode also works. |
| 15 | Lab | The iframe grew with no limit. `body{min-height:100vh}` combined with the posted body height + 12 px created a feedback loop. | High | Frame height 2,823 → 6,433 px in 6 s (cap 10,000) | Height is now measured from `<main>`, and the lab body has `min-height:0`. The frame holds at 1,850 px. |
| 16 | Lab | The tab is empty. `lab/results/summary.json` has no results and `connection.status` is `CONNECTION_FAILED`. Hijri/Riyadh dates and Arabic-Indic digits differ from the rest of the site. | Med | `summary.json` | Added a note linking to the evidence page, where the finished studies are. Dates now use New York time and Latin digits. The empty lab is expected: the tagit-lab research track has not published results. |

## Verified to work, no change needed
- Regime: score +1 (SPY above its 50- and 200-day averages, QQQ above 50, IWM below 50, A/D 0.44 negative), so "mixed" is correct under regime-1.
- Breadth: 1,422 + 3,246 + 99 = 4,767, and 29.83% up matches.
- Sectors are cap-weighted and consistent with the ETF moves. Industries meet the ≥ 5 stocks rule. Movers follow their definitions (price ≥ $1, cap ≥ $50M, ≥ $1M traded; unusual volume = RVOL ≥ 3 and ≥ 300K shares).
- Sorting and filtering work: sector sorts, the three mover tabs, news filters by sector/industry/symbol (focus kept), and theme → news filter.
- Error states: 404 and invalid JSON show an honest error. Stale sections are flagged after 08:00 ET for the 10-hour-old file, which is correct.
- Journal: add, export (JSON with every field) and persistence across reload work.

## Out-of-scope edits (minimal)
- `app.js`: toast text for the journal deletion (one statement).
- `src/state.js`: `removeEvent`.
- `index.html`: cache-bust query on `workspace-tabs.mjs`.

## Still open
- `evidence-release.json` was not touched, as instructed. The lead must refresh the SHA-256 of: `index.html`, `app.js`, `src/state.js`, `src/core/insights.js`, `src/views/insights.js`, `workspace-tabs.mjs`, `lab/index.html`, `lab/lab.mjs`, `lab/lab.css`, `phase1.js`, `performance.html`, `performance.js`, `phase2-view.mjs`. `verify-evidence-release.py --local` fails until then.
- The committed `data/insights.json` still holds the wrong-day calendar. The UI hides it, and the next pipeline run on main after the merge regenerates the file correctly.
- Opening a large-cap mover (e.g. KOD at $5.7B) from Insights leads to an empty "—" dossier, because it is outside the scanner universe. This belongs to app/dossier (agent 1).
- The `.evidence` grid overflows at phone width inside the market tab's methodology section too. I fixed it only on the evidence page; the shared CSS belongs to agent 5.
- The Lab can only show results once the `tagit-lab.yml` research job publishes them. `/api/performance` on the Railway service is not a verified surface: the page says so rather than showing zeros.

Tests: `tests/surfaces.test.mjs` (7 tests). `node --test tagit-next/tests/*.test.mjs tagit-next/phase2-view.test.mjs`: 146 pass.
