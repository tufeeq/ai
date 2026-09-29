# Review: signal quality and honesty (agent 2 of 5, 2026-09-29)

Scope: `src/core/{checks,detector,sipscan,quality,pressure,fade,risk,closes}.js`, `src/views/{sip,evidence}.js`, `opportunity.mjs`.
Small edits outside scope: `src/state.js` (pass the fade flag into assessment and ranking) and `src/views/dossier.js` (3 lines: date-aware fade banner, evidence passed to the SIP card).
`evidence-release.json` was not touched, so the lead has to update the hashes for every file changed here.

## 1. What the outcomes say (all numbers are after costs)

**Live main list (IEX): there is no outcome yet.** `forward-outcomes.json` covers 2 recorded days (09-26 and 09-29) with **0 alerts**. So there is no live result for the list users look at first, and none of the study numbers apply to it (audit A6).

**Forward paper ledger, SIP delayed list: 1 session (2026-09-28).**
- 174 signals. 60 were traded, 31 chased, 41 had no entry, 24 had no plan and 18 were invalidated.
- The 60 traded signals averaged **−4.39R** net (median −1.07R). Gross was −0.07R and costs were 4.32R. Hit rate 15%, Wilson interval [8%, 26%]. Net result −$933.
- The 9 trades that passed the gate averaged −0.21R, and the 51 gated trades averaged −5.13R. n=9 is far too small to call the gated subset better.
- Other cuts, all tiny samples:
  - By time: 09:30–10:00 +0.39R (n=3); 10:00–11:30 −7.79R (n=17); 11:30–14:00 −1.51R (n=24); 14:00–16:00 −6.00R (n=16).
  - By 3-minute move: 0–2% −5.37R (n=29); 2–4% −4.49R (n=24); 4–8% −0.01R (n=7); none above 8%.
  - Spread ≤0.8%: −1.46R (n=27).
- One session proves nothing. The only thing it shows reliably is that costs dominate: the loss is almost entirely cost, not direction.

**SIP study (185 sessions, holdout from 2026-07-01).** Mean 30-minute return after 0.5 pp, with a session-block bootstrap 95% CI. I recomputed these from `sip-events.json`:

| bucket | dev, at detection | holdout, at detection | holdout, delayed 17 min |
|---|---|---|---|
| all | −0.65 [−0.73, −0.56] n=29,076 | −0.90 [−1.02, −0.79] n=13,123 | −0.79 [−0.91, −0.68] n=10,776 |
| 3-min move 0.7–2% | −0.47 | −0.60 [−0.69, −0.48] n=6,459 | −0.70 |
| 3-min move 2–4% | −0.57 | −1.04 n=3,768 | −0.79 |
| 3-min move 4–8% | −1.16 | −1.17 n=2,178 | −0.72 |
| **3-min move > 8% (the tool's own "extended")** | −1.47 | **−2.07 [−3.36, −0.87] n=718** | −1.72 |
| $ in 3 min ≥ $250K | −0.99 | −1.71 [−2.17, −1.23] n=2,213 | −1.31 |
| volume ≥ 6× | −0.68 | −1.10 n=3,280 | −0.71 |
| 09:30–10:00 | −0.78 | −0.52 [−1.06, +0.03] n=947 | −0.89 |
| price ≥ $5 | −0.51 | −0.74 | −0.52 [−0.80, −0.22] |

**No bucket is positive in development or in the holdout.** The only CI that touches 0 is 09:30–10:00 at detection (upper +0.03, n=947, and −0.89 when delayed). That is noise, not an edge. I did not select anything from this table.

**The pattern that matters for the UI:** the stronger the burst (a bigger 3-minute move, more dollars, a higher volume ratio), the worse the outcome, in both splits. It is the intraday version of the fade study's "don't buy extended".

Fade flags on 09-28 (one day, n=15): flagged signals did better (+1.14% vs −1.50%). One day is noise, and the rule is not changed because of it.

## 2. Issues found

| # | Sev | Where | Issue | Status |
|---|---|---|---|---|
| S1 | **High** | `checks.js` `splitPriority`, `state.js` `visibleRows` | Ties were ranked by the server `score` = min(40, 10·r3) + min(35, 7·vr) + min(15, $3m/10K) + 10·breakout. It rewards exactly the buckets that lose more (bigger move, dollars, volume, breakout), so the most-chased names were ranked on top. | **Fixed**: new `compareRows`. Order is passed checks, then non-extended first, then the smallest 3-minute move first. `score` is no longer used. |
| S2 | **High** | `checks.js`, `state.js` | The only rule that held on a holdout (the fade-study-1 "don't buy after an extended day" flag) was shown only as a dossier banner. A flagged name could still be **READY** and sit in the **top tier** and the early list. | **Fixed**: `assess(..., {fade})` fails the extension check, the state becomes EXTENDED, the row cannot be READY or top tier, the early list drops it, and a blocker explains why. `isExtended(row, fade)` covers the flag. |
| S3 | **High** | `sipscan.js`, `views/sip.js` | The SIP list (the studied signal) showed 3-minute bursts above 8% as ordinary signals. The detector does not apply `maxEarly3mGain`, which the live list does. These are the worst bucket (−2.07% holdout). | **Fixed**: signals now carry `extended`. They get a "ممتدة" (extended) badge, are dimmed and are sorted after the others. |
| S4 | **High** | `views/sip.js` | The "near trigger" position was labelled "ما زال قرب التفعيل" (still near the trigger) in a **green** badge, which reads as a buy cue on a signal that is negative after costs. The list never showed the measured result. | **Fixed**: neutral wording ("قرب مستوى الرصد", near the detection level) and a neutral badge. The header and the dossier card now show the measured holdout mean, the win rate and n, plus the paper-ledger R, from the published JSON. `SIP_NOTE` says the result is negative. |
| S5 | Medium | `views/sip.js`, `sipscan.js` | Stale shown as fresh. The list shows signals up to 2 h 16 min old with no marker. The studied trade enters at 17–19 min and exits 30 min later. | **Fixed**: `signalPhase` gives ENTRY (≤ 19 min), LATE (unstudied entry) or EXPIRED (> 47 min). Each row is labelled with its phase, expired signals are dimmed and sorted last, and the header counts signals still within the studied hold. |
| S6 | Medium | `fade.js` `fadeWarning` | Stale data treated as fresh. Flag age was counted only inside the list's own session array. If `fade-flags.json` stopped refreshing, flags stayed "current" forever. | **Fixed**: an optional `today` argument adds the weekdays the list has not seen. Holidays make a flag expire one session early; this is documented. The dossier and state pass the New York date. |
| S7 | Medium | `views/evidence.js` | The live alert card with 0 alerts showed only dashes. It did not say that nothing has been recorded, or that the IEX list is not the studied signal (A6). There was no overall verdict. | **Fixed**: a bottom-line card comes first ("no buy or sell rule has held after costs on data it was not built on"), with each study's verdict. The live card states the 0 alerts and A6. The SIP study card gets a holdout breakdown table, labelled "descriptive only, not for selection". |
| S8 | Low | `views/evidence.js` `paperCard` | Crashes if a ledger book lacks `gate_passed`. | **Fixed** (guard). |
| — | — | `detector.js` | Byte-exact copy of the frozen scanner. Nothing changed. Note: when a breakout has already happened (`last.c > priorHigh`), price is already above the trigger, so the plan starts out chasing. | Not changed (frozen). |
| — | — | `quality.js`, `pressure.js`, `closes.js`, `risk.js` | No look-ahead or time-zone bugs found. Closes use the session before the price's own session. The bar/session helpers are EDT/EST aware. | OK |

## 3. Still open (outside my scope or not fixable here)

- **A6 is still the biggest honesty gap.**
  - The main "early moves" list runs an unstudied IEX signal and has recorded 0 alerts.
  - `LIST_NOTES.early` (list.js) and `STATE_HINTS.READY` in common.js ("كل الشروط مستوفاة…", all conditions are met) should say that the signal is unstudied and not a buy recommendation. These are agent 1's files.
  - The "top gainers" view sorts by day change, which is the chase list. It should at least carry the fade flag and the extension warning per row.
- The dossier's `isExtended(r)` call (dossier.js:119) does not pass the fade flag. The fade banner covers it, so it is cosmetic.
- The ledger has one forward session. It needs ≥ 20 sessions and 100 trades before any verdict. Until then the page must keep saying "no verdict".
- The lead needs to update the `evidence-release.json` hashes for: src/core/checks.js, fade.js, sipscan.js, src/state.js, src/views/sip.js, evidence.js, dossier.js.

## Tests
`tests/signals.test.mjs` has 10 tests. They cover:
- fade → EXTENDED, not READY, not top tier;
- the score is ignored in ranking;
- the state early list;
- stale fade lists;
- the SIP phase;
- SIP ranking;
- the detector's `extended` flag;
- SIP list wording and evidence;
- the bottom-line and zero-alert cards;
- rendering of the published data.

`node --test tagit-next/tests/*.test.mjs` passes 147/147, and `phase2-view.test.mjs` passes 2/2.
