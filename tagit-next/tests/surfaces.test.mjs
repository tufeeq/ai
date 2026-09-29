// Fixes from the secondary-surfaces review (reports/review-surfaces.md): insights data, insights UI,
// journal deletion, Lab, evidence page.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUniverse, linkNews, themes, parseEconomic, economicDayMismatch, decodeEntities, plainText, buildInsights,
} from '../pipeline/insights.mjs';
import { readFileSync } from 'node:fs';
import { sectionAsOf, economicRows } from '../src/core/insights.js';
import { renderInsights, DEFAULT_INSIGHTS_UI } from '../src/views/insights.js';
import { createState, toggleWatch, removeEvent, startWatchEvents } from '../src/state.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/insights.sample.json', import.meta.url), 'utf8'));

const row = (t, industry, chg, cap, sector = 'Healthcare') => ({
  Ticker: t, Company: `${t} Inc`, Sector: sector, Industry: industry, 'Market Cap': String(cap), Price: '10',
  Change: `${chg}%`, Volume: '1000000', 'Avg Volume': '500',
});
const CAL = [{ date: '2026-09-25', open: '09:30', close: '16:00' }, { date: '2026-09-28', open: '09:30', close: '16:00' }, { date: '2026-09-29', open: '09:30', close: '16:00' }];
const universe = { updatedAt: '2026-09-29T01:56:30Z', rows: [row('AAA', 'Semiconductors', 5, 1000, 'Technology')] };

test('economic calendar: New York wall time, and rows from another day are rejected', () => {
  // Real rows returned for date=2026-09-29 at 01:35 ET: Monday 09-28 releases, already with actuals.
  const body = { data: { rows: [
    { gmt: '10:30', country: 'United States', eventName: 'Dallas Fed Mfg Business Index', actual: '9.8', consensus: ' ', previous: '11.6' },
    { gmt: '11:30', country: 'United States', eventName: '3-Month Bill Auction', actual: '4.110%', consensus: '', previous: '4.015%' },
    { gmt: '08:15', country: 'United States', eventName: 'FOMC Member Bowman Speaks', actual: '&nbsp;', consensus: '', previous: '' },
  ] } };
  const rows = parseEconomic(body, '2026-09-29');
  assert.equal(rows[0].time, '2026-09-29T12:15:00.000Z'); // 08:15 ET
  assert.equal(rows[0].actual, null);
  assert.equal(rows.find((r) => r.event.startsWith('Dallas')).time, '2026-09-29T14:30:00.000Z'); // 10:30 ET
  const fetchedAt = Date.parse('2026-09-29T05:35:34Z');
  assert.equal(economicDayMismatch(rows, fetchedAt), true);
  assert.equal(economicDayMismatch(rows, Date.parse('2026-09-29T20:00:00Z')), false);
  const out = buildInsights({ universe, calendar: CAL, economic: rows, calDay: '2026-09-29', now: fetchedAt });
  assert.equal(out.calendar.economic, null);
  assert.ok(out.notes_ar.some((x) => /لا تخص يوم 2026-09-29/.test(x)));
  // Winter (EST): 08:30 ET is 13:30 UTC.
  assert.equal(parseEconomic({ data: { rows: [{ gmt: '8:30', country: 'United States', eventName: 'CPI' }] } }, '2026-12-10')[0].time, '2026-12-10T13:30:00.000Z');
});

test('news text is decoded once (the page escapes on render)', () => {
  assert.equal(decodeEntities('Goldman Sachs&#39; board &amp; CEO &quot;x&quot; &#x2014; &bogus;'), 'Goldman Sachs\' board & CEO "x" — &bogus;');
  assert.equal(plainText('<p>Hello&nbsp; <b>world</b></p>'), 'Hello world');
  assert.equal(plainText('  '), null);
  const by = new Map(parseUniverse(universe.rows).map((x) => [x.symbol, x]));
  const [n] = linkNews([{ id: 9, created_at: '2026-09-25T12:00:00Z', headline: 'AAA&#39;s deal', summary: 'Sachs&#39; view', symbols: ['AAA'] }], by, null);
  assert.equal(n.headline, "AAA's deal");
  assert.equal(n.summary, "Sachs' view");
});

test('insights UI: pulse stamped by its bars, rejected economic rows, industries lead with the ranking metric', () => {
  const real = JSON.parse(readFileSync(new URL('../data/insights.json', import.meta.url), 'utf8'));
  const d = structuredClone(fixture);
  d.pulse.bars_as_of = '2026-09-25T20:30:00Z';
  d.pulse.indices[0].last_bar_date = '2026-09-25';
  d.pulse.breadth.new_high_20d = null;
  d.pulse.small_caps.new_high_20d = null;
  assert.equal(sectionAsOf(d, 'pulse'), '2026-09-25T20:30:00Z');
  assert.equal(sectionAsOf({ ...d, pulse: { ...d.pulse, indices: [] } }, 'pulse'), d.pulse.as_of);
  assert.equal(economicRows(d).length, d.calendar.economic.length);
  // The committed file (2026-09-29 run) carries Monday's releases with actuals under Tuesday: not shown.
  assert.equal(economicRows(real), null);
  const soon = Date.parse('2026-09-25T20:50:00Z');
  const out = String(renderInsights({ phase: 'ok', data: d, loadedAt: soon }, DEFAULT_INSIGHTS_UI, soon));
  assert.ok(out.includes('آخر إغلاق يومي'));
  assert.ok(out.includes('عند إنتاج الملف'));
  assert.ok(!out.includes('قمة ٢٠ يومًا')); // always null in the pipeline: no dead tile
  // Industries: the first number in each item is the median (ranking metric).
  const top = d.industries.top[0];
  const item = out.slice(out.indexOf(`data-key="ind-${top.industry}"`));
  const firstPct = /<span class="num[^"]*" dir="ltr">([^<]+)<\/span>/.exec(item)[1];
  assert.ok(firstPct.startsWith(top.median_chg_pct > 0 ? '+' : ''), firstPct);
  assert.ok(firstPct.includes(Math.abs(top.median_chg_pct).toFixed(2)), `${firstPct} vs ${top.median_chg_pct}`);
  // Movers: the news column comes right after the change (visible without horizontal scroll).
  const head = /<table class="ins-table"><thead><tr>(.*?)<\/tr>/.exec(out)[1];
  assert.ok(head.indexOf('التغير') < head.indexOf('خبر') && head.indexOf('خبر') < head.indexOf('حجم نسبي'));
  const realOut = String(renderInsights({ phase: 'ok', data: real, loadedAt: Date.parse(real.generated_at) }, DEFAULT_INSIGHTS_UI, Date.parse(real.generated_at)));
  assert.ok(realOut.includes('التقويم الاقتصادي غير متاح'));
  assert.ok(!realOut.includes('Dallas Fed'));
});

test('journal: deleting today\'s manual record is not undone by the next scan', () => {
  const now = Date.parse('2026-09-29T14:00:00Z');
  const fresh = (t) => ({ symbol: 'FRSH', name: 'Fresh', price: 2.4, price_at: new Date(t - 2000).toISOString(), quote_at: new Date(t - 2000).toISOString(), bid: 2.39, ask: 2.41 });
  const state = createState();
  state.stocks.set('FRSH', fresh(now));
  assert.equal(toggleWatch(state, 'FRSH', now), 'recording');
  assert.equal(state.journal.length, 1);
  assert.equal(removeEvent(state, state.journal[0].id, now), 'unwatched');
  assert.equal(state.watched.has('FRSH'), false);
  state.stocks.set('FRSH', fresh(now + 30_000));
  assert.equal(startWatchEvents(state, now + 30_000), false);
  assert.equal(state.journal.length, 0);
  // A record from an earlier day, or an alert record, leaves the watchlist alone.
  state.watched.add('FRSH');
  state.journal.push({ id: 'W-old', kind: 'WATCH', symbol: 'FRSH', started_at: '2026-09-25T14:00:00Z', start_price: 2 });
  assert.equal(removeEvent(state, 'W-old', now), true);
  assert.equal(state.watched.has('FRSH'), true);
  assert.equal(removeEvent(state, 'missing', now), false);
});

test('lab: every CSS token it uses exists, and the iframe height cannot feed back on itself', () => {
  const css = readFileSync(new URL('../lab/lab.css', import.meta.url), 'utf8');
  const theme = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const defined = new Set([...(theme + css).matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]));
  const missing = [...used].filter((v) => !defined.has(v));
  assert.deepEqual(missing, []);
  assert.match(css, /body\{[^}]*min-height:0/); // style.css sets body min-height:100vh
  const js = readFileSync(new URL('../lab/lab.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /document\.body\.getBoundingClientRect\(\)\.height/);
  assert.doesNotMatch(js, /Asia\/Riyadh/); // the rest of the site shows New York time
});

test('themes use the median move and show the range, so one outlier cannot flip the sign', () => {
  const rows = [row('K1', 'Biotechnology', 178, 5000), row('K2', 'Biotechnology', -18.6, 100), row('K3', 'Biotechnology', -29.6, 60), row('K4', 'Biotechnology', 1.2, 900)];
  const by = new Map(parseUniverse(rows).map((x) => [x.symbol, x]));
  const news = ['K1', 'K2', 'K3', 'K4'].map((s, i) => ({ id: String(i), symbols: [s] }));
  const [t] = themes(news, by);
  assert.equal(t.avg_move_pct, 32.75);
  assert.equal(t.median_move_pct, -8.7);
  assert.deepEqual([t.min_move_pct, t.max_move_pct], [-29.6, 178]);
  assert.match(t.title_ar, /وسيط تغيّرها -8\.7%/);
  assert.doesNotMatch(t.title_ar, /متوسط/);
});
