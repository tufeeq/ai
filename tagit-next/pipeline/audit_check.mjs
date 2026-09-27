// Independent audit checks (audit-1). Read-only research; nothing here is published to the site.
//
// Pre-registered before any result was seen (2026-09-27):
//  C1 Daily-bar semantics. For a handful of liquid and illiquid Nasdaq names over recent sessions,
//     compare the SIP 1Day bar with the regular-session (09:30–16:00) aggregation of SIP 1Min bars:
//     does the daily "open" equal the first regular trade (what "entry at next open" assumes), and do
//     daily high/low/volume include extended hours?
//  C2 Baseline recomputed by a different method. For those names, the daily-study H1 baseline
//     (eligible day t → buy t+1 open, sell t+1 close, 0.5 pp) is recomputed from minute bars
//     (first regular-minute open, last regular-minute close) and compared pair by pair with the
//     1Day-bar value.
//  C3 Survivorship probe for the intraday studies. The intraday universe is TODAY's list of names
//     below $100M, applied to past sessions — it excludes names that were small then but grew or were
//     delisted. The unchanged detector + outcome-relabel-1 label are run on the complement: Nasdaq
//     names (active and inactive) NOT in today's list whose point-in-time previous-month median raw
//     close was $0.50–$20 with ≥ $300K average dollar volume. Same sessions as a slice of the study.
//     If the complement's post-signal mean is also clearly negative, today's-universe selection is
//     not what drives the negative result.
import { writeFileSync } from 'node:fs';
import { batches, fetchBatch, detectSymbol, isRegularBar } from '../src/core/sipscan.js';
import { getJson, eligibleSymbols, session, label, summarize } from './sip_study.mjs';

const SERVICE = process.env.TAGIT_SERVICE || 'https://tagit-next-quotes.onrender.com';
const nyDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x);
const url = (params) => `${SERVICE}/api/lab/provider?${new URLSearchParams(params)}`;

async function pages(params, max = 60) {
  const out = [];
  let token = null;
  for (let p = 0; p < max; p++) {
    const body = await getJson(url(token ? { ...params, page_token: token } : params));
    out.push(body);
    token = body?.next_page_token;
    if (!token) break;
  }
  return out;
}

async function bars(symbols, timeframe, start, end, adjustment = 'raw') {
  const map = new Map();
  for (const group of batches(symbols)) {
    for (const body of await pages({ resource: 'bars', symbols: group.join(','), timeframe, start, end, feed: 'sip', adjustment, limit: '10000', sort: 'asc' })) {
      for (const [s, list] of Object.entries(body?.bars ?? {})) (map.get(s) ?? map.set(s, []).get(s)).push(...list);
    }
  }
  return map;
}

/** Regular-session aggregate of minute bars by New York date. */
export function regularDaily(minutes) {
  const byDay = new Map();
  for (const b of minutes) {
    if (!isRegularBar(b.t)) continue;
    const d = nyDate.format(new Date(b.t));
    const x = byDay.get(d);
    if (!x) byDay.set(d, { o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, first: b.t });
    else { x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); x.c = b.c; x.v += b.v; }
  }
  return byDay;
}

export function allDaily(minutes) {
  const byDay = new Map();
  for (const b of minutes) {
    const d = nyDate.format(new Date(b.t));
    const x = byDay.get(d);
    if (!x) byDay.set(d, { h: b.h, l: b.l, v: b.v });
    else { x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); x.v += b.v; }
  }
  return byDay;
}

async function checkDaily(symbols, start, end) {
  const daily = await bars(symbols, '1Day', `${start}T00:00:00Z`, `${end}T23:59:00Z`);
  const minutes = await bars(symbols, '1Min', `${start}T08:00:00Z`, `${end}T23:59:00Z`);
  const rows = [];
  for (const s of symbols) {
    const reg = regularDaily(minutes.get(s) ?? []);
    const ext = allDaily(minutes.get(s) ?? []);
    for (const b of daily.get(s) ?? []) {
      const d = nyDate.format(new Date(b.t));
      const r = reg.get(d), e = ext.get(d);
      if (!r) continue;
      rows.push({
        s, d,
        open_vs_first_regular_pct: r3((b.o / r.o - 1) * 100),
        close_vs_last_regular_pct: r3((b.c / r.c - 1) * 100),
        high_eq_regular: Math.abs(b.h - r.h) < 1e-9, high_eq_extended: Math.abs(b.h - e.h) < 1e-9,
        low_eq_regular: Math.abs(b.l - r.l) < 1e-9, low_eq_extended: Math.abs(b.l - e.l) < 1e-9,
        vol_vs_regular: r3(b.v / r.v), vol_vs_extended: r3(b.v / e.v),
      });
    }
  }
  const share = (k) => r3(rows.filter((x) => x[k]).length / rows.length);
  const absMed = (k) => { const v = rows.map((x) => Math.abs(x[k])).sort((a, b) => a - b); return v[v.length >> 1]; };
  return {
    symbol_days: rows.length,
    median_abs_open_diff_pct: absMed('open_vs_first_regular_pct'),
    median_abs_close_diff_pct: absMed('close_vs_last_regular_pct'),
    open_within_0_1pct: r3(rows.filter((x) => Math.abs(x.open_vs_first_regular_pct) <= 0.1).length / rows.length),
    high_equals_regular: share('high_eq_regular'), high_equals_extended: share('high_eq_extended'),
    low_equals_regular: share('low_eq_regular'), low_equals_extended: share('low_eq_extended'),
    median_vol_vs_regular: [...rows.map((x) => x.vol_vs_regular)].sort((a, b) => a - b)[rows.length >> 1],
    rows: rows.slice(0, 60),
    daily, minutes,
  };
}

/** C2: H1 baseline recomputed from minute bars vs from daily bars, same symbol-days. */
function baselineCompare(daily, minutes, symbols) {
  const pairs = [];
  for (const s of symbols) {
    const d = (daily.get(s) ?? []).map((b) => ({ d: nyDate.format(new Date(b.t)), o: b.o, c: b.c, v: b.v })).sort((a, b) => a.d.localeCompare(b.d));
    const reg = regularDaily(minutes.get(s) ?? []);
    for (let i = 0; i < d.length - 1; i++) {
      if (!(d[i].c >= 0.5 && d[i].c <= 20)) continue;
      const next = d[i + 1], m = reg.get(next.d);
      if (!m || !(next.o > 0)) continue;
      pairs.push({ s, d: next.d, daily: (next.c / next.o - 1) * 100 - 0.5, minute: (m.c / m.o - 1) * 100 - 0.5 });
    }
  }
  return {
    pairs: pairs.length,
    mean_daily_bars: r3(mean(pairs.map((p) => p.daily))),
    mean_minute_bars: r3(mean(pairs.map((p) => p.minute))),
    max_abs_pair_diff_pp: r3(Math.max(0, ...pairs.map((p) => Math.abs(p.daily - p.minute)))),
    worst: pairs.sort((a, b) => Math.abs(b.daily - b.minute) - Math.abs(a.daily - a.minute)).slice(0, 8).map((p) => ({ ...p, daily: r3(p.daily), minute: r3(p.minute) })),
  };
}

async function survivorship(from, to, sessionsList) {
  const inList = new Set(eligibleSymbols());
  const assets = [];
  for (const status of ['active', 'inactive']) {
    const [list] = await pages({ resource: 'assets', status }, 1);
    for (const a of Array.isArray(list) ? list : []) if (a.exchange === 'NASDAQ' && /^[A-Z]{1,5}$/.test(a.symbol)) assets.push(a.symbol);
  }
  const candidates = [...new Set(assets)].filter((s) => !inList.has(s));
  const daily = await bars(candidates, '1Day', `${from}T00:00:00Z`, `${to}T23:59:00Z`);
  const complement = [];
  for (const [s, list] of daily) {
    if (list.length < 10) continue;
    const closes = list.map((b) => b.c).sort((a, b) => a - b);
    const med = closes[closes.length >> 1];
    const usd = mean(list.map((b) => b.c * b.v));
    if (med >= 0.5 && med <= 20 && usd >= 300_000) complement.push(s);
  }
  const events = [];
  for (const day of sessionsList) {
    const { open, close } = session(day);
    const window = { start: new Date(open).toISOString().replace('.000Z', 'Z'), end: new Date(close).toISOString().replace('.000Z', 'Z') };
    for (const group of batches(complement)) {
      let data;
      try { data = await fetchBatch(getJson, SERVICE, group, window); } catch (e) { console.error(`${day}: ${e.message}`); continue; }
      for (const [symbol, raw] of Object.entries(data)) {
        const series = raw.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: b.n, vw: b.vw }));
        for (const s of detectSymbol(symbol, series)) {
          const l = label(series, Date.parse(s.detected_at), close, s);
          events.push({ date: day, symbol, price: s.price, now: l.status === 'RESOLVED' ? { s: 'R', ret: l.return_pct, up: l.max_up_pct, plan: l.plan.status, r: l.plan.r } : { s: l.status } });
        }
      }
    }
    console.log(`${day}: complement signals so far ${events.length}`);
  }
  const byDay = new Map();
  for (const e of events) (byDay.get(e.date) ?? byDay.set(e.date, []).get(e.date)).push(e.now.ret);
  return {
    candidates: candidates.length, complement_symbols: complement.length,
    sessions: sessionsList, complement: summarize(events, 'now'),
    complement_under_5usd: summarize(events.filter((e) => e.price < 5), 'now'),
    per_day_mean: Object.fromEntries([...byDay].map(([d, xs]) => [d, r3(mean(xs.filter(Number.isFinite)))])),
  };
}

async function main() {
  const out = {};
  // C1/C2: 12 names across liquidity levels, 20 recent sessions (1Min windows ≤ 32 days).
  const names = (process.env.AUDIT_SYMBOLS || 'AAPL,SIRI,PLUG,SOUN,MARA,OPEN,BYND,NVAX,GRPN,SNDL,AEHL,MULN').split(',');
  const c1 = await checkDaily(names, '2026-08-24', '2026-09-24');
  out.c2_baseline_by_two_methods = baselineCompare(c1.daily, c1.minutes, names);
  delete c1.daily; delete c1.minutes;
  out.c1_daily_bar_semantics = c1;
  console.log(JSON.stringify(out, null, 1));
  // C3: ten sessions early in the study (most exposed to today's-universe selection).
  const sessionsList = ['2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06', '2026-02-09', '2026-02-10', '2026-02-11', '2026-02-12', '2026-02-13'];
  out.c3_survivorship = await survivorship('2026-01-02', '2026-01-30', sessionsList);
  out.updated_at = new Date().toISOString();
  writeFileSync('audit-check.json', JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify(out.c3_survivorship, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
