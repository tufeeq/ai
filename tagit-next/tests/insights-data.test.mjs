import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  parseUniverse, breadth, groupStats, industryTable, movers, etfStats, regime, linkNews, themes, parseEarnings, parseEconomic,
  marketState, sessionOf, calendarDay, buildInsights, countAr, median, nyTime, MIN_INDUSTRY,
} from '../pipeline/insights.mjs';

const row = (t, industry, chg, cap, vol = 1_000_000, avg = '500', sector = 'Technology', price = '10') => ({
  Ticker: t, Company: `${t} Inc`, Sector: sector, Industry: industry, 'Market Cap': String(cap), Price: price,
  Change: `${chg}%`, Volume: String(vol), 'Avg Volume': avg,
});
const ROWS = [
  row('AAA', 'Semiconductors', 5, 1000), row('BBB', 'Semiconductors', 3, 3000), row('CCC', 'Semiconductors', 1, 200),
  row('DDD', 'Semiconductors', 2, 150), row('EEE', 'Semiconductors', 4, 500, 4_000_000),
  row('FFF', 'Banks - Regional', -2, 800, 1_000_000, '500', 'Financial'), row('GGG', 'Banks - Regional', -1, 900, 1_000_000, '500', 'Financial'),
  row('HHH', 'Banks - Regional', 0, 100, 1_000_000, '500', 'Financial'), row('III', 'Banks - Regional', -3, 250, 1_000_000, '500', 'Financial'),
  row('JJJ', 'Banks - Regional', -4, 90, 1_000_000, '500', 'Financial'),
  row('SPYX', 'Exchange Traded Fund', 9, '', 1_000_000, '500', 'Financial'), row('SHL', 'Shell Companies', 9, 50),
  { Ticker: 'BAD', Industry: 'Semiconductors', Change: '', Price: '5' },
];
const universe = { updatedAt: '2026-09-25T18:00:00Z', rows: ROWS };
const CAL = [{ date: '2026-09-24', open: '09:30', close: '16:00' }, { date: '2026-09-25', open: '09:30', close: '16:00' }, { date: '2026-09-28', open: '09:30', close: '16:00' }];
const bars = (n, f) => Array.from({ length: n }, (_, i) => ({ t: new Date(Date.UTC(2025, 11, 1, 5) + i * 86_400_000).toISOString(), c: f(i) }));

test('universe parsing drops funds, shells and rows without a change; unknowns stay null', () => {
  const s = parseUniverse(ROWS);
  assert.equal(s.length, 10);
  assert.ok(!s.some((x) => ['SPYX', 'SHL', 'BAD'].includes(x.symbol)));
  assert.equal(s.find((x) => x.symbol === 'EEE').rvol, 8);
  assert.equal(parseUniverse([{ ...row('X', 'Gold', 1, ''), Volume: '' }])[0].rvol, null);
});

test('breadth counts and ratio', () => {
  const b = breadth(parseUniverse(ROWS), 'all');
  assert.deepEqual([b.universe, b.advancers, b.decliners, b.unchanged, b.adv_dec_ratio, b.up_5pct, b.unusual_volume], [10, 5, 4, 1, 1.25, 1, 1]);
  assert.equal(b.new_high_20d, null);
  assert.equal(breadth([], 'x').adv_dec_ratio, null);
});

test('group stats: cap-weighted vs median, dollar-weighted relative volume', () => {
  const g = groupStats(parseUniverse(ROWS).filter((s) => s.industry === 'Semiconductors'));
  assert.equal(g.median_chg_pct, 3);
  assert.equal(g.chg_1d_pct, Math.round(((5 * 1000 + 3 * 3000 + 200 + 2 * 150 + 4 * 500) / 4850) * 100) / 100);
  assert.equal(g.breadth_pct_up, 100);
  assert.equal(g.rel_volume, 3.2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test('industries need ≥ MIN_INDUSTRY stocks and rank by median; bottom leaders are the worst', () => {
  const t = industryTable(parseUniverse([...ROWS, row('K1', 'Gold', 9, 100)]), 1);
  assert.equal(MIN_INDUSTRY, 5);
  assert.equal(t.top[0].industry, 'Semiconductors');
  assert.equal(t.top[0].name_ar, 'أشباه الموصلات');
  assert.deepEqual(t.top[0].leaders.map((l) => l.symbol), ['AAA', 'EEE', 'BBB']);
  assert.deepEqual(t.bottom[0].leaders.map((l) => l.symbol), ['JJJ', 'III', 'FFF']);
  assert.ok(!t.all.some((i) => i.industry === 'Gold'));
});

test('movers: price, cap and dollar-volume floors', () => {
  const s = parseUniverse([row('P1', 'Gold', 30, 40), row('P2', 'Gold', 20, 100, 50_000), row('P3', 'Gold', 10, 100), row('P4', 'Gold', -10, 100, 2_000_000, '100')]);
  const m = movers(s);
  assert.deepEqual(m.gainers.map((r) => r.symbol), ['P3']);
  assert.deepEqual(m.losers.map((r) => r.symbol), ['P4']);
  assert.deepEqual(m.unusual_volume.map((r) => r.symbol), ['P4']);
  assert.deepEqual(Object.keys(m.gainers[0]), ['symbol', 'company', 'sector', 'industry', 'price', 'chg_pct', 'rel_volume', 'market_cap_m', 'news_ids']);
});

test('ETF stats: returns, MAs, YTD from the last prior-year close, 30-close spark', () => {
  const e = etfStats(bars(260, (i) => 100 + i));
  assert.equal(e.last, 359);
  assert.equal(e.chg_1d_pct, Math.round((359 / 358 - 1) * 1e4) / 100);
  assert.equal(e.above_50dma, true);
  assert.equal(e.above_200dma, true);
  assert.equal(e.spark.length, 30);
  assert.equal(e.chg_ytd_pct, Math.round((359 / 130 - 1) * 1e4) / 100); // 2025-12-31 is index 30 → 130
  assert.equal(etfStats(bars(1, () => 5)), null);
  assert.equal(etfStats(bars(30, () => 5)).above_50dma, null);
  const cross = etfStats(bars(60, (i) => (i < 57 ? 100 : 110)));
  assert.equal(cross.crossed_50dma_3d, 'UP');
});

test('regime rules score and label', () => {
  const up = { above_50dma: true, above_200dma: true, chg_5d_pct: 2 };
  const r = regime({ SPY: up, QQQ: up, IWM: up, VIXY: { chg_5d_pct: -8 } }, { adv_dec_ratio: 2, advancers: 200, decliners: 100 });
  assert.equal(r.score, 6);
  assert.equal(r.key, 'RISK_ON');
  assert.equal(r.reasons_ar.length, 6);
  const dn = { above_50dma: false, above_200dma: false, chg_5d_pct: -3 };
  const o = regime({ SPY: dn, QQQ: dn, IWM: dn, TLT: { chg_5d_pct: 2 }, VIXY: { chg_5d_pct: 20 } }, { adv_dec_ratio: 0.5, advancers: 50, decliners: 100 });
  assert.equal(o.key, 'RISK_OFF');
  assert.equal(regime({}, null).key, 'UNKNOWN');
});

test('news linking uses symbol + session window only, and says so', () => {
  const s = parseUniverse(ROWS), by = new Map(s.map((x) => [x.symbol, x]));
  const win = { day: '2026-09-25', prevClose: nyTime('2026-09-24', '16:00'), open: nyTime('2026-09-25', '09:30'), close: nyTime('2026-09-25', '16:00') };
  const raw = [
    { id: 1, created_at: '2026-09-25T12:00:00Z', headline: 'AAA wins contract', symbols: ['AAA'], url: 'https://x/1', source: 'benzinga' },
    { id: 2, created_at: '2026-09-25T21:00:00Z', headline: 'AAA after close', symbols: ['AAA'], url: 'javascript:alert(1)' },
    { id: 3, created_at: '2026-09-25T15:00:00Z', headline: 'Roundup', symbols: ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'] },
    { id: 1, created_at: '2026-09-25T12:00:00Z', headline: 'dup', symbols: ['AAA'] },
    { id: 4, created_at: '2026-09-25T14:00:00Z', headline: 'BBB note', symbols: ['BBB'] },
  ];
  const n = linkNews(raw, by, win);
  assert.equal(n.length, 4);
  const a = n.find((x) => x.id === '1');
  assert.equal(a.move_pct, 5);
  assert.match(a.impact_note_ar, /قبل افتتاح.*لا يثبت/);
  assert.deepEqual(a.industries, ['Semiconductors']);
  const after = n.find((x) => x.id === '2');
  assert.equal(after.move_pct, null);
  assert.equal(after.url, null);
  assert.equal(n.find((x) => x.id === '3').move_pct, null);
  const th = themes(n, by);
  assert.equal(th.length, 1);
  assert.equal(th[0].industry, 'Semiconductors');
  assert.ok(!('sector' in th[0]));
});

test('Nasdaq calendar parsing', () => {
  const e = parseEarnings({ data: { rows: [
    { symbol: 'S1', name: 'Small', time: 'time-after-hours', epsForecast: '($0.12)', marketCap: '$1,000,000' },
    { symbol: 'B1', name: 'Big', time: 'time-pre-market', epsForecast: '$1.50', marketCap: '$9,000,000,000' },
    { symbol: 'U1', name: 'Unk', time: 'time-not-supplied', epsForecast: '', marketCap: 'N/A' },
  ] } });
  assert.deepEqual(e.map((x) => [x.symbol, x.time, x.eps_forecast]), [['B1', 'pre-market', 1.5], ['S1', 'after-hours', -0.12], ['U1', null, null]]);
  const c = parseEconomic({ data: { rows: [{ gmt: '12:30', country: 'United States', eventName: 'CPI', actual: '&nbsp;', consensus: '0.3%', previous: '0.2%' }, { gmt: '9:00', country: 'Euro Zone', eventName: 'X' }] } }, '2026-09-28');
  assert.deepEqual(c, [{ time: '2026-09-28T12:30:00.000Z', event: 'CPI', actual: null, forecast: '0.3%', previous: '0.2%' }]);
  assert.equal(parseEarnings(null).length, 0);
});

test('market clock and sessions', () => {
  assert.equal(marketState(Date.parse('2026-09-25T14:00:00Z'), CAL), 'OPEN');
  assert.equal(marketState(Date.parse('2026-09-25T12:00:00Z'), CAL), 'PRE');
  assert.equal(marketState(Date.parse('2026-09-25T21:00:00Z'), CAL), 'AFTER');
  assert.equal(marketState(Date.parse('2026-09-27T15:00:00Z'), CAL), 'CLOSED');
  assert.equal(sessionOf(Date.parse('2026-09-25T12:00:00Z'), CAL).date, '2026-09-24');
  assert.equal(sessionOf(Date.parse('2026-09-27T15:00:00Z'), CAL).date, '2026-09-25');
  assert.equal(calendarDay(Date.parse('2026-09-27T15:00:00Z'), CAL), '2026-09-28');
  assert.equal(countAr(3, 'شركة', 'شركات'), '3 شركات');
  assert.equal(countAr(12, 'شركة', 'شركات'), '12 شركة');
});

function shapeErrors(sample, real, path = '$') {
  const errs = [];
  if (sample === null || real === null) return errs;
  if (Array.isArray(sample)) {
    if (!Array.isArray(real)) return [`${path}: expected array`];
    if (sample.length && real.length) errs.push(...shapeErrors(sample[0], real[0], `${path}[0]`));
    return errs;
  }
  if (typeof sample === 'object') {
    if (typeof real !== 'object' || Array.isArray(real)) return [`${path}: expected object`];
    for (const k of Object.keys(sample)) {
      if (!(k in real)) { if (!['industry', 'sector'].includes(k) || !path.includes('themes')) errs.push(`${path}.${k}: missing`); continue; }
      errs.push(...shapeErrors(sample[k], real[k], `${path}.${k}`));
    }
    return errs;
  }
  if (typeof sample === 'number' && real !== null && typeof real !== 'number') errs.push(`${path}: expected number`);
  if (typeof sample === 'boolean' && real !== null && typeof real !== 'boolean') errs.push(`${path}: expected boolean`);
  if (typeof sample === 'string' && real !== null && typeof real !== 'string' && !path.endsWith('.value')) errs.push(`${path}: expected string`);
  return errs;
}

test('built document matches the contract (and the UI fixture when present)', () => {
  const b = { SPY: bars(260, (i) => 100 + i), QQQ: bars(260, (i) => 300 - i / 2), IWM: bars(260, () => 200), XLK: bars(260, (i) => 50 + i / 10), XLF: bars(260, (i) => 40 - i / 20) };
  const doc = buildInsights({
    universe, bars: b, barsAsOf: '2026-09-25T17:40:00Z', newsOk: true, calendar: CAL, calDay: '2026-09-25',
    newsRaw: [{ id: 9, created_at: '2026-09-25T13:00:00Z', headline: 'AAA', symbols: ['AAA'], url: 'https://x' }, { id: 10, created_at: '2026-09-25T13:10:00Z', headline: 'EEE', symbols: ['EEE'], url: 'https://y' }],
    earnings: [{ symbol: 'B1', company: 'Big', time: 'pre-market', eps_forecast: 1.5 }], economic: [], now: Date.parse('2026-09-25T18:05:00Z'),
  });
  assert.equal(doc.schema_version, 1);
  assert.equal(doc.session, '2026-09-25');
  assert.equal(doc.market_state, 'OPEN');
  assert.equal(doc.pulse.indices[0].symbol, 'SPY');
  assert.equal(doc.sectors.find((s) => s.sector === 'Technology').etf, 'XLK');
  assert.deepEqual(doc.movers.gainers.find((r) => r.symbol === 'AAA').news_ids, ['9']);
  assert.ok(doc.trends.length >= 1);
  for (const t of doc.trends) assert.ok(t.title_ar && t.detail_ar && t.evidence.length && ['1D', '5D', '1M'].includes(t.horizon));
  const json = JSON.stringify(doc);
  assert.ok(!/NaN|Infinity/.test(json));
  const fixture = new URL('./fixtures/insights.sample.json', import.meta.url);
  if (existsSync(fixture)) assert.deepEqual(shapeErrors(JSON.parse(readFileSync(fixture, 'utf8')), doc), []);
});
