// Filter study for discovery-1 signals on consolidated (SIP) minute bars.
//
// Protocol filter-study-1, fixed before any result was computed (2026-09-26):
//  - Signals and sessions: the same replay as sip-study-1 / exit-study-1 (2026-01-02 → 2026-09-24),
//    development = first two thirds of sessions, holdout = last third.
//  - Primary outcome: entry 17 minutes after detection (when a free signal is visible), exit after
//    10 minutes (T10, the development pick of exit-study-1), 0.5 pp cost. Also reported: entry at
//    detection with T10 and T30.
//  - Every feature uses only information available before the decision time:
//      news      Alpaca news articles for the symbol created before the signal
//      daily     SIP daily bars: previous close, today's open, previous day's dollar volume
//      filings   SEC offering forms (S-1/S-3/F-1/F-3/424B*) filed on an earlier date
//      short     FINRA short interest from a settlement at least 14 days earlier (publication lag)
//      intraday  run-up in the 30 minutes before the signal, first or repeat signal of the day
//  - Candidates: the 26 conditions in CONDITIONS and every pair of them (AND).
//  - Selection on development only: at least 300 trades (singles) or 200 (pairs); ranked by the lower
//    bound of a 95% session-block bootstrap interval of the mean. The top three are the candidates.
//  - Holdout: every single condition and the top 20 development combinations are reported; the three
//    candidates are the confirmatory test. A filter "holds" only if its holdout interval is above 0.
// Development evidence only: survivorship bias (today's universe), assumed cost, no quotes/fills.
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { batches, fetchBatch, detectSymbol } from '../src/core/sipscan.js';
import { getJson, eligibleSymbols, session } from './sip_study.mjs';
import { applyRule, RULES } from './exit_study.mjs';

const SERVICE = process.env.TAGIT_SERVICE || 'https://tagit-next-quotes.onrender.com';
const SEC_UA = process.env.SEC_USER_AGENT || 'TAGit NEXT research tufeeq11@gmail.com';
const MIN = 60_000, DAY = 86_400_000;
const DELAY = 17 * MIN, ENTRY_WINDOW = 2 * MIN;
const OFFERING = /^(S-1|S-1\/A|S-1MEF|S-3|S-3\/A|S-3ASR|F-1|F-1\/A|F-3|F-3\/A|424B[1-8])$/;
const nyDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
const nyHour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' });

// ---- pre-registered conditions -------------------------------------------------------------

export const CONDITIONS = {
  news_24h: (f) => f.news24 > 0,
  news_none_24h: (f) => f.news24 === 0,
  news_1h: (f) => f.news1 > 0,
  offering_30d: (f) => f.offering30,
  no_offering_90d: (f) => !f.offering90,
  gap_up_10: (f) => f.gap !== null && f.gap >= 10,
  gap_small: (f) => f.gap !== null && Math.abs(f.gap) < 3,
  day_lt10: (f) => f.day !== null && f.day < 10,
  day_10_30: (f) => f.day !== null && f.day >= 10 && f.day < 30,
  day_gt30: (f) => f.day !== null && f.day >= 30,
  runup_lt2: (f) => f.runup !== null && f.runup < 2,
  runup_gt8: (f) => f.runup !== null && f.runup > 8,
  first_today: (f) => f.nth === 1,
  repeat_today: (f) => f.nth > 1,
  price_lt1: (f) => f.price < 1,
  price_1_5: (f) => f.price >= 1 && f.price < 5,
  price_ge5: (f) => f.price >= 5,
  liq_lt1m: (f) => f.prevUsd !== null && f.prevUsd < 1e6,
  liq_gt10m: (f) => f.prevUsd !== null && f.prevUsd > 1e7,
  dtc_ge3: (f) => f.dtc !== null && f.dtc >= 3,
  morning: (f) => f.hour < 11,
  afternoon: (f) => f.hour >= 14,
  breakout: (f) => f.bo,
  vr_ge6: (f) => f.vr >= 6,
  usd3_lt50k: (f) => f.usd3 < 50_000,
  usd3_ge250k: (f) => f.usd3 >= 250_000,
};

export const OUTCOMES = ['late_T10', 'now_T10', 'now_T30'];
export const PRIMARY = 'late_T10';

// ---- features ---------------------------------------------------------------------------------

const lastBefore = (sorted, t) => { // count of timestamps in (t - window, t] is done by callers
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= t) lo = m + 1; else hi = m; }
  return lo; // number of items <= t
};

export function features(signal, ctx) {
  const at = Date.parse(signal.detected_at);
  const date = nyDate.format(new Date(at));
  const newsTimes = ctx.news.get(signal.symbol) ?? [];
  const upTo = lastBefore(newsTimes, at);
  const news24 = upTo - lastBefore(newsTimes, at - DAY);
  const news1 = upTo - lastBefore(newsTimes, at - 60 * MIN);
  const daily = ctx.daily.get(signal.symbol) ?? [];
  const todayIdx = daily.findIndex((d) => d.date === date);
  const prev = todayIdx > 0 ? daily[todayIdx - 1] : todayIdx === -1 ? daily.filter((d) => d.date < date).at(-1) : null;
  const today = todayIdx >= 0 ? daily[todayIdx] : null;
  const gap = prev?.c > 0 && today?.o > 0 ? (today.o / prev.c - 1) * 100 : null;
  const day = prev?.c > 0 ? (signal.price / prev.c - 1) * 100 : null;
  const filings = ctx.offerings.get(signal.symbol) ?? [];
  const earlier = (days) => filings.some((d) => d < date && Date.parse(d) >= Date.parse(date) - days * DAY);
  const si = (ctx.short.get(signal.symbol) ?? []).filter((x) => Date.parse(x.date) <= at - 14 * DAY).at(-1);
  const before = ctx.bars.filter((b) => b.t <= at - 30 * MIN).at(-1);
  return {
    symbol: signal.symbol, at: signal.detected_at, date,
    price: signal.price, vr: signal.volume_ratio, usd3: signal.dollars_3m, bo: Boolean(signal.breakout),
    hour: Number(nyHour.format(new Date(at))), nth: ctx.nth,
    news24, news1, offering30: earlier(30), offering90: earlier(90),
    gap, day, prevUsd: prev ? prev.c * prev.v : null,
    dtc: si && si.adv > 0 ? si.short / si.adv : null,
    runup: before?.c > 0 ? (signal.price / before.c - 1) * 100 : null,
  };
}

export function outcomes(bars, signal, closeMs) {
  const at = Date.parse(signal.detected_at);
  const run = (from, rule) => {
    const i = bars.findIndex((b) => b.t >= from && b.t < from + ENTRY_WINDOW);
    if (i < 0 || bars[i].t >= closeMs || !(bars[i].o > 0)) return null;
    const path = bars.slice(i).filter((b) => b.t < bars[i].t + 130 * MIN);
    return Math.round(applyRule(RULES[rule], path, bars[i].o, closeMs, signal.stop) * 1000) / 1000;
  };
  return { late_T10: run(at + DELAY, 'T10'), now_T10: run(at, 'T10'), now_T30: run(at, 'T30') };
}

// ---- statistics ------------------------------------------------------------------------------

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

/** Mean, win rate and a 95% session-block bootstrap interval for the rows passing `keep`. */
export function stats(rowsByDay, keep, outcome, draws = 600) {
  const perDay = rowsByDay.map((rows) => {
    let sum = 0, n = 0, wins = 0;
    for (const r of rows) {
      const y = r.o[outcome];
      if (!Number.isFinite(y) || !keep(r.f)) continue;
      sum += y; n++; if (y > 0) wins++;
    }
    return [sum, n, wins];
  });
  const n = perDay.reduce((a, d) => a + d[1], 0);
  if (!n) return { trades: 0, mean_pct: null, win_rate: null, ci95: null };
  const mean = perDay.reduce((a, d) => a + d[0], 0) / n;
  const wins = perDay.reduce((a, d) => a + d[2], 0);
  const random = rng(7), means = [];
  for (let i = 0; i < draws; i++) {
    let s = 0, c = 0;
    for (let k = 0; k < perDay.length; k++) { const d = perDay[Math.floor(random() * perDay.length)]; s += d[0]; c += d[1]; }
    if (c) means.push(s / c);
  }
  means.sort((a, b) => a - b);
  return { trades: n, mean_pct: r3(mean), win_rate: r3(wins / n), ci95: [r3(means[Math.floor(0.025 * means.length)]), r3(means[Math.ceil(0.975 * means.length) - 1])] };
}

export function analyze(days) {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const cut = Math.floor(sorted.length * 2 / 3);
  const dev = sorted.slice(0, cut).map((d) => d.rows), hold = sorted.slice(cut).map((d) => d.rows);
  const names = Object.keys(CONDITIONS);
  const combos = [
    ...names.map((a) => ({ name: a, keep: CONDITIONS[a], min: 300 })),
    ...names.flatMap((a, i) => names.slice(i + 1).map((b) => ({ name: `${a} + ${b}`, keep: (f) => CONDITIONS[a](f) && CONDITIONS[b](f), min: 200 }))),
  ];
  const devStats = combos.map((c) => ({ ...c, dev: stats(dev, c.keep, PRIMARY) })).filter((c) => c.dev.trades >= c.min);
  devStats.sort((a, b) => b.dev.ci95[0] - a.dev.ci95[0]);
  const top = devStats.slice(0, 20).map((c) => ({ name: c.name, development: c.dev, holdout: stats(hold, c.keep, PRIMARY) }));
  const candidates = top.slice(0, 3).map((c) => ({ ...c, holds: c.holdout.ci95 !== null && c.holdout.ci95[0] > 0 }));
  const singles = Object.fromEntries(names.map((a) => [a, {
    development: stats(dev, CONDITIONS[a], PRIMARY),
    holdout: stats(hold, CONDITIONS[a], PRIMARY),
    holdout_now_T30: stats(hold, CONDITIONS[a], 'now_T30'),
  }]));
  const all = () => true;
  return {
    schema: 1,
    protocol: 'filter-study-1',
    updated_at: new Date().toISOString(),
    status: 'DEVELOPMENT_DIAGNOSTIC_ONLY',
    profitability_claim_allowed: false,
    primary_outcome: PRIMARY,
    sessions: sorted.length,
    first_session: sorted[0]?.date ?? null,
    last_session: sorted.at(-1)?.date ?? null,
    split: { development_sessions: dev.length, holdout_sessions: hold.length, holdout_from: sorted[cut]?.date ?? null },
    signals: sorted.reduce((a, d) => a + d.rows.length, 0),
    combinations_tested: devStats.length,
    baseline: { development: stats(dev, all, PRIMARY), holdout: stats(hold, all, PRIMARY) },
    candidates,
    any_candidate_holds: candidates.some((c) => c.holds),
    top_development: top,
    singles,
  };
}

// ---- data ------------------------------------------------------------------------------------

async function relayPages(params) {
  const out = [];
  let token = null;
  for (let page = 0; page < 400; page++) {
    const q = new URLSearchParams(params);
    if (token) q.set('page_token', token);
    const body = await getJson(`${SERVICE}/api/lab/provider?${q}`);
    out.push(body);
    token = body?.next_page_token;
    if (!token) break;
  }
  return out;
}

async function loadDaily(symbols, start, end) {
  const map = new Map();
  for (const group of batches(symbols)) {
    for (const body of await relayPages({ resource: 'bars', symbols: group.join(','), timeframe: '1Day', start, end, feed: 'sip', adjustment: 'raw', limit: '10000', sort: 'asc' })) {
      for (const [s, bars] of Object.entries(body?.bars ?? {})) {
        const list = map.get(s) ?? [];
        for (const b of bars) list.push({ date: nyDate.format(new Date(b.t)), o: b.o, c: b.c, v: b.v });
        map.set(s, list);
      }
    }
  }
  for (const list of map.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return map;
}

async function loadNews(symbols, start, end) {
  const map = new Map(symbols.map((s) => [s, []]));
  for (const group of batches(symbols)) {
    for (const body of await relayPages({ resource: 'news', symbols: group.join(','), start, end, limit: '50', sort: 'asc' })) {
      for (const n of body?.news ?? []) {
        const t = Date.parse(n.created_at);
        for (const s of n.symbols ?? []) map.get(s)?.push(t);
      }
    }
  }
  for (const list of map.values()) list.sort((a, b) => a - b);
  return map;
}

async function secJson(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await new Promise((r) => setTimeout(r, 140)); // SEC asks for ≤ 10 requests per second
    const r = await fetch(url, { headers: { 'User-Agent': SEC_UA }, signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (r?.ok) return r.json();
    if (r?.status === 404) return null;
    await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
  }
  return null;
}

async function loadOfferings(symbols) {
  const map = new Map();
  const tickers = await secJson('https://www.sec.gov/files/company_tickers_exchange.json');
  const fi = tickers.fields;
  const cik = new Map(tickers.data.map((row) => [row[fi.indexOf('ticker')], row[fi.indexOf('cik')]]));
  for (const s of symbols) {
    if (!cik.has(s)) continue;
    const sub = await secJson(`https://data.sec.gov/submissions/CIK${String(cik.get(s)).padStart(10, '0')}.json`);
    const recent = sub?.filings?.recent;
    if (!recent) continue;
    map.set(s, recent.form.map((f, i) => (OFFERING.test(f) ? recent.filingDate[i] : null)).filter(Boolean).sort());
  }
  return map;
}

async function loadShort(symbols, from, to) {
  const map = new Map();
  const base = 'https://api.finra.org';
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  const parts = await (await fetch(`${base}/partitions/group/otcMarket/name/consolidatedShortInterest`, { headers })).json();
  const dates = parts.availablePartitions.flatMap((p) => p.partitions).filter((d) => d >= from && d <= to).sort();
  const want = new Set(symbols);
  for (const date of dates) {
    for (let offset = 0; ; offset += 5000) {
      const r = await fetch(`${base}/data/group/otcMarket/name/consolidatedShortInterest`, {
        method: 'POST', headers,
        body: JSON.stringify({ limit: 5000, offset, compareFilters: [{ compareType: 'EQUAL', fieldName: 'settlementDate', fieldValue: date }] }),
      });
      const page = r.ok ? await r.json() : [];
      for (const x of page) {
        if (!want.has(x.symbolCode)) continue;
        const list = map.get(x.symbolCode) ?? [];
        list.push({ date, short: x.currentShortPositionQuantity, adv: x.averageDailyVolumeQuantity });
        map.set(x.symbolCode, list);
      }
      if (page.length < 5000) break;
    }
  }
  for (const list of map.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return map;
}

function tradingDays(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += DAY) {
    const d = new Date(t);
    if (d.getUTCDay() % 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function main() {
  const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
  const from = arg('--from'), to = arg('--to');
  const symbols = eligibleSymbols();
  const started = Date.now();
  const lookback = new Date(Date.parse(from) - 120 * DAY).toISOString().slice(0, 10);
  console.log(`universe ${symbols.length}; loading daily bars, news, filings, short interest`);
  const ctx = {
    daily: await loadDaily(symbols, `${lookback}T00:00:00Z`, `${to}T23:59:00Z`),
    news: await loadNews(symbols, `${new Date(Date.parse(from) - 2 * DAY).toISOString().slice(0, 10)}T00:00:00Z`, `${to}T23:59:00Z`),
    offerings: await loadOfferings(symbols),
    short: await loadShort(symbols, lookback, to),
  };
  const newsCount = [...ctx.news.values()].reduce((a, l) => a + l.length, 0);
  console.log(`daily ${ctx.daily.size} symbols · news ${newsCount} · filings ${ctx.offerings.size} · short ${ctx.short.size} · ${Math.round((Date.now() - started) / 60000)} min`);

  const days = [];
  for (const day of tradingDays(from, to)) {
    if (Date.now() - started > Number(arg('--max-minutes') ?? 320) * MIN) { console.log('time budget reached'); break; }
    const { open, close } = session(day);
    const window = { start: new Date(open).toISOString().replace('.000Z', 'Z'), end: new Date(close).toISOString().replace('.000Z', 'Z') };
    const rows = [];
    let withBars = 0;
    for (const group of batches(symbols)) {
      let data;
      try { data = await fetchBatch(getJson, SERVICE, group, window); } catch (e) { console.error(`${day}: ${e.message}`); continue; }
      for (const [symbol, raw] of Object.entries(data)) {
        withBars++;
        const bars = raw.map((b) => ({ t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c }));
        const iso = raw.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: b.n, vw: b.vw }));
        detectSymbol(symbol, iso).forEach((s, i) => {
          rows.push({ f: features(s, { ...ctx, bars, nth: i + 1 }), o: outcomes(bars, s, close) });
        });
      }
    }
    if (!withBars) { console.log(`${day}: no bars`); continue; }
    days.push({ date: day, rows });
    console.log(`${day}: ${rows.length} signals`);
  }
  const report = analyze(days);
  writeFileSync(new URL('../data/filter-study.json', import.meta.url), JSON.stringify(report, null, 1) + '\n');
  writeFileSync('filter-rows.json.gz', gzipSync(JSON.stringify(days)));
  console.log(JSON.stringify({ baseline: report.baseline, candidates: report.candidates, any_candidate_holds: report.any_candidate_holds }, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
