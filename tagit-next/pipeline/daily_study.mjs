// Daily-bar hypotheses for Nasdaq small caps (long only), end-of-day signals, next-open entries.
//
// Protocol daily-study-1, fixed before any result was computed (2026-09-26):
//  - Universe: Nasdaq common-stock listings from the provider's asset list, active AND inactive
//    (delisted names reduce survivorship bias). Eligibility is point in time, from that day's own
//    bars: close between $0.50 and $20, 20-day average dollar volume ≥ $300K, 21 prior bars.
//  - Data: consolidated (SIP) split-adjusted daily bars, 2023-01-03 → 2026-09-24.
//  - A signal on day t uses bars through t's close only. Entry at t+1's open. Exits at the close of
//    t+1, t+3 and t+5 (H1, H3, H5). Cost 0.5 pp round trip (1.0 pp reported as sensitivity).
//  - Hypotheses (all long):
//      strong_close   day return ≥ 20%, close in the top 10% of the day's range, $vol ≥ 3× average
//      gap_hold       open ≥ 10% over previous close, close ≥ open and ≥ 15% over previous close
//      flush_rebound  day return ≤ −20%, $vol ≥ 3× average, close in the upper half of the range
//      quiet_breakout close above the prior 20 closes, day return 3–15%, $vol ≥ 2× average
//      spike_pullback a close ≥ 1.5× the close 6 days earlier within the last 5 days, today ≤ 0.7× that
//                     peak and today up
//      momentum_5d    5-day return ≥ 30% and close ≥ 95% of the 5-day high
//    Baseline: every eligible stock-day (what a random eligible pick earns).
//  - Split: development = first two thirds of sessions, holdout = last third. The best
//    hypothesis/horizon is chosen on development, among those with a positive development mean, by the
//    lower bound of a 95% session-block bootstrap interval, then tested once on the holdout. If none
//    is positive in development, nothing is selected. It "holds" only if the holdout interval is above 0
//    AND above the baseline mean for the same horizon.
// Research evidence only: bars, not fills; small caps can gap and be hard to trade.
import { writeFileSync } from 'node:fs';
import { getJson } from './sip_study.mjs';

const SERVICE = process.env.TAGIT_SERVICE || 'https://tagit-next-quotes.onrender.com';
const COSTS = [0.5, 1.0];
const HORIZONS = [1, 3, 5];
const SYMBOL = /^[A-Z]{1,5}$/;
const EXCLUDE = /warrant|right|unit|preferred|depositary|etf|fund|trust|notes|debenture|acquisition corp/i;
const nyDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

export const HYPOTHESES = {
  strong_close: (b, i, ctx) => ret(b, i) >= 20 && rangePos(b[i]) >= 0.9 && ctx.dvolRatio >= 3,
  gap_hold: (b, i) => b[i].o >= b[i - 1].c * 1.10 && b[i].c >= b[i].o && b[i].c >= b[i - 1].c * 1.15,
  flush_rebound: (b, i, ctx) => ret(b, i) <= -20 && ctx.dvolRatio >= 3 && rangePos(b[i]) >= 0.5,
  quiet_breakout: (b, i, ctx) => b[i].c > Math.max(...b.slice(i - 20, i).map((x) => x.c)) && ret(b, i) >= 3 && ret(b, i) <= 15 && ctx.dvolRatio >= 2,
  spike_pullback: (b, i) => {
    if (i < 11) return false;
    const peak = Math.max(...b.slice(i - 5, i).map((x) => x.c));
    return peak >= b[i - 11 + 5].c * 1.5 && b[i].c <= peak * 0.7 && b[i].c > b[i - 1].c;
  },
  momentum_5d: (b, i) => b[i].c >= b[i - 5].c * 1.30 && b[i].c >= 0.95 * Math.max(...b.slice(i - 4, i + 1).map((x) => x.h)),
};

const ret = (b, i) => (b[i].c / b[i - 1].c - 1) * 100;
const rangePos = (x) => (x.h > x.l ? (x.c - x.l) / (x.h - x.l) : 0.5);

export function eligible(b, i) {
  if (i < 21 || !(b[i].c >= 0.5 && b[i].c <= 20)) return null;
  const avg = b.slice(i - 20, i).reduce((a, x) => a + x.c * x.v, 0) / 20;
  if (!(avg >= 300_000)) return null;
  return { dvolRatio: (b[i].c * b[i].v) / avg };
}

/** Net returns (pp) for entry at the next open and exits after 1, 3 and 5 sessions. */
export function outcome(b, i, cost) {
  const entry = b[i + 1]?.o;
  if (!(entry > 0)) return null;
  const out = {};
  for (const h of HORIZONS) {
    const exit = b[i + h]?.c;
    out[h] = exit > 0 ? (exit / entry - 1) * 100 - cost : null;
  }
  return out;
}

/** Scan one symbol's bars; collects per-day sums so memory stays small. */
export function scanSymbol(bars, acc) {
  for (let i = 21; i < bars.length - 1; i++) {
    const ctx = eligible(bars, i);
    if (!ctx) continue;
    const day = bars[i].d;
    const base = outcome(bars, i, 0);
    if (!base) continue;
    add(acc, 'baseline', day, base);
    for (const [name, test] of Object.entries(HYPOTHESES)) {
      if (test(bars, i, ctx)) {
        add(acc, name, day, base);
        acc.examples[name] ??= [];
        if (acc.examples[name].length < 5000) acc.examples[name].push({ s: bars.symbol, d: day, c: bars[i].c });
      }
    }
  }
}

function add(acc, name, day, gross) {
  const byDay = (acc.days[name] ??= new Map());
  const cell = byDay.get(day) ?? Object.fromEntries(HORIZONS.map((h) => [h, [0, 0, 0]]));
  for (const h of HORIZONS) {
    const g = gross[h];
    if (!Number.isFinite(g)) continue;
    cell[h][0] += g; cell[h][1] += 1; if (g > COSTS[0]) cell[h][2] += 1;
  }
  byDay.set(day, cell);
}

// ---- statistics ------------------------------------------------------------------------------

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

/** Gross per-day cells → net mean, win rate and session-block bootstrap interval. */
export function stats(cells, h, cost, draws = 800) {
  const days = cells.map((c) => c[h]).filter((x) => x[1] > 0);
  const n = days.reduce((a, d) => a + d[1], 0);
  if (!n) return { trades: 0, days: 0, mean_pct: null, win_rate: null, ci95: null };
  const mean = days.reduce((a, d) => a + d[0], 0) / n - cost;
  const random = rng(11), means = [];
  const all = cells.map((c) => c[h]);
  for (let k = 0; k < draws; k++) {
    let s = 0, c = 0;
    for (let j = 0; j < all.length; j++) { const d = all[Math.floor(random() * all.length)]; s += d[0]; c += d[1]; }
    if (c) means.push(s / c - cost);
  }
  means.sort((a, b) => a - b);
  return {
    trades: n, days: days.length, mean_pct: r3(mean), win_rate: r3(days.reduce((a, d) => a + d[2], 0) / n),
    ci95: [r3(means[Math.floor(0.025 * means.length)]), r3(means[Math.ceil(0.975 * means.length) - 1])],
  };
}

export function analyze(acc, sessions) {
  const cut = Math.floor(sessions.length * 2 / 3);
  const devDays = sessions.slice(0, cut), holdDays = sessions.slice(cut);
  const empty = () => Object.fromEntries(HORIZONS.map((h) => [h, [0, 0, 0]]));
  const cellsFor = (name, days) => days.map((d) => acc.days[name]?.get(d) ?? empty());
  const table = {};
  for (const name of ['baseline', ...Object.keys(HYPOTHESES)]) {
    table[name] = {};
    for (const h of HORIZONS) {
      table[name][h] = {
        development: stats(cellsFor(name, devDays), h, COSTS[0]),
        holdout: stats(cellsFor(name, holdDays), h, COSTS[0]),
        holdout_cost_1pp: stats(cellsFor(name, holdDays), h, COSTS[1]),
      };
    }
  }
  const ranked = Object.keys(HYPOTHESES).flatMap((name) => HORIZONS.map((h) => ({ name, h, dev: table[name][h].development })))
    .filter((x) => x.dev.trades >= 200 && x.dev.mean_pct > 0) // only profitable-in-development candidates
    .sort((a, b) => b.dev.ci95[0] - a.dev.ci95[0]);
  const pick = ranked[0] ?? null;
  const pickHold = pick ? table[pick.name][pick.h].holdout : null;
  const baseHold = pick ? table.baseline[pick.h].holdout : null;
  return {
    schema: 1,
    protocol: 'daily-study-1',
    updated_at: new Date().toISOString(),
    status: 'DEVELOPMENT_DIAGNOSTIC_ONLY',
    profitability_claim_allowed: false,
    sessions: sessions.length,
    first_session: sessions[0] ?? null,
    last_session: sessions.at(-1) ?? null,
    split: { development_sessions: devDays.length, holdout_sessions: holdDays.length, holdout_from: holdDays[0] ?? null },
    universe: acc.universe,
    selected: pick ? { hypothesis: pick.name, horizon_days: pick.h, development: pick.dev, holdout: pickHold, baseline_holdout: baseHold } : null,
    holds: Boolean(pickHold?.ci95 && pickHold.ci95[0] > 0 && pickHold.mean_pct > (baseHold?.mean_pct ?? 0)),
    table,
  };
}

// ---- data ------------------------------------------------------------------------------------

async function relayPages(params, maxPages = 400) {
  const out = [];
  let token = null;
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams(params);
    if (token) q.set('page_token', token);
    const body = await getJson(`${SERVICE}/api/lab/provider?${q}`);
    out.push(body);
    token = body?.next_page_token;
    if (!token) break;
  }
  return out;
}

async function universe() {
  const out = new Map();
  for (const status of ['active', 'inactive']) {
    const [list] = await relayPages({ resource: 'assets', status });
    for (const a of Array.isArray(list) ? list : []) {
      if (a.exchange === 'NASDAQ' && SYMBOL.test(a.symbol) && !EXCLUDE.test(a.name ?? '')) out.set(a.symbol, status);
    }
  }
  return out;
}

const WINDOWS = [['2022-11-15T00:00:00Z', '2024-12-31T23:59:00Z'], ['2025-01-01T00:00:00Z', '2026-10-05T23:59:00Z']];

async function main() {
  const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
  const from = arg('--from') ?? '2023-01-03', to = arg('--to') ?? '2026-09-24';
  const limit = Number(arg('--limit-symbols') ?? Infinity);
  const u = await universe();
  const symbols = [...u.keys()].sort().slice(0, limit);
  const acc = { days: {}, examples: {}, universe: { symbols: symbols.length, inactive: symbols.filter((s) => u.get(s) === 'inactive').length } };
  console.log(`universe ${symbols.length} Nasdaq listings (${acc.universe.inactive} inactive)`);
  const sessions = new Set();
  const started = Date.now();
  for (let i = 0; i < symbols.length; i += 100) {
    const group = symbols.slice(i, i + 100);
    const bars = new Map();
    for (const [start, end] of WINDOWS) {
      for (const body of await relayPages({ resource: 'bars', symbols: group.join(','), timeframe: '1Day', start, end, feed: 'sip', adjustment: 'split', limit: '10000', sort: 'asc' })) {
        for (const [s, list] of Object.entries(body?.bars ?? {})) {
          const arr = bars.get(s) ?? [];
          for (const b of list) arr.push({ d: nyDate.format(new Date(b.t)), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
          bars.set(s, arr);
        }
      }
    }
    for (const [s, arr] of bars) {
      const inRange = arr.filter((b) => b.d <= to).sort((a, b) => a.d.localeCompare(b.d));
      inRange.symbol = s;
      for (const b of inRange) if (b.d >= from) sessions.add(b.d);
      scanSymbol(inRange, acc);
    }
    // Drop signal days before `from` (bars before it only warm up the 20-day windows).
    for (const map of Object.values(acc.days)) for (const d of [...map.keys()]) if (d < from) map.delete(d);
    console.log(`${Math.min(i + 100, symbols.length)}/${symbols.length} symbols · ${Math.round((Date.now() - started) / 60000)} min`);
  }
  const days = [...sessions].sort();
  const report = analyze(acc, days);
  report.examples = Object.fromEntries(Object.entries(acc.examples).map(([k, v]) => [k, v.filter((x) => x.d >= from).slice(-40)]));
  writeFileSync(new URL('../data/daily-study.json', import.meta.url), JSON.stringify(report, null, 1) + '\n');
  const brief = Object.fromEntries(Object.entries(report.table).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([h, s]) => [h, [s.development.trades, s.development.mean_pct, s.holdout.trades, s.holdout.mean_pct, s.holdout.ci95]]))]));
  console.log(JSON.stringify({ selected: report.selected, holds: report.holds, table: brief }, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
