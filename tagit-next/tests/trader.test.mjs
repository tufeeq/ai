// Trader-workflow regressions found by the 2026-09-29 market-workspace review (reports/review-trader.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, applyScan, visibleRows, metrics, nextQuoteSymbols, displayOrder, assessRow,
} from '../src/state.js';
import { renderDossier } from '../src/views/dossier.js';
import { renderList, emptyText } from '../src/views/list.js';
import { samplesChart, planLadder } from '../src/views/charts.js';
import { tradeability } from '../src/core/tradeability.js';
import { cleanAmount } from '../src/core/sizing.js';

const now = Date.parse('2026-09-16T15:00:00Z'); // Wednesday 11:00 New York
const at = (d = 0, base = now) => new Date(base + d).toISOString();

function row(symbol, o = {}, base = now) {
  const trigger = o.trigger ?? 2.02, stop = o.stop ?? 1.94;
  return {
    symbol, name: `${symbol} Inc`, market_cap: 5e7, price: 2.0, price_at: at(-1000, base), quote_at: at(-1000, base), bid: 1.998, ask: 2.002,
    previous_close: 1.9, extended: false, actionable: true, score: 50, day_volume: 1e6,
    plan: { entry: trigger, stop, targets: [trigger + (trigger - stop), trigger + 2 * (trigger - stop)] },
    signal: {
      ready: true, expansion: true, bar_at: at(-70000, base), bars: 20, return_3m: 1, volume_ratio: 3, dollars_3m: 90000, trades_3m: 100,
      volume_concentration: 0.5, vwap_window: 1.95, plan_valid: true, trigger, stop,
    },
    ...o,
  };
}
const payload = (rows, base = now) => ({
  schema_version: 1, status: 'OK', feed: 'iex', server_time: at(0, base), rows, alerts: [], gainers: rows.map((r) => r.symbol),
  coverage: { eligible_small_caps: rows.length, with_prices: rows.length, fresh_prices: rows.length },
});

test('a plan the execution gate blocks is not advertised anywhere (list, filter, KPI, dossier)', () => {
  const state = createState({ settings: { capital: '5000', risk: '50', commission: '' } });
  // 0.6% stop: the 0.5% cost floor alone is ≥ 0.5 R, so the gate says NO.
  applyScan(state, payload([row('GOOD'), row('TIGHT', { trigger: 2.02, stop: 2.008, price: 2.012, bid: 2.008, ask: 2.016 })]), now);
  const tight = assessRow(state, state.stocks.get('TIGHT'), now);
  assert.equal(tight.gate.verdict, 'NO');
  assert.equal(tight.state, 'BLOCKED');
  assert.equal(tight.plan, null);
  assert.ok(tight.heldPlan);
  assert.equal(assessRow(state, state.stocks.get('GOOD'), now).state, 'READY');
  assert.equal(metrics(state, now).plans, 1);
  state.ui.filter = 'READY';
  assert.deepEqual(visibleRows(state, now).map((r) => r.symbol), ['GOOD']);
  state.ui.filter = 'all';
  assert.match(String(renderList(state, now).markup), /s-BLOCKED/);
  state.ui.selected = 'TIGHT';
  state.ui.tab = 'overview';
  assert.doesNotMatch(String(renderDossier(state, now)), /كل الشروط مستوفاة الآن، والخطة صالحة/);
  state.ui.tab = 'plan';
  const plan = String(renderDossier(state, now));
  assert.match(plan, /الخطة موقوفة/);
  assert.doesNotMatch(plan, /خطة مشروطة متاحة الآن/);
  assert.doesNotMatch(plan, /calc-result/);
});

test('outside the regular session a stop-entry plan is blocked, not merely cautioned', () => {
  const pre = Date.parse('2026-09-16T12:30:00Z'); // 08:30 New York
  const r = row('AAA', {}, pre);
  const g = tradeability(r, { now: pre, plan: { entry: 2.02, stop: 1.94 } });
  assert.equal(g.verdict, 'NO');
  assert.ok(g.reasons.some((x) => x.level === 'BLOCK' && /خارج الجلسة النظامية/.test(x.text)));
  const after = Date.parse('2026-09-16T21:00:00Z');
  assert.equal(tradeability(row('AAA', {}, after), { now: after, plan: { entry: 2.02, stop: 1.94 } }).verdict, 'NO');
  const state = createState();
  applyScan(state, payload([row('AAA', {}, pre)], pre), pre);
  assert.equal(assessRow(state, state.stocks.get('AAA'), pre).state, 'BLOCKED');
});

test('a spread from a stale quote is neither shown nor costed as current', () => {
  const g = tradeability(row('AAA', { quote_at: at(-20 * 60_000) }), { now, plan: { entry: 2.02, stop: 1.94 } });
  assert.equal(g.spread, null);
  assert.equal(g.costR, null);
  assert.ok(g.reasons.some((x) => /لا عرض وطلب حديث/.test(x.text)));
});

test('calculator accepts Arabic-Indic digits and the Arabic decimal separator', () => {
  assert.equal(cleanAmount('٥٠٠٠'), '5000');
  assert.equal(cleanAmount('۱۲۵۰'), '1250');
  assert.equal(cleanAmount('٤٫٥'), '4.5');
  assert.equal(cleanAmount('5,000.50'), '5000.50');
  assert.equal(cleanAmount('1.2.3'), '1.23');
  assert.equal(cleanAmount('$ 50'), '50');
  assert.equal(cleanAmount(null), '');
});

test('quote rotation reaches every row within a full cycle and restarts at the top', () => {
  const state = createState();
  applyScan(state, payload(Array.from({ length: 25 }, (_, i) => row(`R${String.fromCharCode(65 + i)}`, { score: 100 - i }))), now);
  const seen = new Set();
  const first = nextQuoteSymbols(state, now);
  first.forEach((s) => seen.add(s));
  nextQuoteSymbols(state, now).forEach((s) => seen.add(s));
  assert.equal(seen.size, 25, 'two batches of 19 cover 25 rows');
  assert.deepEqual(nextQuoteSymbols(state, now), first, 'third call restarts at the first row');
});

test('the first displayed row, not a halted one, is what gets auto-selected', () => {
  const state = createState();
  applyScan(state, payload([
    row('HALT', { score: 99, halt: { reason_code: 'LUDP' }, actionable: false, plan: null }),
    row('GOOD', { score: 10 }),
  ]), now);
  // The unsorted visible order puts the halted, higher-scored row first; the list shows GOOD first.
  assert.equal(displayOrder(state, now)[0].symbol, 'GOOD');
});

test('empty lists say why they are empty', () => {
  const state = createState();
  assert.match(emptyText(state), /بانتظار أول مسح/);
  state.connection.phase = 'error';
  assert.match(emptyText(state), /تعذر الوصول/);
  applyScan(state, payload([]), now);
  assert.match(emptyText(state), /لم يُرجع أي سهم/);
  state.ui.search = 'zz';
  assert.match(emptyText(state), /تطابق البحث/);
  state.ui.search = '';
  state.ui.view = 'watch';
  assert.match(emptyText(state), /قائمتك فارغة/);
  const list = renderList({ ...state, ui: { ...state.ui, view: 'early' } }, now);
  assert.equal(list.count, 0);
  assert.ok(list.empty);
});

test('a row without a signal shows a dash, not "—×"', () => {
  const state = createState();
  applyScan(state, payload([row('NOSG', { signal: null, actionable: false, plan: null })]), now);
  state.ui.view = 'gainers';
  assert.doesNotMatch(String(renderList(state, now).markup), /—×/);
});

test('outcome chart keeps its axis left-to-right and separates close price tags', () => {
  const t0 = now - 600_000;
  const points = Array.from({ length: 10 }, (_, i) => ({ at: at(i * 60_000, t0), price: 2 - i * 0.002 }));
  const svg = String(samplesChart({ start_price: 2, points }));
  assert.match(svg, /direction:ltr/);
  const ys = [...svg.matchAll(/class="chart-tag[^"]*" x="[\d.]+" y="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.equal(ys.length, 2);
  assert.ok(Math.abs(ys[0] - ys[1]) >= 12, `tags ${ys} overlap`);
});

test('the plan ladder does not call a stale price "now"', () => {
  const levels = [{ kind: 'entry', value: 2.02, label: 'e' }, { kind: 'stop', value: 1.94, label: 's' }];
  assert.match(String(planLadder(levels, 2, true)), /الآن/);
  const stale = String(planLadder(levels, 2, false));
  assert.doesNotMatch(stale, />الآن/);
  assert.match(stale, /غير حالي/);
});

test('the VWAP check shows the price with decimals, not a rounded "$2"', () => {
  const state = createState();
  applyScan(state, payload([row('AAA')]), now);
  state.ui.selected = 'AAA';
  state.ui.tab = 'overview';
  assert.match(String(renderDossier(state, now)), /\$1\.95/);
});

test('plan tab names the quote source instead of always saying IEX', () => {
  const state = createState();
  applyScan(state, payload([row('AAA', {
    consolidated: { source: 'NASDAQ_COM', real_time: true, price: 2.0, trade_minute_at: at(-30_000), bid: 1.999, ask: 2.001, volume: 1e6, fetched_at: at(-500) },
  })]), now);
  state.ui.selected = 'AAA';
  state.ui.tab = 'plan';
  assert.equal(state.stocks.get('AAA').quote_source, 'CONSOLIDATED');
  assert.match(String(renderDossier(state, now)), /مجمّع · ناسداك/);
});
