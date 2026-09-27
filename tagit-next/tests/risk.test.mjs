import test from 'node:test';
import assert from 'node:assert/strict';
import { COSTS, spreadPct, impactPct, roundTripCost, sizeWithCosts, liquidityCap, costInR } from '../src/core/costs.js';
import { tradeability, ssrState, liquidityOf, GATE } from '../src/core/tradeability.js';
import { createState, applyScan } from '../src/state.js';
import { renderDossier } from '../src/views/dossier.js';
import { renderEvidence } from '../src/views/evidence.js';
import {
  simulate, parseHaltHistory, haltedAt, haltDuring, nyTime, wilson, blockBootstrap, summarizeBook, buildLedger, medianSpread,
  liquidityBefore, session, FORWARD_START, PROTOCOL,
} from '../pipeline/paper_ledger.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

// ---- cost model -------------------------------------------------------------------------

test('spread is a percent of the mid; crossed or missing quotes give null', () => {
  close(spreadPct(1.98, 2.02), 2);
  assert.equal(spreadPct(2.02, 1.98), null);
  assert.equal(spreadPct(null, 2), null);
  assert.equal(spreadPct(0, 2), null);
});

test('impact follows the square-root law and charges a full minute when volume is unknown', () => {
  close(impactPct(1000, 100_000), 0.1);
  close(impactPct(10_000, 100_000), Math.sqrt(0.1));
  close(impactPct(100_000, 100_000), 1);
  assert.equal(impactPct(5000, null), COSTS.impactCoefPct);
  assert.equal(impactPct(0, 1000), 0);
});

test('round-trip cost: spread + 2 × impact + fees, floored at 0.5 pp, and an assumed spread is flagged', () => {
  const c = roundTripCost({ price: 5, shares: 1000, spread: 1, minuteDollars: 500_000 });
  // 1% spread + 2 × 1% × √(5000/500000)=0.2% + fees (SEC 0.139 + TAF 0.166 on $5000 ≈ 0.0061%)
  close(c.modelPct, 1 + 0.2 + ((0.0000278 * 5000 + 0.166) / 5000) * 100, 1e-9);
  assert.equal(c.floored, false);
  close(c.totalUsd, 5000 * c.totalPct / 100);
  close(c.stopExtraPerShare, 0.05);
  const tight = roundTripCost({ price: 5, shares: 10, spread: 0.05, minuteDollars: 5e6 });
  assert.equal(tight.floored, true);
  assert.equal(tight.totalPct, 0.5);
  const unknown = roundTripCost({ price: 5, shares: 10, minuteDollars: 5e6 });
  assert.equal(unknown.spreadSource, 'ASSUMED');
  assert.equal(unknown.spreadPct, COSTS.fallbackSpreadPct);
  assert.equal(roundTripCost({ price: 0, shares: 1 }), null);
  // Commission is charged on both orders.
  close(roundTripCost({ price: 5, shares: 1000, spread: 1, minuteDollars: 500_000, commission: 1 }).feesUsd - c.feesUsd, 2);
});

test('sizing keeps the all-in loss at the stop within the risk budget', () => {
  const plan = { entry: 2.02, stop: 1.98, targets: [2.06, 2.1] };
  const s = sizeWithCosts(plan, { riskBudget: 4, capital: 1000, spread: 0.0495, minuteDollars: 50_000 / 3 });
  assert.equal(s.shares, 78);
  assert.ok(s.lossAtStopUsd <= 4);
  assert.ok(sizeWithCosts(plan, { riskBudget: 4, capital: 1000, spread: 0.0495, minuteDollars: 50_000 / 3 }).lossAtStopUsd > 3.9);
  assert.equal(s.limitedBy, 'RISK');
  close(s.costR, s.costUsd / s.plannedRisk);
  assert.ok(s.netRewards[1] < s.rewards[1]);
  // Capital bound
  assert.equal(sizeWithCosts(plan, { riskBudget: 1000, capital: 202, spread: 0.05, minuteDollars: 1e6 }).limitedBy, 'CAPITAL');
  // Liquidity bound: 10% of a $2,020 minute = $202 = 100 shares
  const l = sizeWithCosts(plan, { riskBudget: 1000, capital: 1e6, spread: 0.05, minuteDollars: 2020 });
  assert.equal(l.limitedBy, 'LIQUIDITY');
  assert.equal(l.shares, 100);
  // Invalid inputs
  assert.equal(sizeWithCosts({ entry: 2, stop: 2 }, { riskBudget: 10, capital: 10 }), null);
  assert.equal(sizeWithCosts(plan, { riskBudget: 0, capital: 10 }), null);
  assert.equal(sizeWithCosts(plan, { riskBudget: 0.01, capital: 1000, spread: 0.05, minuteDollars: 1e6 }).shares, 0);
});

test('large orders step down until impact-inclusive loss fits', () => {
  const plan = { entry: 1, stop: 0.95 };
  const s = sizeWithCosts(plan, { riskBudget: 500, capital: 1e9, spread: 1, minuteDollars: 1e9 });
  assert.ok(s.lossAtStopUsd <= 500 * (1 + 1e-9));
  assert.ok(s.shares < 10_000, 'pre-cost size would be 10,000 shares');
  assert.ok(s.shares > 7_000);
});

test('liquidity cap is the tighter of 10% of a minute and 1% of the day', () => {
  assert.equal(liquidityCap({ minuteDollars: 10_000, dayDollars: 50_000 }), 500);
  assert.equal(liquidityCap({ minuteDollars: 10_000 }), 1000);
  assert.equal(liquidityCap({}), Infinity);
  close(costInR({ entry: 2, stop: 1.9, spread: 0.05, minuteDollars: 1e7 }), (2 * 0.005) / 0.1);
});

// ---- tradeability gate ------------------------------------------------------------------

const now = Date.parse('2026-09-16T15:00:00Z'); // 11:00 New York
const at = (d = 0) => new Date(now + d).toISOString();
const liveRow = (o = {}) => ({
  symbol: 'AAA', price: 2.02, price_at: at(-1000), quote_at: at(-1000), bid: 2.019, ask: 2.02, previous_close: 1.9,
  extended: false, day_change: 6, float_shares: 20e6, signal: { dollars_3m: 150_000, return_3m: 1 }, ...o,
});

test('gate passes a liquid, tight, fresh stock and never mentions probability', () => {
  const g = tradeability(liveRow(), { now, plan: { entry: 2.02, stop: 1.9 } });
  assert.equal(g.verdict, 'OK');
  assert.equal(g.label, 'التنفيذ ممكن وفق البيانات الحالية');
  assert.ok(!/احتمال/.test(g.reasons.map((r) => r.text).join(' ')));
});

test('gate blocks halts, stale data, wide spreads, thin liquidity, costly plans, closed market and delayed feed', () => {
  const plan = { entry: 2.02, stop: 1.9 };
  const blocked = (row, opts = {}) => tradeability(row, { now, plan, ...opts });
  assert.equal(blocked(liveRow({ halt: { reason_code: 'T1' } })).verdict, 'NO');
  assert.equal(blocked(liveRow({ price_at: at(-60_000) })).verdict, 'NO');
  assert.equal(blocked(liveRow({ quote_at: at(-60_000) })).verdict, 'NO');
  assert.equal(blocked(liveRow({ bid: 1.98, ask: 2.02 })).verdict, 'NO', '2% spread');
  assert.equal(blocked(liveRow({ signal: { dollars_3m: 9000 } })).verdict, 'NO');
  assert.equal(blocked(liveRow(), { plan: { entry: 2.02, stop: 2.0 } }).verdict, 'NO', '0.5% cost on a 1% stop is ≥ 0.5 R');
  assert.equal(blocked(liveRow(), { now: Date.parse('2026-09-19T15:00:00Z') }).verdict, 'NO', 'Saturday');
  assert.equal(blocked(liveRow(), { feed: 'delayed_sip' }).verdict, 'NO');
  assert.equal(blocked(liveRow(), { connected: false }).verdict, 'NO');
});

test('gate warns on sub-dollar, low float, extension, filings risk and wide-but-allowed spread; SSR is informational', () => {
  const plan = { entry: 2.02, stop: 1.9 };
  const warn = (row, risk) => tradeability(row, { now, plan, risk });
  assert.equal(warn(liveRow({ price: 0.8, bid: 0.7995, ask: 0.8, previous_close: 0.75 }), null).verdict, 'CAUTION');
  assert.equal(warn(liveRow({ float_shares: 3e6 })).verdict, 'CAUTION');
  assert.equal(warn(liveRow({ day_change: 40 })).verdict, 'CAUTION');
  assert.equal(warn(liveRow({ bid: 2.0, ask: 2.02 })).verdict, 'CAUTION', '1% spread');
  assert.equal(warn(liveRow(), { level: 'HIGH', items: [{ level: 'HIGH', kind: 'OFFERING', label: 'طرح' }] }).verdict, 'CAUTION');
  const ssr = tradeability(liveRow({ previous_close: 2.4 }), { now, plan });
  assert.equal(ssr.ssr, 'ACTIVE');
  assert.ok(ssr.reasons.some((r) => r.level === 'INFO'));
  assert.equal(ssrState({ price: 2, previous_close: 2.1 }), 'UNKNOWN');
  assert.equal(GATE.blockCostR, 0.5);
});

test('liquidity uses the larger of the IEX 3-minute value and the consolidated day average', () => {
  const l = liquidityOf(liveRow({ consolidated: { volume: 9_000_000 } }), now); // 90 minutes into the session
  close(l.minuteDollars, (9_000_000 * 2.02) / 90);
  assert.equal(l.source, 'DAY_AVERAGE');
  assert.equal(liquidityOf(liveRow(), now).source, 'IEX_3M');
  assert.equal(liquidityOf({ price: 2 }, now).source, 'NONE');
});

// ---- dossier ----------------------------------------------------------------------------

function scanRow(o = {}) {
  return {
    symbol: 'AAA', name: 'AAA Inc', market_cap: 5e7, price: 2.02, price_at: at(-1000), quote_at: at(-1000), bid: 2.019, ask: 2.02,
    previous_close: 1.9, extended: false, actionable: true, score: 50, day_volume: 1e6,
    plan: { entry: 2.02, stop: 1.98, targets: [2.06, 2.1] },
    signal: { ready: true, expansion: true, bar_at: at(-70000), bars: 20, return_3m: 1, volume_ratio: 3, dollars_3m: 50000, trades_3m: 100,
      volume_concentration: 0.5, vwap_window: 2, plan_valid: true, trigger: 2.02, stop: 1.98 },
    ...o,
  };
}
const payload = (rows) => ({ schema_version: 1, status: 'OK', feed: 'iex', server_time: at(), rows, alerts: [], gainers: [], coverage: { eligible_small_caps: 1, with_prices: 1, fresh_prices: 1 } });

test('dossier shows the gate and a blocked stock gets no plan or calculator', () => {
  const state = createState({ settings: { capital: '1000', risk: '50' } });
  // Every check passes, but a 1% stop leaves the 0.5% round trip at ≥ 0.5 R: blocked by cost.
  applyScan(state, payload([scanRow({ plan: { entry: 2.02, stop: 2.0, targets: [2.04, 2.06] }, signal: { ...scanRow().signal, stop: 2.0 } })]), now);
  state.ui.selected = 'AAA';
  const overview = String(renderDossier(state, now));
  assert.match(overview, /قابلية التنفيذ الآن/);
  assert.match(overview, /غير قابل للتداول الآن/);
  state.ui.tab = 'plan';
  const plan = String(renderDossier(state, now));
  assert.match(plan, /الخطة موقوفة لأن السهم غير قابل للتداول الآن/);
  assert.doesNotMatch(plan, /class="calc-result"/);
});

// ---- paper ledger -----------------------------------------------------------------------

const bar = (iso, o, h, l, c, v = 10_000) => ({ t: iso, o, h, l, c, v, n: 50, vw: c });
const day = '2026-09-25';
const { open: OPEN, close: CLOSE } = session(day);
const m = (k) => new Date(OPEN + k * 60_000).toISOString();
const signal = { symbol: 'AAA', plan_valid: true, trigger: 2.0, stop: 1.9 };
const baseBars = [bar(m(0), 1.95, 1.96, 1.94, 1.95), bar(m(1), 1.95, 1.97, 1.95, 1.96), bar(m(2), 1.96, 1.99, 1.96, 1.98)];

test('paper trade hits the 2R target and nets costs; R is measured on the actual entry', () => {
  const bars = [...baseBars, bar(m(3), 2.0, 2.05, 1.99, 2.04), bar(m(4), 2.04, 2.21, 2.03, 2.2)];
  const t = simulate(bars, signal, { visibleAt: OPEN + 3 * 60_000, open: OPEN, close: CLOSE, spread: 0.5 });
  assert.equal(t.status, 'TRADED');
  assert.equal(t.exit_kind, 'TARGET_2R');
  close(t.exit, 2.2, 1e-4);
  close(t.gross_r, 2, 1e-3);
  assert.ok(t.net_r < 2 && t.net_r > 1.5);
  close(t.net_usd, t.gross_usd - t.cost_usd, 0.02);
  assert.ok(Math.abs(t.net_usd) <= 1e4);
});

test('a gap below the stop exits at the open, pays the stop slippage and loses more than 1R', () => {
  const bars = [...baseBars, bar(m(3), 2.0, 2.01, 1.95, 1.99), bar(m(4), 1.8, 1.82, 1.78, 1.8)];
  const t = simulate(bars, signal, { visibleAt: OPEN + 3 * 60_000, open: OPEN, close: CLOSE, spread: 0.5 });
  assert.equal(t.exit_kind, 'STOP_GAP');
  assert.ok(t.net_r < -2);
  // A normal stop loses 1R plus costs; here the size is capped at 1% of the session's dollar volume.
  const s = simulate([...baseBars, bar(m(3), 2.0, 2.01, 1.89, 1.9)], signal, { visibleAt: OPEN + 3 * 60_000, open: OPEN, close: CLOSE, spread: 0.5 });
  assert.equal(s.exit_kind, 'STOP');
  assert.equal(s.limited_by, 'LIQUIDITY');
  assert.equal(s.shares, 294);
  assert.ok(s.net_r < -1 && s.net_r > -1.3);
  assert.ok(s.net_usd >= -100);
});

test('paper trades skip chased, invalid and missing plans; time exits cap at the close', () => {
  const opts = { visibleAt: OPEN + 3 * 60_000, open: OPEN, close: CLOSE };
  assert.equal(simulate([...baseBars, bar(m(3), 2.05, 2.06, 2.04, 2.05)], signal, opts).status, 'CHASED');
  assert.equal(simulate([...baseBars, bar(m(3), 1.85, 1.9, 1.8, 1.85)], signal, opts).status, 'INVALIDATED');
  assert.equal(simulate([...baseBars, bar(m(3), 2.0, 2.0, 2.0, 2.0)], { ...signal, plan_valid: false }, opts).status, 'NO_PLAN');
  assert.equal(simulate(baseBars, signal, opts).status, 'NO_ENTRY');
  const late = [bar(m(386), 1.95, 1.96, 1.95, 1.96), bar(m(387), 1.96, 1.97, 1.96, 1.97), bar(m(388), 1.97, 1.98, 1.97, 1.98), bar(m(389), 2.0, 2.01, 1.99, 2.01)];
  const t = simulate(late, signal, { visibleAt: OPEN + 389 * 60_000, open: OPEN, close: CLOSE });
  assert.equal(t.exit_kind, 'SESSION_END');
  assert.equal(t.spread_source, 'ASSUMED');
});

test('paper gate marks halted, thin and costly entries without dropping them', () => {
  const bars = [...baseBars.map((b) => ({ ...b, v: 100 })), bar(m(3), 2.0, 2.01, 1.99, 2.0, 100)];
  const halts = new Map([['AAA', [{ from: OPEN + 2 * 60_000, to: OPEN + 3 * 60_000 + 30_000 }]]]);
  const t = simulate(bars, { ...signal, stop: 1.99 }, { visibleAt: OPEN + 3 * 60_000, open: OPEN, close: CLOSE, spread: 2, halts });
  assert.equal(t.status, 'TRADED');
  assert.equal(t.gate, 'GATED');
  assert.deepEqual(t.gate_reasons, ['HALTED', 'SPREAD', 'LIQUIDITY', 'COST']);
});

test('liquidity before entry uses only completed bars', () => {
  const l = liquidityBefore(baseBars, OPEN + 2 * 60_000, OPEN);
  close(l.minuteDollars, (1.95 * 10_000 + 1.96 * 10_000) / 3);
  close(l.dayDollars, 1.95 * 10_000 + 1.96 * 10_000);
  close(medianSpread([{ bp: 1.98, ap: 2.02 }, { bp: 1.99, ap: 2.01 }, { bp: 0, ap: 2 }]), 1.5);
  assert.equal(medianSpread([]), null);
});

test('halt history parses resumed and open halts in New York time', () => {
  const xml = `<rss><channel><item><ndaq:HaltDate>09/25/2026</ndaq:HaltDate><ndaq:HaltTime>10:01:02</ndaq:HaltTime><ndaq:IssueSymbol>AAA</ndaq:IssueSymbol>
    <ndaq:ReasonCode>LUDP</ndaq:ReasonCode><ndaq:ResumptionDate>09/25/2026</ndaq:ResumptionDate><ndaq:ResumptionTradeTime>10:06:02</ndaq:ResumptionTradeTime></item>
    <item><ndaq:HaltDate>09/25/2026</ndaq:HaltDate><ndaq:HaltTime>15:00:00</ndaq:HaltTime><ndaq:IssueSymbol>BBB</ndaq:IssueSymbol><ndaq:ResumptionTradeTime></ndaq:ResumptionTradeTime></item></channel></rss>`;
  const h = parseHaltHistory(xml);
  assert.equal(h.get('AAA')[0].from, Date.parse('2026-09-25T14:01:02Z'));
  assert.equal(h.get('AAA')[0].to, Date.parse('2026-09-25T14:06:02Z'));
  assert.equal(h.get('BBB')[0].to, Infinity);
  assert.equal(haltedAt(h, 'AAA', Date.parse('2026-09-25T14:03:00Z')), true);
  assert.equal(haltedAt(h, 'AAA', Date.parse('2026-09-25T14:07:00Z')), false);
  assert.equal(haltDuring(h, 'AAA', Date.parse('2026-09-25T13:50:00Z'), Date.parse('2026-09-25T14:02:00Z')), true);
  assert.equal(nyTime('12/01/2026', '09:30:00'), Date.parse('2026-12-01T14:30:00Z'));
  assert.equal(nyTime('bad', '09:30:00'), null);
});

test('statistics: Wilson interval, reproducible session-block bootstrap, verdict needs a minimum sample', () => {
  const w = wilson(50, 100);
  close(w[0], 0.4038, 1e-3);
  close(w[1], 0.5962, 1e-3);
  assert.equal(wilson(0, 0), null);
  const days = [[1, -1], [0.5], [-0.2, 0.1, 0.3]];
  assert.deepEqual(blockBootstrap(days), blockBootstrap(days));
  assert.equal(blockBootstrap([[1]]), null);
  const trade = (net) => ({ net_usd: net * 100, gross_usd: net * 100 + 10, cost_usd: 10, net_r: net, gross_r: net + 0.1, cost_r: 0.1, exit_kind: 'TIME_30M', spread_source: 'QUOTE' });
  const s = summarizeBook([{ date: '2026-09-28', trades: [trade(1), trade(-1)] }, { date: '2026-09-29', trades: [trade(0.5)] }]);
  assert.equal(s.trades, 3);
  assert.equal(s.net_usd, 50);
  close(s.mean_net_r, 0.5 / 3, 1e-4);
  assert.equal(s.verdict, 'INSUFFICIENT_SAMPLE');
  assert.deepEqual(s.curve.map((c) => c.cum_net_usd), [0, 50]);
});

test('ledger keeps books apart, counts skipped signals and never allows a profitability claim', () => {
  const tr = { status: 'TRADED', net_usd: -20, gross_usd: -5, cost_usd: 15, net_r: -0.2, gross_r: -0.05, cost_r: 0.15, exit_kind: 'STOP', spread_source: 'QUOTE' };
  const d = { date: '2026-09-28', records: [
    { book: 'SIP_DELAYED', ...tr, gate: 'PASSED' }, { book: 'SIP_DELAYED', ...tr, gate: 'GATED' }, { book: 'SIP_DELAYED', status: 'CHASED' },
    { book: 'LIVE_ALERTS', status: 'NO_ENTRY' },
  ] };
  const l = buildLedger([d]);
  assert.equal(l.protocol, PROTOCOL);
  assert.equal(l.forward_start, FORWARD_START);
  assert.equal(l.profitability_claim_allowed, false);
  assert.equal(l.books.SIP_DELAYED.all.trades, 2);
  assert.equal(l.books.SIP_DELAYED.gate_passed.trades, 1);
  assert.equal(l.books.LIVE_ALERTS.all.trades, 0);
  assert.deepEqual(l.signal_status.SIP_DELAYED, { TRADED: 2, CHASED: 1 });
  assert.equal(l.days[0].net_usd, -40);
});

test('evidence shows the paper ledger card with net P&L and an explicit no-verdict note', () => {
  const tr = { status: 'TRADED', symbol: 'AAA', entry_at: '2026-09-28T14:00:00Z', exit_kind: 'STOP', net_usd: -20, gross_usd: -5, cost_usd: 15, net_r: -0.2, gross_r: -0.05, cost_r: 0.15, spread_source: 'QUOTE', gate: 'PASSED' };
  const l = buildLedger([{ date: '2026-09-28', records: [{ book: 'SIP_DELAYED', ...tr }] }]);
  const out = String(renderEvidence({ paper: l }));
  assert.match(out, /سجل التداول الورقي/);
  assert.match(out, /لا حكم قبل/);
  assert.match(out, /-\$20/);
  const empty = String(renderEvidence({ paper: buildLedger([]) }));
  assert.match(empty, /لم تُسجَّل جلسة/);
});
