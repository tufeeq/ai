// review-signals: ranking, extension/fade handling, SIP list honesty and evidence wording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { assess, splitPriority, compareRows, isExtended } from '../src/core/checks.js';
import { fadeWarning, weekdaysBetween } from '../src/core/fade.js';
import { signalPhase, rankSipSignals, detectSymbol } from '../src/core/sipscan.js';
import { renderSipList, sipCard, sipEvidenceLine } from '../src/views/sip.js';
import { renderEvidence, bottomLineCard } from '../src/views/evidence.js';
import { createState, visibleRows } from '../src/state.js';

const now = Date.parse('2026-09-29T15:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

function liveRow(over = {}) {
  return {
    symbol: 'AAA', name: 'A', price: 2.02, price_at: iso(now - 2000), quote_at: iso(now - 2000), bid: 2.01, ask: 2.02,
    spread_pct: 0.5, extended: false, day_change: 5, actionable: true, scan_at: iso(now - 5000), market_cap: 50e6,
    plan: { entry: 2.02, stop: 1.95, targets: [2.09, 2.16] },
    signal: {
      ready: true, bars: 60, bar_at: iso(now - 90_000), return_3m: 1.2, volume_ratio: 3, dollars_3m: 60_000, trades_3m: 80,
      volume_concentration: 0.4, vwap_window: 1.9, plan_valid: true, trigger: 2.0, stop: 1.95, expansion: true,
    },
    ...over,
  };
}
const opts = { now, serverTime: iso(now - 5000), feed: 'iex' };
const fadeHit = { day: '2026-09-25', events: ['gap_hold'], sessions_since: 1 };

test('a fade-flagged row is never READY, is EXTENDED and stays out of the priority tier', () => {
  assert.equal(assess(liveRow(), opts).state, 'READY');
  const a = assess(liveRow(), { ...opts, fade: fadeHit });
  assert.equal(a.state, 'EXTENDED');
  assert.equal(a.plan, null);
  assert.equal(a.checks.find((c) => c.key === 'extension').pass, false);
  assert.match(a.blockers[0], /امتداد يومي/);
  assert.equal(splitPriority([liveRow()], opts).upper.length, 1);
  assert.equal(splitPriority([liveRow()], { ...opts, fadeOf: () => fadeHit }).upper.length, 0);
  assert.ok(isExtended(liveRow(), fadeHit));
  assert.ok(!isExtended(liveRow()));
});

test('ranking ignores the server score, which rewards chasing', () => {
  const calm = liveRow({ symbol: 'CALM', score: 10, signal: { ...liveRow().signal, return_3m: 0.9 } });
  const hot = liveRow({ symbol: 'HOT', score: 99, signal: { ...liveRow().signal, return_3m: 4.5 } });
  const { upper } = splitPriority([hot, calm], opts);
  assert.deepEqual(upper.map((r) => r.symbol), ['CALM', 'HOT']);
  const a = { passed: 12 };
  assert.ok(compareRows(calm, a, hot, a) < 0);
  // extended rows sort after non-extended ones with the same passed count
  assert.ok(compareRows(hot, a, calm, a, (r) => (r.symbol === 'CALM' ? fadeHit : null)) < 0);
});

test('state: early list drops fade-flagged symbols and sorts without score', () => {
  const state = createState();
  state.connection.phase = 'live';
  state.scan = { server_time: iso(now - 5000), feed: 'iex', order: ['HOT', 'CALM', 'FADE'] };
  state.fadeFlags = { as_of: '2026-09-28', sessions: ['2026-09-28', '2026-09-25', '2026-09-24', '2026-09-23', '2026-09-22'], symbols: { FADE: { d: '2026-09-25', events: ['spike_50'] } } };
  state.stocks.set('HOT', liveRow({ symbol: 'HOT', score: 99, signal: { ...liveRow().signal, return_3m: 4.5 } }));
  state.stocks.set('CALM', liveRow({ symbol: 'CALM', score: 5, signal: { ...liveRow().signal, return_3m: 0.9 } }));
  state.stocks.set('FADE', liveRow({ symbol: 'FADE', score: 50 }));
  assert.deepEqual(visibleRows(state, now).map((r) => r.symbol), ['CALM', 'HOT']);
});

test('fade flags expire when the published list is stale', () => {
  const flags = { as_of: '2026-09-28', sessions: ['2026-09-28', '2026-09-25', '2026-09-24', '2026-09-23', '2026-09-22'], symbols: { AAA: { d: '2026-09-25', events: ['gap_hold'] }, BBB: { d: '2026-09-22', events: ['momentum_5d'] } } };
  assert.equal(weekdaysBetween('2026-09-25', '2026-09-28'), 0);
  assert.equal(weekdaysBetween('2026-09-28', '2026-10-02'), 3);
  assert.equal(fadeWarning(flags, 'AAA', '2026-09-29').sessions_since, 1);
  assert.equal(fadeWarning(flags, 'BBB', '2026-09-29').sessions_since, 4);
  assert.equal(fadeWarning(flags, 'AAA').sessions_since, 1); // no date: previous behaviour
  // list stuck at 09-28, viewed 10-02: three sessions it never saw have passed
  assert.equal(fadeWarning(flags, 'BBB', '2026-10-02'), null);
  assert.equal(fadeWarning(flags, 'AAA', '2026-10-02').sessions_since, 4);
  assert.equal(fadeWarning(flags, 'AAA', '2026-10-05'), null);
});

test('SIP signal phase follows the studied timing (visible 17 min, entry window 2 min, 30 min hold)', () => {
  const at = (min) => ({ symbol: 'X', detected_at: iso(now - min * 60_000), return_3m: 1 });
  assert.equal(signalPhase(at(18), now), 'ENTRY');
  assert.equal(signalPhase(at(25), now), 'LATE');
  assert.equal(signalPhase(at(48), now), 'EXPIRED');
  assert.equal(signalPhase({ detected_at: 'x' }, now), 'EXPIRED');
});

test('SIP ranking puts extended, fade-flagged and expired signals last', () => {
  const s = (symbol, min, r3 = 1) => ({ symbol, detected_at: iso(now - min * 60_000), return_3m: r3, volume_ratio: 3 });
  const ranked = rankSipSignals([s('OLD', 90), s('EXT', 18, 9.5), s('FAD', 18), s('OK', 20), s('NEW', 17.5)], now, (sym) => (sym === 'FAD' ? fadeHit : null));
  assert.deepEqual(ranked.map((x) => x.symbol), ['NEW', 'OK', 'EXT', 'FAD', 'OLD']);
  assert.equal(ranked.find((x) => x.symbol === 'EXT').extended, true);
  assert.equal(ranked.find((x) => x.symbol === 'FAD').warned, true);
});

test('detectSymbol marks a 3-minute burst above the early-move limit as extended', () => {
  const open = Date.parse('2026-09-28T13:30:00Z');
  const bars = [];
  for (let i = 0; i < 30; i++) bars.push({ t: iso(open + i * 60_000), o: 1, h: 1.001, l: 0.999, c: 1, v: 10_000, n: 20, vw: 1 });
  bars.push({ t: iso(open + 30 * 60_000), o: 1, h: 1.04, l: 1, c: 1.04, v: 100_000, n: 50, vw: 1.02 });
  bars.push({ t: iso(open + 31 * 60_000), o: 1.04, h: 1.08, l: 1.04, c: 1.08, v: 100_000, n: 50, vw: 1.06 });
  bars.push({ t: iso(open + 32 * 60_000), o: 1.08, h: 1.12, l: 1.08, c: 1.12, v: 100_000, n: 50, vw: 1.1 });
  const sig = detectSymbol('ZZZ', bars);
  assert.equal(sig.length, 1);
  assert.ok(sig[0].return_3m > 8);
  assert.equal(sig[0].extended, true);
});

const sipEvidence = {
  sip: { sessions: 185, holdout: { delayed: { mean_return_pct: -0.793, win_rate: 0.356, resolved: 10776 } }, breakdowns_holdout: { price: { '< $1': { mean_return_pct: -0.9, resolved: 10 } } } },
  paper: { sessions: 1, books: { SIP_DELAYED: { all: { trades: 60, sessions: 1, net_usd: -933, mean_net_r: -4.39, mean_gross_r: -0.07, mean_cost_r: 4.32, hit_rate: 0.15, verdict: 'INSUFFICIENT_SAMPLE', curve: [] } } } },
};

test('SIP list shows the measured result, neutral position wording and warnings', () => {
  const state = createState();
  state.evidence = sipEvidence;
  state.sip = { phase: 'ok', result: { symbols: 800, with_bars: 790, failed: 0, window_end: iso(now - 17 * 60_000), signals: [
    { symbol: 'EXT', detected_at: iso(now - 18 * 60_000), price: 1, return_3m: 9.2, volume_ratio: 3, dollars_3m: 40_000, trigger: 1, stop: 0.95 },
    { symbol: 'OK', detected_at: iso(now - 18 * 60_000), price: 1, return_3m: 1.1, volume_ratio: 3, dollars_3m: 40_000, trigger: 1, stop: 0.95 },
  ] } };
  state.stocks.set('OK', { symbol: 'OK', price: 1.005, price_at: iso(now - 5000) });
  const out = String(renderSipList(state, now).markup);
  assert.match(out, /النتيجة المقاسة لهذه القائمة/);
  assert.match(out, /-0[.٫]79%/);
  assert.match(out, /لا توجد شريحة/);
  assert.match(out, /قرب مستوى الرصد/);
  assert.doesNotMatch(out, /ما زال قرب التفعيل/);
  assert.doesNotMatch(out, /p-NEAR/);
  assert.match(out, />ممتدة</);
  assert.ok(out.indexOf('data-symbol="OK"') < out.indexOf('data-symbol="EXT"'));
  assert.equal(sipEvidenceLine({}), '');
  const card = String(sipCard(state.sip.result.signals[0], null, now, sipEvidence));
  assert.match(card, /حركة ممتدة/);
  assert.match(card, /ليست خطة لحظية ولا توصية/);
});

test('evidence: bottom line first, honest zero-alert live record', () => {
  const fw = { totals: { days: 2, alerts: 0, resolved: 0 }, days: [{ summary: { date: '2026-09-29', alerts: 0, resolved: 0, mean_return_after_cost_pct: null, health: { reachable: 0, samples: 0 } } }], source: 'x', updated_at: iso(now) };
  const out = String(renderEvidence({ ...sipEvidence, forward: fw }));
  assert.ok(out.indexOf('الخلاصة') < out.indexOf('السجل الحي'));
  assert.match(out, /لا توجد قاعدة شراء أو بيع ثبت ربحها/);
  assert.match(out, /لم تُسجَّل أي تنبيهات من القائمة الحية في 2 يوم/);
  assert.match(out, /IEX/);
  assert.equal(String(bottomLineCard({})), '');
});

test('published data renders the bottom line and all-negative holdout breakdowns', () => {
  const j = (f) => { const u = new URL(`../data/${f}`, import.meta.url); return existsSync(u) ? JSON.parse(readFileSync(u, 'utf8')) : null; };
  const e = { sip: j('sip-outcomes.json'), paper: j('paper-ledger.json'), fade: j('fade-study.json'), exits: j('exit-study.json'), filters: j('filter-study.json'), daily: j('daily-study.json'), forward: j('forward-outcomes.json') };
  if (!e.sip) return;
  const out = String(renderEvidence(e));
  assert.match(out, /الخلاصة/);
  assert.match(out, /كلها سالبة بعد التكلفة/);
});

test('integration: a row the execution gate blocks ranks after a tradeable row with the same checks', () => {
  const x = { symbol: 'AAA', signal: { return_3m: 1 } };
  const y = { symbol: 'BBB', signal: { return_3m: 2 } };
  const blocked = { passed: 10, state: 'BLOCKED' };
  const ready = { passed: 10, state: 'READY' };
  assert.ok(compareRows(x, blocked, y, ready) > 0);
  assert.ok(compareRows(y, ready, x, blocked) < 0);
});
