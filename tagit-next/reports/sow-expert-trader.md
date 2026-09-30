# TAGit NEXT: Scope of Work from an expert small-cap trader (2026-09-30)

Reviewer role: senior small-cap momentum and day trader. The brief was to assess the tool as decision support and list every change needed before relying on it.
Code reviewed: `main` @ `258d7ff9b` (the same code serves https://tufeeq.github.io/ai/tagit-next/). `verify-evidence-release.py --local` passes (47 files). `node --test`: 185/185 pass.

**Method.**
- I served `/home/user/ai` locally and drove the page with Playwright/Chromium. The page clock was pinned to each scenario time.
- All backend calls were mocked in backend shapes, including the relay: synthetic SIP 1-min bars that trigger the real detector, and SIP daily closes.
- Mock rows use **real symbols**, so the real `data/enrichment.json` and `data/fade-flags.json` apply: ABTS clean, ADBT HIGH dilution, ADGM deficient/−14%, AIFF fade-flagged, ACTU +85% gapper, ADIL halted (LUDP), AEMD sub-dollar, ACCL wide spread.
- Scenarios:
  - 10:42 ET open
  - 09:36 ET gap-and-go
  - 08:30 ET pre-market
  - 15:40 ET power hour
  - Thanksgiving 2026-11-26
  - phone at 390 px
- Screenshots are in the session scratchpad at `scratchpad/sow/shots/*.png` and are cited by name below. I read every one.
- No code was changed. Nothing was committed.

---

## (a) Executive verdict

**Would I use it for real decisions today? Not as an entry tool. Yes, with limits, as a risk and "do-not-touch" checklist.**

**What it is good for today (use it):**
- **Pre-trade hygiene on a name I already found elsewhere.**
  - SEC dilution and shelf status, with cash on hand (ADBT: "cash $1.5M, 424B3 2026-09-09, HIGH dilution").
  - Nasdaq deficiency status.
  - FINRA short interest, with its settlement date.
  - The fade-study "extended in the last 5 sessions" warning.
  - Halt status.
  - A cost- and liquidity-aware position calculator. It is honest about spread, impact and stop slippage.
- **Honesty.** The research layer is unusually honest. Every long signal tested lost money after costs, and the site says so. That is worth preserving above everything else.

**What it must not be used for (today):**
- **Taking the green "خطة مشروطة / conditional plan" as an entry.**
  - The main list runs an **unstudied IEX signal** (audit A6).
  - It has produced **0 regular-session alerts** in both recorded forward days. The only live alert, BKYI, fired at 09:10 ET pre-market (`data/forward-outcomes.json`).
  - It is still presented with "كل الشروط مستوفاة الآن، والخطة صالحة" (all conditions met, the plan is valid) in a green card (`open-good.png`).
- **Gap-and-go, halt-resumption, or opening-range trading.** There is no gap scanner, no pre-market high or low, no HOD/LOD, no session VWAP, no RVOL-by-time-of-day, no LULD bands and no halt-resume logic. A +85% gapper with an FDA headline is **hidden** from the default list at 09:36 (`gap-list.png`).
- **Short-side decisions.** SSR is shown only while the price is ≤ −10%, and it is never "inactive" or "carried from yesterday". There is no borrow or locate data, and no LULD.
- **Any statistic as an edge.** The paper ledger has one session, the live book has 0 trades, and the SIP study is negative in every bucket.

**Bottom line.** The engineering is careful, and the honesty layer is excellent. The product premise ("find early buys in <$100–300M Nasdaq names from a 3-minute burst") is refuted by the tool's own evidence. The only robust findings are *avoid* rules:
- don't buy after extended moves;
- don't buy after offerings or dilution;
- don't buy after gap-downs or delisting notices.

**I would pivot the product** from "find buys" to a **risk, avoid and awareness workstation plus a journal.** Its core would be:
- a gapper and halt board;
- a dilution and SEC-filing clock;
- a fast "why not to touch this" verdict;
- a disciplined post-trade journal.

The burst signal should stay only as a *forward-tested research track*, clearly labelled.

---

## (b) Findings

Severity is from a trader's seat. "Open" means it was listed as open in `reports/review-*.md` and I re-verified that it is still open.

| ID | Area | Sev | Evidence | Trader impact |
|---|---|---|---|---|
| F1 | Signal/honesty | **Critical** | `src/views/common.js:90,100`: READY = «خطة مشروطة» / «كل الشروط مستوفاة الآن، والخطة صالحة». `list.js:15` gives no "unstudied" label. `open-list.png` shows 4 green «خطة مشروطة» badges and the KPI «خطط مشروطة الآن 4». The IEX list signal is unstudied (audit A6: 32 IEX vs 766 SIP signals, 4 exact matches), and the forward record has 0 regular-session alerts. **Open (A6).** | A green "plan available" card is read as a buy. It is the single most dangerous element in the UI. |
| F2 | Signal/premise | **Critical** | `reports/review-signals.md`: SIP holdout −0.90% after 0.5 pp; every bucket negative; stronger bursts are worse. `paper-ledger.json`: −4.39R mean, median −1.07R, n=60, 1 session. Daily, exit, filter and catalyst studies: nothing holds. | The main job the tool advertises ("بدايات الحركة") has no evidence of value. Screen real estate goes to it instead of to what did hold (the avoid rules). |
| F3 | Plan on toxic names | **High** | `open-plan-ADGM.png`: a stock −14% on the day, Nasdaq DEFICIENT, HIGH dilution, SSR active. It still shows «خطة مشروطة متاحة الآن» in green with a 730-share size. The gate only WARNs on HIGH filing risk (`tradeability.js` risk block). AEMD (sub-dollar, HIGH dilution) is also READY (`open-list.png`). | The catalyst study found dilution-flagged names lagged by −2.56 pp over H10 in the holdout (CI below 0). A plan should not be offered on them. |
| F4 | Gate cost math | **High** | `tradeability.js`: `costInR({... shares = 1})`, so the gate costs **one share**. ADGM: gate 0.26R (CAUTION); calculator at the actual size (730 sh) 0.42R. At a $200+ risk budget, impact pushes the sized cost past the 0.5R block while the gate still says OK/CAUTION. | The gate verdict understates the real cost for any real size. |
| F5 | Liquidity estimate | **High** | `tradeability.js liquidityOf`: `dayDollars` = consolidated day volume (which **includes pre-market**) × price ÷ minutes since 09:30. At 09:35 a gapper with $5M pre-market volume shows about $1M per minute. The liquidity gate and the 10%-of-a-minute size cap are inflated exactly when spreads are widest. | Oversizing at the open, which is the worst time to be oversized. |
| F6 | Gap workflow | **High** | `gap-list.png` (09:36): ACTU +85%, float 2.1M, FDA news does not appear in the default "early" list. `state.js:359` filters out extended rows; the dossier cannot be reached from the default view (the scripted click failed). It appears only under «الأكثر ارتفاعًا», with no gap %, pre-market volume, pre-market high, float rotation or news time. | The 07:00–10:00 window, where most small-cap volume and risk sits, is not served. |
| F7 | Missing levels | **High** | There is no session VWAP (only `vwap_window`, "ليس متوسط الجلسة"), no HOD/LOD, no pre-market high/low, no prior-day high/close levels on the ladder, and no opening range (`dossier.js:127`, `charts.js planLadder`). | Stops and triggers cannot be sanity-checked against the levels the tape respects. |
| F8 | Halts/LULD | **High** | `risk.js:61`: a halt shows only its reason code. The HALT row still reads **12/12** checks (`open-list.png`, ADIL; **open** per review-trader). There are no LULD bands, no halt count today, and no resumption time or indicative price, although the RSS has `ResumptionQuoteTime`. | Halt-resume is the #1 blow-up risk in sub-$5 names, and the tool gives no band proximity. |
| F9 | SSR | Medium (High if short side) | `tradeability.js ssrState`: ACTIVE only while price ≤ −10% now. It never carries over to the next day, and it ignores the intraday low. `dossier.js:60` shows «غير معروف» otherwise. | Correct as a long-only INFO item. Unusable for shorts, and misleading once the stock bounces above −10% (SSR stays on for the rest of the day and all of the next). |
| F10 | Filing timing | **High** | `enrichment.json` filings carry `date` only, not the EDGAR `acceptanceDateTime`. The enrichment cron runs at 07:15 and 16:45 ET only (`tagit-next-enrichment.yml:7-8`), and GitHub schedules drift. An intraday 424B5, 8-K 1.01 or S-3 effectiveness is invisible until after the close. | Offering news *is* the small-cap catalyst. The dilution flag is up to a session late on the day it matters. |
| F11 | Warning fatigue | Medium | Enrichment: 374 HIGH and 658 WATCH dilution out of 1,822 symbols (57% carry ⚠), plus 255 non-NORMAL listing statuses. The same ⚠ icon is used for a halt, deficiency and a 10-month-old S-3. | With over half the rows flagged, the icon stops meaning anything. It needs tiers and recency. |
| F12 | Universe mismatch | Medium | The studies use a reference cap < $100M (`sip_study.mjs:27`), and the README says < $100M. The live list uses `UNIVERSE_CAP = 300_000_000` (`state.js:15`); the SIP scan uses < $300M (`state.js:295`, 1,236 names), and the KPI says «أقل من 300 مليون». | Study numbers are quoted next to a list drawn from a different universe. |
| F13 | Holidays | Medium | `holiday-list.png`: Thanksgiving 2026-11-26 shows «الجلسة النظامية» with 5 live plans (the mock served fresh data; in reality everything would read STALE with no reason). `market.js:200`. `EARLY_CLOSES` exists in `sipscan.js` but there is no holiday list. **Open.** | "Why is everything stale?" confusion, and wrong session logic in the journal windows. |
| F14 | Tier honesty | Medium | `pre-list.png`: at 08:30 ABTS is «غير قابل للتنفيذ» (BLOCKED) but sits under «↑ الأعلى استيفاءً». `splitPriority` does not exclude BLOCKED. **Open.** | The top tier contains untradeable names. |
| F15 | Stale methodology text | Medium | `index.html:103`: «الحاسبة لا تشمل الرسوم والانزلاق» (the calculator excludes fees and slippage). `costs.js` includes spread, impact, SEC/TAF and stop slippage. | Contradictory claims undermine trust in the correct parts. |
| F16 | R definition | Medium | `open-plan-ADGM.png`: "الخسارة عند الإبطال −$97.55 · **1.67R**" with a $100 budget. R is the gross stop distance, not the budget, so the all-in loss reads 1.67R and the net 2R target reads 1.58R. | Traders define 1R as the dollars they risk. Two definitions on one card confuse sizing. |
| F17 | Data: IEX coverage | High (known) | `reports/data.md`: IEX sees 14% of the names trading in any minute. `/api/live` (the consolidated board) is not deployed, so the page shows the «لوحة الأسعار المجمّعة غير مفعّلة» notice (`open-list.png`). The IEX previous close is off by >1% for 45% of names (fixed in the frontend via SIP closes). | Freshness checks fail or pass on a single venue. Most real prints are invisible, so the 12 checks are measured on the wrong tape. |
| F18 | Quote freshness semantics | Medium | `market.js:249`: the Nasdaq.com consolidated `quote_at` is the **fetch time**, not the quote time, and passes a 30 s freshness check. The bid/ask is not NBBO-timestamped. | A spread can look "fresh" when it is not. The cost gate relies on it. |
| F19 | Pressure proxy | Low | `pressure.js`: "buy/sell pressure" is inferred from IEX snapshot volume deltas × price direction. It shows «تجميع عينات» (warm-up) on every row in every scenario. | This is noise dressed as order flow. Either label it clearly or remove it; it occupies a list column. |
| F20 | Bidi remnants | Low | `sip.js:196` `f.num(p.mean_net_r,2)R` is not isolated; `open-sip.png` shows «4.39R-». `dossier.js:94` has similar remnants. **Open (M1 remnants).** | A reversed sign on a loss figure is a trust bug. |
| F21 | Fade flag not in gate | Low | `tradeability.js`: `isExtended(row)` without the fade flag (rows do not carry `.fade`), and `dossier.js:105` has the same issue. **Open.** The banner covers it. | Minor inconsistency. |
| F22 | Speed UX | Medium | `open-list.png`: the list starts about 545 px down on desktop; on the phone the first row is below the fold (`open-phone.png`). Keyboard support is `/`, ↑/↓ and Esc only; ↓ does nothing until a row is focused (`open-keys` log "BODY:"). There are no alerts: no sound, no Notification API and no per-symbol price alerts. | A day trader needs the list and the alert above the fold, plus hotkeys (W watch, P plan, 1–4 tabs, J/K). |
| F23 | Journal is observation-only | Medium | `journal.js`: records are sampled prices while the page is open. There is no entry or exit fill, no size, no tags (setup, mistake) and no R-multiple of *the user's* trades. J1 (horizon and cost) is fixed. | Post-trade review, the only proven way to improve for a discretionary trader, is not supported. |
| F24 | Float/short provenance | Medium | Float comes from the scanner metadata (source not shown). FINRA SI is at 2026-09-15 settlement (biweekly, T+~8 publication). There is no borrow or fee data. `dossier.js:122` shows float without a source or date. | Float drives the low-float squeeze risk, and its source and age must be visible. |
| F25 | Forward evidence thin | Info | `forward-outcomes.json`: 2 recorded days, 0 regular alerts. `paper-ledger.json`: 1 session, verdict INSUFFICIENT_SAMPLE. The Monday 09-28 recovery is now recorded (complete, 0 alerts). | Nothing forward-validated yet. The page says so, which is correct. |

Verified fixed: gate/READY consistency (T1), PRE/AFTER block (T2), Arabic-Indic digits, stale spread, fade → EXTENDED, SIP phases, journal horizon and cost (J1), evidence hashes, the relay request storm, and phone modal/overflow.

---

## (c) Scope of Work

Effort: S ≤ 1 day, M 2–5 days, L > 1 week. **Free** means achievable with the current free sources (Alpaca IEX plus SIP ≥16 min via the relay, Nasdaq.com unofficial, Nasdaq Trader, SEC EDGAR, FINRA). **Paid** flags anything that needs a paid source.

### WP1: Honest relabel of the main list (P0, S, free)
- **Objective:** no screen may read as a buy recommendation for an unstudied signal.
- **Changes:**
  1. Rename READY «خطة مشروطة» to «مستويات للمراقبة (إشارة غير مدروسة)» (levels to watch, unstudied signal). Use a neutral colour, not green.
  2. Replace `STATE_HINTS.READY` with text saying the signal is IEX-based, unstudied, and that its SIP twin is negative after costs.
  3. `LIST_NOTES.early` and the KPI «خطط مشروطة الآن» must state "unstudied / not a recommendation", with a link to the evidence.
  4. Fix `index.html:103` (the calculator does include costs).
  5. Isolate every signed number (`sip.js:196`, `dossier.js:94`).
- **Acceptance:**
  - A test asserts that no string in `common.js`, `list.js` or `status.js` contains «صالحة» or «متاحة الآن» next to a plan.
  - A snapshot of the READY badge uses a non-`--up` colour token.
  - A bidi scan (the M1 method) finds 0 flipped tokens on the market page, the dossier and the SIP list.
- **Dependencies:** none.

### WP2: Hard avoid gates (P0, S, free)
- **Objective:** turn the only rules that held into blocks, not footnotes.
- **Changes:**
  1. BLOCK any plan when any of these apply:
     - fade flag (extended in the last 5 sessions);
     - dilution HIGH with a registration or 424B in the **last 30 days**;
     - Nasdaq DELINQUENT or BANKRUPT;
     - a 424B priced offering in the last 5 sessions (catalyst study: long H5 after an offering −3.16%, CI below 0);
     - day change ≤ −10% for longs (gap-down avoid, H5 −1.30%, CI below 0).
  2. Keep the reasons verbatim, with study IDs and CIs.
  3. Exclude BLOCKED rows from «الأعلى استيفاءً» (F14).
  4. HALTED rows show the meter as n/a.
- **Acceptance:** unit tests with ADGM-, ADBT- and AIFF-shaped fixtures give `state=BLOCKED` with the named reason. `splitPriority` never returns BLOCKED or HALTED in `upper`. Re-running `open-list` shows ADGM, AEMD and ADBT not in the upper tier.
- **Dependencies:** WP1. This is a product rule, not a claimed edge. The copy must say "avoid rule (held on holdout), not a sell signal".

### WP3: Correct execution math (P0, S, free)
- **Objective:** the gate must judge the trade the user would actually place.
- **Changes:**
  1. The gate computes cost at the **calculator size** when limits are set (fallback: the size implied by a $100 risk budget). Show "cost at your size".
  2. Liquidity uses regular-session volume only. Subtract pre-market volume (known from the SIP delayed bars or the scanner), or use the rolling last-N-minutes consolidated volume. Never use the day total divided by elapsed regular minutes before 10:00.
  3. Define **1R = the user's all-in risk budget** everywhere; show the gross stop distance separately.
  4. At 09:30–09:45, apply a spread multiplier or require a 2-quote-stable spread.
- **Acceptance:**
  - Fixture: ADGM with a $250 budget. The gate verdict equals NO when the sized cost is ≥0.5R.
  - Fixture: at 09:35 with 5M pre-market shares, `minuteDollars` excludes them.
  - The calculator shows "loss at stop = 1.00R" when the budget binds.
- **Dependencies:** none.

### WP4: Gapper / pre-market board (P0, M, free with caveats)
- **Objective:** serve 04:00–10:00, where the volume is.
- **Changes:** a new «فجوات» (gaps) view, visible from 04:00 ET. Per row:
  - gap % against the SIP previous close;
  - pre-market volume and $ volume;
  - float and **float rotation** (pre-market volume ÷ float);
  - pre-market high and low;
  - news headline with **time** and first-seen;
  - latest SEC filing with **acceptance time**;
  - dilution tier, fade flag, halt state;
  - spread.

  Sort options: gap %, $ volume, rotation. Rows are never hidden for being extended; extended is a label, not a filter. Nothing on this board is a plan: it is situational awareness.
- **Acceptance:**
  - At 08:30 and 09:36 (`gap` scenario) ACTU is listed with gap +85%, a float rotation value, and a news time.
  - Pre-market prices are tagged with their source and age.
  - It works with `/api/live` absent (IEX plus Nasdaq.com overlay).
- **Dependencies:** a backend change for pre-market aggregates (the frozen `scanner.mjs` stays untouched; add a new endpoint). Free: IEX pre-market is thin (≈14% coverage). Nasdaq.com pre-market quotes are unofficial. **A full consolidated real-time pre-market tape is Paid**, so label the coverage.

### WP5: Levels on the ladder (P1, M, free)
- **Objective:** trader-grade reference levels.
- **Changes:** add to `planLadder` and the dossier:
  - session VWAP from consolidated minute bars (SIP ≥16 min plus IEX for the last 16 min, labelled blended);
  - HOD and LOD;
  - pre-market high and low;
  - prior-day high, low and close;
  - 5-min opening range;
  - whole and half-dollar levels.

  Each level carries its source and age.
- **Acceptance:** fixture bars give known VWAP, HOD and PMH values to 4 decimals. The ladder never labels an unconfirmed or blended level as "live".
- **Dependencies:** WP4's pre-market data.

### WP6: Halt and LULD awareness (P0, M, free)
- **Objective:** never let a user size into a halt magnet.
- **Changes:**
  1. Compute LULD bands from the reference price (5-min average; Tier 2 <$3: 20%, the $0.75–$3 band rules, doubled at the open and close windows). Show distance to band in %.
  2. Warn within 2% of a band, and BLOCK within 1%.
  3. Count halts today per symbol from the Nasdaq Trader RSS history.
  4. Show the resumption quote and trade time.
  5. After resumption, BLOCK plans for N minutes.
- **Acceptance:** unit tests for the band tiers against the published LULD plan table. A fixture with 2 LUDP halts today shows "2 halts" and a post-resume cool-off.
- **Dependencies:** none. The reference price is an approximation from consolidated bars; label it "estimated band". **The official band feed is Paid.**

### WP7: Real-time SEC filing clock (P0, M, free)
- **Objective:** surface dilution and catalyst filings within minutes, with acceptance time.
- **Changes:**
  1. The backend polls the EDGAR "current events" Atom/JSON (free, UA required, ≤10 req/s) every 1–2 min for universe CIKs.
  2. Store `acceptanceDateTime`, form and 8-K items.
  3. Frontend chips: «424B5 قبل 12 د» (424B5, 12 min ago), «8-K 3.01», «S-3 EFFECT», «NT 10-Q».
  4. Recency tiers: <1 day hot, <30 days warm, older cold. This replaces the flat ⚠ (F11).
  5. Parse warrant and ATM language where feasible (424B5 "at-the-market", "pre-funded warrants").
- **Acceptance:**
  - The p95 delay from EDGAR acceptance to the page is under 5 min in a logged 5-session forward check.
  - The ⚠ count per 100 rows is reported. HIGH (hot) is below 10% of rows.
- **Dependencies:** backend (Render/Railway free). Free.

### WP8: SSR and short-side awareness (P1, S, free; borrow data is Paid)
- **Objective:** a correct SSR state, and an honest "short side not supported" posture.
- **Changes:**
  1. SSR = triggered if the **intraday low** (SIP bars) ≤ prior close × 0.9. It carries to the next session (store yesterday's trigger list in a daily job).
  2. States: ACTIVE today, ACTIVE carried, NOT TRIGGERED (based on bars as of time T).
  3. No borrow, locate or fee data: say "borrow unknown". Do not add short plans. The fade study says shorts did not pay after costs.
- **Acceptance:** a fixture where the low hit −11% and the price recovered to −5% gives ACTIVE today. The next-day fixture gives ACTIVE carried.
- **Dependencies:** a daily job. **Borrow and fee rates are Paid (or broker-only). Out of scope.**

### WP9: RVOL by time of day and float context (P1, M, free)
- **Changes:**
  1. RVOL = cumulative consolidated volume by minute-of-day against the 20-day same-minute average, from SIP daily and minute history via the relay in a nightly job. Publish per-symbol curves compactly.
  2. Show float with its source and date (F24). Show float rotation.
  3. Replace the "pressure" column (F19) with RVOL. Keep pressure in the dossier only, labelled "IEX snapshot proxy".
- **Acceptance:** the RVOL at 10:00 for a fixture matches a hand calculation. The list column header reads «RVOL (وقت اليوم)».
- **Dependencies:** relay budget (40 req/min shared). Nightly batching with cached artifacts is required.

### WP10: Data-integrity basics (P1, S, free)
- **Changes:**
  1. An NYSE/Nasdaq holiday and early-close calendar for 2026–2028 in `market.js`, shared with `sipscan.js`. The session pill shows «عطلة» (holiday).
  2. One universe definition shared by the studies and the live page. Either narrow live to <$100M or re-run SIP-study descriptives on <$300M, and label which.
  3. The Nasdaq.com quote carries `quote_source_time` when available. If not, the freshness limit for a consolidated quote drops to 10 s from fetch, and the source is labelled "fetch-time".
  4. Deploy `/api/live` (owner action in `reports/data.md`), or drop the notice.
- **Acceptance:**
  - `holiday-list` shows «عطلة» and 0 plans.
  - The KPI cap label equals the study cap, or both are shown.
  - The data-audit part E runs in-session and is published.
- **Dependencies:** owner redeploy. Free.

### WP11: Trader journal (P1, M, free, local only)
- **Objective:** post-trade review, the highest-value feature for a discretionary trader.
- **Changes:**
  1. Manual trade entry: side, entry/exit times and prices, size, fees.
  2. Tags: setup, mistake, and "rule followed" (Y/N).
  3. Auto-attach a context snapshot: spread, RVOL, float, dilution tier, fade flag, halt count, gate verdict at entry.
  4. Stats: R-multiple distribution, expectancy with a bootstrap CI, results by tag and by time bucket, and "trades taken against a BLOCK".
  5. CSV/JSON export and import.
  6. Keep the existing observation records as a separate kind.
- **Acceptance:**
  - Round-trip export and import is lossless.
  - Stats match a hand-computed fixture.
  - A "violated gate" count is shown.
  - No server storage: data stays in the browser, and the user is told so.
- **Dependencies:** WP2 and WP3 for the gate snapshot.

### WP12: Speed UX and alerts (P1, M, free)
- **Changes:**
  1. A compact "trader mode": collapse the intro, KPIs and notices into one line. The list starts within 150 px on desktop and is above the fold on a 390×844 phone.
  2. Hotkeys: J/K or ↓/↑ with no focus needed, W watch, 1–4 dossier tabs, G gaps view, S SIP view, `?` help.
  3. Alerts with the Notification API and an optional sound, per watched symbol: price crosses a level, halt or resume, a new SEC filing, the spread widens. Alerts fire only while the tab is open, and the UI says so.
  4. Density columns: gap %, RVOL, float, spread, last-filing age.
- **Acceptance:**
  - Playwright: the first list row's `getBoundingClientRect().top` is under 200 px at 1440×900 and under 844 px on the phone.
  - A key-press test for every hotkey.
  - The alert fires within one render tick of a mocked halt.
- **Dependencies:** WP4, WP7 and WP9 for the columns.

### WP13: Pre-registered forward tests (P1, M, free)
- **Objective:** measure, never claim.
- **Changes:** pre-register in the file headers **before** data, with a frozen `holdout_from`, session-block bootstrap, ≥0.5 pp cost, and ≥20 sessions / 100 events:
  - **H-A (avoid gates, WP2):** flagged minus unflagged forward return, long H1 and H5, on live-universe names. Pass only if the forward CI upper bound is < 0.
  - **H-B (gap board descriptives):** conditional outcomes of gappers by float rotation and dilution tier. Descriptive only; no selection.
  - **H-C (gate value):** paper-ledger gate-passed vs gate-blocked net R, with the WP3 corrected costs.
  - Continue `paper-ledger-1` unchanged.
- **Acceptance:** protocols are committed before their first forward session (the git timestamp predates the data). The page shows "no verdict" until the thresholds are met.
- **Dependencies:** WP2, WP3.

### WP14: IEX list decision (P2, S, free)
- **Objective:** resolve A6 permanently.
- **Changes:** either
  - (a) retire the IEX "early moves" list and make the SIP list plus the gap board the default; or
  - (b) keep it as «تجريبي» (experimental), with its own forward record displayed at the top (n, mean after cost, CI).

  I recommend (a).
- **Acceptance:** the default view is not an unstudied signal.
- **Dependencies:** WP1, WP4.

---

## (d) Out of scope / not recommended

- **Order placement, broker connection, auto-trading.** This is forbidden by the brief, and I agree with it.
- **Short-selling plans or a "fade" signal.** The fade study failed after borrow, with a tail worse than −100%. Show SSR and borrow-unknown only.
- **Paid feeds:**
  - real-time SIP / NBBO / L2 depth / time and sales (Polygon, Databento etc.);
  - the official LULD band feed;
  - borrow and fee rates (broker or Ortex-type);
  - Benzinga/Dow Jones real-time news.

  If the owner ever pays, the first pick is **real-time SIP trades and quotes**. It fixes F17 and F18 and makes WP5 and WP6 exact.
- **L2 or tape "reading" from IEX TOPS.** One venue's book is misleading for small caps. Do not build a fake L2.
- **ML scoring or ranking by any composite "score".** Every tested ingredient was negative; a composite would be curve-fitting.
- **Sector or theme "momentum" buy lists** from the Insights tab. Keep that tab descriptive.
- **Headline sentiment scoring.** Unvalidated, and headlines are often late relative to the move.

## (e) Suggested phasing

| Phase | Window | Packages | Outcome |
|---|---|---|---|
| 0: Stop the harm | Week 1 | WP1, WP2, WP3, WP10 (holidays, universe label) | No screen implies a buy; avoid rules are hard gates; the cost and liquidity math is correct. |
| 1: Serve the morning | Weeks 2–4 | WP4, WP6, WP7 | Gap board, LULD and halt awareness, real-time filing clock: a tool I would open at 07:00. |
| 2: Context and speed | Weeks 4–6 | WP5, WP9, WP12, WP8 | Levels, RVOL, trader mode, alerts, correct SSR. |
| 3: Learn | Week 6 onward | WP11, WP13, WP14 | A journal with gate-violation stats; pre-registered forward tests; retire or keep the IEX list on evidence. |

**Re-assessment gate:** after Phase 1, repeat this review with 20 forward sessions of WP13 data. Until then, the tool is a risk checklist, not a signal source.
