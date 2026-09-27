# Risk / execution report (agent: risk, branch `claude/agent-risk`)

## What was built
1. **Cost model** — `src/core/costs.js` (shared by the page and the ledger)
   - Round trip = full quoted spread + 2 × square-root impact (1% × √(order $ / avg one-minute $ volume)) + SEC §31 + FINRA TAF + optional commission, with a **0.5 pp floor**. Stop exits pay **one extra spread**. If no quote is available, a 1.0% spread is assumed and flagged.
   - `sizeWithCosts`: the **all-in loss at the stop (including costs and stop slippage) stays within the risk budget**. Size is also capped by capital and liquidity: ≤10% of an average minute's $ volume and ≤1% of the session's $ volume so far. The result reports the binding limit (RISK/CAPITAL/LIQUIDITY), cost in $ and R, the net result at the stop and at 1R/2R in $ and R, and the break-even move.
2. **Tradeability gate** — `src/core/tradeability.js`
   - Verdicts: `غير قابل للتداول الآن` / `قابل للتنفيذ بحذر` / `التنفيذ ممكن وفق البيانات الحالية`.
   - **BLOCK** on any of: halt, disconnected, delayed feed, market closed, stale trade, missing or stale quote, spread >1.5%, minute $ volume <$8K, round-trip cost ≥0.5R.
   - **WARN** on any of: spread >0.8%, minute $ <$25K, cost ≥0.25R, pre/after hours, price <$1, float <5M (or <1M), extended move, HIGH filing risk.
   - **Rule 201 (SSR)**: shown as ACTIVE when the price is ≥10% below the prior close. Otherwise it shows UNKNOWN, because the intraday low and the prior day's state aren't in the feed. It is never shown as "inactive".
   - Liquidity uses the larger of the IEX 3-minute $ and the consolidated day-average $/minute, and shows which source it used.
   - The verdict text says explicitly that it is not a probability of profit.
3. **UI (dossier)**
   - A gate card on the analysis and plan tabs.
   - The calculator is now cost-aware and has a commission field.
   - A stock the gate blocks gets no plan and no calculator.
4. **Forward paper ledger**
   - Files: `pipeline/paper_ledger.mjs` and `.github/workflows/tagit-next-paper-ledger.yml`. Protocol `paper-ledger-1`; its rules were pre-registered in the file header before any forward session.
   - Forward start: **2026-09-28**.
   - Two books: the SIP delayed list (visible at +17 min) and live scanner alerts (from `forward.py`, which now stores `plan_levels`).
   - Simulation walks SIP minute bars:
     - stop is checked first;
     - a gap below the stop fills at the bar's open;
     - 2R target;
     - otherwise exit at 30 min or the close.
   - Spread is measured from SIP quotes (up to 120 trades/day) and applied through the same cost model. Halts come from the Nasdaq Trader RSS with `haltdate`.
   - Gated trades are still simulated and reported separately, so the gate's value is measured forward.
   - Statistics:
     - net $ and R, cumulative curve, hit rate with a Wilson 95% interval, mean net R with a session-block bootstrap 95% interval;
     - no verdict before 20 sessions and 100 trades.
   - Schedule and output:
     - The job runs at 20:45 ET on weekdays, after the SIP study and the forward evaluation.
     - It publishes `data/paper-ledger.json` and `.raw.json` on main and dispatches the Pages deploy.
     - Relay pacing is 3.1 s with a 429 back-off.
     - Branch pushes run a replay that is labelled `REPLAY_NOT_FORWARD` and is not published.
   - Site card: "سجل التداول الورقي الأمامي" in the evidence section.
5. **Tests**
   - `tests/risk.test.mjs` (22 tests) and `test_forward.py` (plan_levels); `app.test.mjs` updated (calculator gives 78 shares after costs instead of 100 before).
   - 79/79 node tests and 7/7 Python tests pass.
   - `evidence-release.json` is updated to release `next-7-20260927-risk` (40 files, including the two new core files), and `verify-evidence-release.py --local` passes.
   - The UI was checked in Chromium (Playwright) with a fixture harness that was removed afterwards. The real page loads the ledger card with no console errors.

## Evidence (replay of 2026-09-21 → 09-25; in-sample, NOT forward)
Run: https://github.com/tufeeq/ai/actions/runs/36309845663 (success; artifact `paper-ledger-36309845663`).

Signal outcomes for the SIP list:

| Outcome | Count |
|---|---|
| Signals | 1,237 |
| Traded | 433 |
| No plan | 225 |
| Chased | 192 |
| Invalidated | 96 |
| No entry | 291 |

Results of the traded signals:

| Book | Trades | Net $ | Mean net R [95% CI] | Gross R | Cost R | Hit rate |
|---|---|---|---|---|---|---|
| SIP, all | 433 | −$6,843 | **−2.75 [−3.03, −2.46]** | +0.03 | 2.79 | 18.7% |
| SIP, gate passed | 47 | −$1,283 | **−0.50 [−0.68, −0.29]** | −0.10 | 0.40 | 21.3% |

Live alerts: 0 in those sessions.

**Finding: the earlier studies reported plan R before costs.** The +0.04R "plan mean R" in `sip-outcomes.json` is gross. The detector's stops are 0.5–6% wide, and with real spreads the round trip costs on average **2.8R per trade**. Most signals cannot be traded economically. The gate removes 89% of them and cuts the loss per trade from −2.75R to −0.50R, but what remains is still negative. The page must not present these plans as tradeable edges, and it now says so per stock.

## Open items
- **Detection count mismatch.** Re-detected SIP signals are about 4–5% fewer than the published `sip-events.json` counts (for example 239 vs 251). A likely cause is bar corrections between the two fetches. This needs a check, but it doesn't change the conclusion.
- **Replay cost.** The replay needed 564 relay requests and took about 75 min for 5 sessions, including back-offs. A forward day is about 100–120 requests.
- **SSR state.** It can only be ACTIVE or UNKNOWN on the live page. Full SSR would need the intraday low from the backend (`scanner.mjs` is frozen).
- **Live alerts book.** It depends on `forward.py` running on main with `plan_levels`, which is this branch's change.
- **Liquidity source.** The IEX-based minute $ understates small-cap volume; the consolidated day average is used when it is available.
