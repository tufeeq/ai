import test from 'node:test';
import assert from 'node:assert/strict';
import { assess } from '../src/core/checks.js';
import { pulseSummary, changeSince } from '../src/views/pulse.js';
import { createState, pulseToday, metrics } from '../src/state.js';

const now = Date.parse('2026-10-02T15:00:00Z'); // 11:00 New York
const iso = (ms) => new Date(ms).toISOString();
const consolidated = (minutesAgo) => ({ source: 'CONSOLIDATED_NASDAQ', trades_3m: null, ready: true, bars: 60, bar_at: iso(now - minutesAgo * 60_000 - 60_000),
  detected_at: iso(now - minutesAgo * 60_000), held: minutesAgo > 2, return_3m: 1.6, volume_ratio: 6, dollars_3m: 90_000, volume_concentration: 0.45,
  vwap_window: 2.9, expansion: true, plan_valid: true, trigger: 3.0, stop: 2.92 });
const row = (signal, extra = {}) => ({ symbol: 'NEOV', price: 3.02, price_at: iso(now - 40_000), price_source: 'CONSOLIDATED', quote_at: iso(now - 45_000),
  quote_source: 'CONSOLIDATED', bid: 3.0, ask: 3.03, spread_pct: 0.995, extended: false, day_change: 12, signal, actionable: true,
  plan: { entry: 3.03, stop: 2.92, targets: [3.14, 3.25], kind: 'CONDITIONAL' }, ...extra });

test('a consolidated signal keeps its plan for 20 minutes with a minute-old quote and a ~1% spread', () => {
  const a = assess(row(consolidated(12)), { now, serverTime: iso(now - 5_000), feed: 'iex' });
  assert.deepEqual(a.blockers, []);
  assert.equal(a.state, 'READY');
  assert.ok(a.plan);
  assert.equal(a.checks.find((c) => c.key === 'history').name, 'إشارة مجمّعة خلال آخر ٢٠ دقيقة');
});

test('past 20 minutes, a 2-minute-old quote, a wide spread or a chased price block the plan', () => {
  const at = (r) => assess(r, { now, serverTime: iso(now - 5_000), feed: 'iex' });
  assert.notEqual(at(row(consolidated(25))).state, 'READY');
  assert.notEqual(at(row(consolidated(5), { quote_at: iso(now - 120_000) })).state, 'READY');
  assert.notEqual(at(row(consolidated(5), { spread_pct: 2.2 })).state, 'READY');
  assert.notEqual(at(row(consolidated(5), { price: 3.03 * 1.03 })).state, 'READY');
  // IEX signals keep their stricter rules (bar under 150 s, 30 trades, 10 s quote).
  const iex = { ...consolidated(0), source: undefined, trades_3m: 40, detected_at: undefined };
  assert.notEqual(at(row(iex, { quote_source: 'IEX', quote_at: iso(now - 45_000) })).state, 'READY');
});

test("today's server ledger feeds the tab, the KPI and an honest outcome summary", () => {
  const state = createState();
  state.pulse = { supported: true, ledger: [
    { symbol: 'NEOV', detected_at: iso(now - 30 * 60_000), price: 2.93, observed: { m15: { return_pct: 1.2 }, m30: { return_pct: 3.2 }, max_return_pct: 3.4, last_return_pct: 3.2, last_at: iso(now - 60_000) } },
    { symbol: 'GIFT', detected_at: iso(now - 50 * 60_000), price: 0.69, observed: { m15: { return_pct: -8 }, m30: { return_pct: -20 }, stop_hit_at: iso(now - 40 * 60_000), max_return_pct: 0.4 } },
    { symbol: 'OLD', detected_at: '2026-10-01T15:00:00Z', price: 1, observed: {} },
  ] };
  const today = pulseToday(state, now);
  assert.deepEqual(today.map((e) => e.symbol), ['NEOV', 'GIFT']);
  const s = pulseSummary(today);
  assert.equal(s.count, 2);
  assert.equal(s.m30.n, 2);
  assert.equal(s.m30.up, 1);
  assert.equal(s.stopHits, 1);
  assert.equal(metrics(state, now).signalsToday, 2);
  // Live change prefers the page's newer price over the server's last observation.
  assert.equal(changeSince(today[0], { price: 2.93 * 1.05, price_at: iso(now) }).toFixed(2), '5.00');
  assert.equal(changeSince(today[0], null), 3.2);
});

test('signal rows describe the news recorded at detection', async () => {
  const { newsLine } = await import('../src/views/pulse.js');
  assert.equal(newsLine(undefined), null);
  assert.equal(newsLine({ count_2h: 0, count_24h: 0 }), 'بلا أخبار خلال ٢٤ ساعة قبل الرصد');
  assert.equal(newsLine({ count_2h: 1, count_24h: 1, latest_minutes_before: 12, latest_headline: 'Wins contract' }), 'خبر قبل 12 د: Wins contract');
  assert.equal(newsLine({ count_2h: 0, count_24h: 2, latest_minutes_before: 300, latest_headline: 'Q2 results' }), 'خبر قبل 5 س: Q2 results');
  assert.equal(newsLine({ error: true }), 'الأخبار: تعذر الجلب');
});
