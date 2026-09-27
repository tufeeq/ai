import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeInsights, freshnessOf, refreshWindow, sectionAsOf, sourceFor, filterNews, newsFacets, sortSectors, insightsUrl,
} from '../src/core/insights.js';
import { renderInsights, DEFAULT_INSIGHTS_UI, sparkline } from '../src/views/insights.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/insights.sample.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(fixture);
// Friday 2026-09-25 16:50 ET, ten minutes after the fixture was generated.
const soon = Date.parse('2026-09-25T20:50:00Z');
const render = (data, ui = {}, now = soon, extra = {}) =>
  String(renderInsights({ phase: 'ok', data, error: null, loadedAt: now, ...extra }, { ...DEFAULT_INSIGHTS_UI, ...ui }, now));

test('fixture follows the schema-1 contract shape', () => {
  const d = normalizeInsights(clone());
  assert.ok(d);
  for (const k of ['schema_version', 'generated_at', 'session', 'market_state', 'sources', 'pulse', 'sectors', 'industries', 'movers', 'trends', 'news', 'themes', 'calendar', 'notes_ar']) assert.ok(k in d, k);
  assert.match(d.market_state, /^(PRE|OPEN|AFTER|CLOSED)$/);
  for (const i of d.pulse.indices) {
    assert.equal(i.spark.length, 30);
    for (const k of ['symbol', 'name_ar', 'last', 'chg_1d_pct', 'chg_5d_pct', 'chg_1m_pct', 'chg_ytd_pct', 'above_50dma', 'above_200dma']) assert.ok(k in i, k);
  }
  for (const b of [d.pulse.breadth, d.pulse.small_caps]) {
    for (const k of ['universe', 'advancers', 'decliners', 'unchanged', 'adv_dec_ratio', 'pct_above_0', 'up_5pct', 'down_5pct', 'unusual_volume']) assert.ok(k in b, k);
  }
  for (const s of d.sectors) for (const k of ['sector', 'name_ar', 'chg_1d_pct', 'median_chg_pct', 'breadth_pct_up', 'rel_volume', 'etf', 'etf_chg_1d_pct', 'etf_chg_5d_pct', 'etf_chg_1m_pct', 'count']) assert.ok(k in s, k);
  for (const i of [...d.industries.top, ...d.industries.bottom]) assert.ok(i.count >= 5 && Array.isArray(i.leaders));
  const ids = new Set(d.news.map((x) => x.id));
  for (const m of Object.values(d.movers).filter(Array.isArray).flat()) {
    for (const k of ['symbol', 'company', 'sector', 'industry', 'price', 'chg_pct', 'rel_volume', 'market_cap_m', 'news_ids']) assert.ok(k in m, k);
    for (const id of m.news_ids) assert.ok(ids.has(id), id);
  }
  for (const t of d.themes) assert.equal(('industry' in t) + ('sector' in t), 1);
  for (const t of d.trends) assert.match(t.horizon, /^(1D|5D|1M)$/);
});

test('normalize rejects other schemas and junk', () => {
  assert.equal(normalizeInsights(null), null);
  assert.equal(normalizeInsights([]), null);
  assert.equal(normalizeInsights({ ...clone(), schema_version: 2 }), null);
  assert.equal(normalizeInsights({ ...clone(), generated_at: 'soon' }), null);
  assert.match(insightsUrl(soon), /^data\/insights\.json\?t=\d+$/);
});

test('freshness: 90 min during the weekday refresh window, 84 h otherwise', () => {
  const open = Date.parse('2026-09-24T15:00:00Z'); // Thu 11:00 ET
  assert.equal(refreshWindow(open), true);
  assert.equal(refreshWindow(Date.parse('2026-09-27T15:00:00Z')), false); // Sunday
  assert.equal(freshnessOf('2026-09-24T14:00:00Z', open).level, 'ok');
  assert.equal(freshnessOf('2026-09-24T12:00:00Z', open).level, 'stale');
  // Friday after-close file is fine on Sunday, stale by the following Tuesday evening.
  assert.equal(freshnessOf(fixture.generated_at, Date.parse('2026-09-27T15:00:00Z')).level, 'ok');
  assert.equal(freshnessOf(fixture.generated_at, Date.parse('2026-09-30T02:00:00Z')).level, 'stale');
  assert.equal(freshnessOf('garbage', open).level, 'invalid');
  assert.equal(freshnessOf('2026-09-24T18:00:00Z', open).level, 'invalid');
});

test('section as_of and sources resolve with fallbacks', () => {
  const d = clone();
  assert.equal(sectionAsOf(d, 'pulse'), d.pulse.as_of);
  assert.equal(sectionAsOf(d, 'movers'), d.movers.as_of);
  assert.equal(sectionAsOf(d, 'news'), d.generated_at);
  assert.equal(sectionAsOf({ ...d, news_as_of: '2026-09-25T20:35:00Z' }, 'news'), '2026-09-25T20:35:00Z');
  assert.match(sourceFor(d, 'pulse').name, /bars/);
  assert.match(sourceFor(d, 'news').name, /news/);
  assert.match(sourceFor(d, 'sectors').name, /Finviz/);
  assert.match(sourceFor(d, 'calendar').name, /calendar/);
});

test('news filter by sector, industry and symbol prefix; newest first', () => {
  const d = clone();
  const all = filterNews(d.news);
  assert.equal(all.length, d.news.length);
  assert.ok(all.every((x, i) => i === 0 || Date.parse(all[i - 1].time) >= Date.parse(x.time)));
  assert.deepEqual(filterNews(d.news, { sector: 'Energy' }).map((x) => x.id), ['n2']);
  assert.deepEqual(filterNews(d.news, { industry: 'Solar' }).map((x) => x.id), ['n5']);
  assert.deepEqual(filterNews(d.news, { symbol: 'mr' }).map((x) => x.id), ['n4']);
  assert.ok(newsFacets(d.news).sectors.includes('Utilities'));
  assert.equal(sortSectors(d.sectors, 'breadth')[0].sector, 'Technology');
  assert.equal(sortSectors([{ chg_1d_pct: null }, { chg_1d_pct: -1 }])[0].chg_1d_pct, -1);
});

test('renders every section from the fixture with times, sources and dossier links', () => {
  const out = render(clone());
  for (const id of ['ins-pulse', 'ins-breadth', 'ins-sectors', 'ins-industries', 'ins-movers', 'ins-trends', 'ins-news', 'ins-themes', 'ins-calendar']) {
    assert.ok(out.includes(`id="${id}"`), id);
  }
  assert.ok(out.includes('ميل للمخاطرة'));
  assert.ok(out.includes('href="#market/SOUN"'));
  assert.ok(out.includes('class="ins-spark'));
  assert.ok(out.includes('نيويورك'));
  assert.ok(out.includes('Finviz Elite'));
  assert.ok(out.includes('لا يعني أن الخبر سبب الحركة'));
  assert.ok(!out.includes('بيانات قديمة'));
  assert.ok(!out.includes('NaN') && !out.includes('undefined'));
  // Unknown values are shown as a dash, never zero.
  assert.ok(out.includes('Software - Infrastructure'));
});

test('movers tab and news filters change what is shown', () => {
  const losers = render(clone(), { movers: 'losers' });
  assert.ok(losers.includes('href="#market/LUNR"') && !losers.includes('data-key="mv-losers-SOUN"'));
  const energy = render(clone(), { sector: 'Energy' });
  assert.ok(energy.includes('data-key="nw-n2"') && !energy.includes('data-key="nw-n1"'));
  assert.ok(energy.includes('data-news-clear'));
});

test('stale and missing sections render honest empty states', () => {
  const d = clone();
  d.news = [];
  d.movers = { as_of: d.movers.as_of, gainers: [], losers: [], unusual_volume: [] };
  d.pulse = { as_of: '2026-09-25T13:00:00Z', indices: [], breadth: null, regime: null, small_caps: null };
  delete d.sectors;
  delete d.calendar;
  const out = render(d, {}, Date.parse('2026-09-25T19:00:00Z'));
  assert.ok(out.includes('لا تتوفر أخبار'));
  assert.ok(out.includes('لا توجد أسهم في هذه القائمة'));
  assert.ok(out.includes('لا تتوفر بيانات القطاعات'));
  assert.ok(out.includes('لا تتوفر بيانات الاتساع'));
  assert.ok(out.includes('لا نتائج أعمال'));
  assert.ok(out.includes('بيانات قديمة'));
  assert.ok(out.includes('ins-stale'));
  // Whole-file staleness banner.
  assert.ok(render(clone(), {}, Date.parse('2026-10-01T15:00:00Z')).includes('الملف كله أقدم من المتوقع'));
});

test('load failures render an explicit error and keep the last good file', () => {
  const failed = String(renderInsights({ phase: 'error', data: null, error: 'HTTP 404' }, DEFAULT_INSIGHTS_UI, soon));
  assert.ok(failed.includes('تعذر تحميل ملف الرؤى') && failed.includes('HTTP 404'));
  assert.ok(String(renderInsights({ phase: 'loading', data: null }, DEFAULT_INSIGHTS_UI, soon)).includes('جارٍ تحميل'));
  assert.ok(render(clone(), {}, soon, { phase: 'error' }).includes('فشل آخر تحديث'));
});

test('news text, urls and symbols are escaped', () => {
  const d = clone();
  d.news[0] = {
    ...d.news[0], id: 'x"><script>', headline: '<img src=x onerror=alert(1)>Big "deal"', summary: '<b>bold</b> & more',
    source: '<i>src</i>', url: 'javascript:alert(1)', symbols: ['<svg/onload=alert(1)>', 'MU'], industries: ['"><x>'], impact_note_ar: '<script>x</script>',
  };
  d.trends[0].title_ar = '<script>alert(2)</script>';
  d.pulse.regime.reasons_ar = ['<img src=y>'];
  const out = render(d);
  assert.ok(!/<script|<img|<svg\/|<b>bold|onerror=alert\(1\)>/.test(out.replace(/&lt;[^]*?&gt;/g, '')));
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;Big &quot;deal&quot;'));
  assert.ok(!out.includes('href="javascript:'));
  assert.ok(!out.includes('href="#market/<'));
});

test('data-agent additive fields: numeric evidence, regime key/score, linked symbol, calendar date', () => {
  const out = render(clone());
  assert.ok(out.includes('<dd dir="ltr">2.4</dd>') && out.includes('<dd dir="ltr">—</dd>'));
  assert.ok(out.includes('ins-regime r-on') && out.includes('3/5'));
  assert.ok(out.includes('<span dir="ltr">MU</span>'));
  assert.ok(out.includes('تقويم جلسة'));
  assert.ok(out.includes('بوسيط تغير أسهمها'));
  const d = clone();
  d.trends[0].evidence = [{ metric: 'x', value: '+2.4%' }];
  assert.ok(render(d).includes('<dd dir="ltr">+2.4%</dd>'));
});

test('sparkline handles short or flat series', () => {
  assert.ok(String(sparkline([1], 'X')).includes('لا سلسلة'));
  assert.ok(String(sparkline([5, 5, 5], 'X')).includes('<path'));
});
