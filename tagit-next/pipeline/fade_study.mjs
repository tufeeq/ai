// Fade study for Nasdaq small caps: short (or "avoid / exit the long") after an extended move.
//
// Protocol fade-study-1, written and committed BEFORE any fade result was computed (2026-09-27).
//
// Why the eras are not the usual 2/3 : 1/3 split
//  daily-study-1 already looked at 2023-01-03 → 2026-09-24 (long side, including its holdout) and the
//  fade idea was generated FROM that result ("long-after-the-move loses"). A short on the same events is
//  its mirror image, so no part of 2023-2026 can serve as an untouched holdout for this study.
//  Therefore:
//   - development = 2023-01-03 → 2026-09-24 (already seen; all selection happens here);
//   - HOLDOUT     = 2018-01-02 → 2022-12-30 (never examined by any TAGit study; tested once);
//   - the brief's standard split (first 2/3 vs last 1/3 of 2023-2026) is also reported, labelled
//     CONTAMINATED, for comparability only. It can never make anything "hold".
//
// Universe and data (same rules as daily-study-1)
//  - Nasdaq common-stock listings from the provider asset list, active AND inactive (delisted). Current
//    `shortable` / `easy_to_borrow` flags are kept for a NON point-in-time diagnostic only.
//  - Consolidated (SIP) split-adjusted daily bars 2017-11-01 → 2026-10-05 (warm-up before 2018-01-02).
//  - Eligible stock-day t (point in time, bars ≤ t): close $0.50–$20, 20-day average dollar volume
//    ≥ $300K, ≥ 21 prior bars. Known limitation: split-adjusted prices make the price band slightly
//    forward-looking for names that later reverse-split; dollar volume is split-invariant.
//
// Events on day t (bars through t's close only)
//   strong_close  day return ≥ 20%, close in top 10% of range, $vol ≥ 3× 20-day average   (daily-study-1)
//   gap_hold      open ≥ +10% vs prior close, close ≥ open and ≥ +15% vs prior close       (daily-study-1)
//   momentum_5d   5-day return ≥ 30% and close ≥ 95% of the 5-day high                    (daily-study-1)
//   spike_50      day return ≥ 50% and $vol ≥ 3× average
//   extended_any  any of the four
//
// A. Short fade (primary)
//  - Short at the open of t+1. Cover at the close of t+H, H ∈ {1, 3, 5, 10} sessions, unless stopped.
//  - Stop (primary 25% above entry; sensitivity none / 15% / 50%): from the first session, if the day's
//    high reaches entry × (1+stop) cover at the stop; from the second session, if the open is already
//    beyond the stop cover at that open (gap / halt reopening). Every stop fill pays 2% extra slippage.
//  - Symbol stops trading before the exit (delisting / long halt): cover at its last available close.
//    Trades whose exit lies beyond the end of the data are dropped.
//  - Costs: 0.5 pp round trip + borrow = annual rate × calendar days held / 365 (minimum one day).
//    Primary borrow 50%/yr; sensitivity 0, 20, 100, 300%/yr. Short return = (1 − cover/entry)·100 − costs.
//  - Selection (development only): among event × H at primary costs with ≥ 200 trades and a positive
//    mean, the highest lower bound of the 95% session-block bootstrap interval. Tested once on the holdout.
//  - HOLDS only if, on the holdout: CI95 lower bound > 0 at primary costs AND mean > 0 at 100%/yr borrow.
//  - Tail risk always reported: worst trade, 5th percentile, P(loss > 50%), P(loss > 100%), stop rate.
//  - Reference configuration shown even if nothing is selected: extended_any, H5, primary costs.
//
// B. Long side "don't buy / exit" flag
//  - Flag = extended_any on day t. Long entry at t+1 open, exit at t+H close (no stop), 0.5 pp.
//  - Primary: H5. Statistic: mean(flagged) − mean(unflagged eligible stock-days), same sessions,
//    session-block bootstrap. HOLDS only if the holdout CI95 upper bound < 0.
//  - Secondary "exit" test: gross forward long return of flagged names (what a holder keeps by staying)
//    has holdout CI95 upper bound < 0.
//
// Research evidence only: daily bars, not fills. Borrow availability (locates) for freshly spiked small
// caps is often nil or priced far above 100%/yr; halts, SSR (Rule 201) and squeezes make the short
// side materially worse than any bar study can show. Never an order instruction.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gunzipSync, gzipSync } from 'node:zlib';
import { getJson } from './sip_study.mjs';
import { HYPOTHESES as DAILY, eligible } from './daily_study.mjs';
import { extensionEvents, FADE_WINDOW_SESSIONS } from '../src/core/fade.js';

const SERVICE = process.env.TAGIT_SERVICE || 'https://tagit-next-quotes.onrender.com';
const PACE_MS = Number(process.env.TAGIT_RELAY_PACE_MS || 3200);
export const COST_PP = 0.5;
export const HORIZONS = [1, 3, 5, 10];
export const STOPS = { none: null, s15: 0.15, s25: 0.25, s50: 0.5 };
export const PRIMARY_STOP = 's25';
export const BORROW = [0, 0.2, 0.5, 1, 3];
export const PRIMARY_BORROW = 0.5;
export const STOP_SLIP = 0.02;
export const ERAS = {
  development: { from: '2023-01-03', to: '2026-09-24' },
  holdout: { from: '2018-01-02', to: '2022-12-30' },
};
const WINDOWS = [
  ['2017-11-01', '2019-12-31'], ['2020-01-01', '2021-12-31'], ['2022-01-01', '2023-12-31'],
  ['2024-01-01', '2025-12-31'], ['2026-01-01', '2026-10-05'],
];
const SYMBOL = /^[A-Z]{1,5}$/; // same as daily-study-1
const EXCLUDE = /warrant|right|unit|preferred|depositary|etf|fund|trust|notes|debenture|acquisition corp/i;
const nyDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

const ret = (b, i) => (b[i].c / b[i - 1].c - 1) * 100;
export const EVENTS = {
  strong_close: DAILY.strong_close,
  gap_hold: DAILY.gap_hold,
  momentum_5d: DAILY.momentum_5d,
  spike_50: (b, i, ctx) => ret(b, i) >= 50 && ctx.dvolRatio >= 3,
};
export const EVENT_NAMES = [...Object.keys(EVENTS), 'extended_any'];

const dayMs = (d) => Date.parse(`${d}T12:00:00Z`);
const calDays = (a, b) => Math.max(1, Math.round((dayMs(b) - dayMs(a)) / 86_400_000));

/**
 * Short from the open after bar i, held H sessions under `stop` (fraction or null).
 * Returns gross pp (before costs and borrow), calendar days held and how it ended, or null.
 * `openEnd`: a symbol whose last bar is on/after this date ran out of DATA, not out of listing.
 */
export function shortTrade(b, i, H, stop, openEnd) {
  const e = b[i + 1]?.o;
  if (!(e > 0)) return null;
  const level = stop == null ? Infinity : e * (1 + stop);
  let cover = null, j = null, kind = 'time';
  for (let k = 1; k <= H; k++) {
    const x = b[i + k];
    if (!x) {
      if (b.at(-1).d >= openEnd) return null;
      j = i + k - 1; cover = b[j].c; kind = 'ended'; break;
    }
    if (k > 1 && x.o >= level) { j = i + k; cover = x.o * (1 + STOP_SLIP); kind = 'stop_gap'; break; }
    if (x.h >= level) { j = i + k; cover = level * (1 + STOP_SLIP); kind = 'stop'; break; }
  }
  if (cover == null) { j = i + H; cover = b[j].c; }
  return { gross: (1 - cover / e) * 100, days: calDays(b[i + 1].d, b[j].d), kind };
}

/** Long from the open after bar i to the close H sessions later (no stop), gross pp. */
export function longTrade(b, i, H, openEnd) {
  const e = b[i + 1]?.o;
  if (!(e > 0)) return null;
  let x = b[i + H];
  if (!x) { if (b.at(-1).d >= openEnd) return null; x = b.at(-1); }
  return (x.c / e - 1) * 100;
}

export const shortNet = (t, borrow) => t.gross - COST_PP - borrow * (t.days / 365) * 100;

/** Scan one symbol. Flagged stock-days become trade records; unflagged ones only feed per-day sums. */
export function scanSymbol(bars, acc, openEnd, meta = {}, lastDay = '9999-12-31') {
  for (let i = 21; i < bars.length - 1; i++) {
    if (bars[i].d > lastDay) break;
    const ctx = eligible(bars, i);
    if (!ctx) continue;
    const d = bars[i].d;
    const ev = Object.keys(EVENTS).filter((k) => EVENTS[k](bars, i, ctx));
    if (!ev.length) {
      const cell = (acc.base.get(d) ?? acc.base.set(d, Object.fromEntries(HORIZONS.map((h) => [h, [0, 0]]))).get(d));
      for (const h of HORIZONS) {
        const g = longTrade(bars, i, h, openEnd);
        if (Number.isFinite(g)) { cell[h][0] += g; cell[h][1] += 1; }
      }
      continue;
    }
    const t = { s: bars.symbol, d, c: bars[i].c, ev, etb: meta.etb ?? null, long: {}, short: {} };
    for (const h of HORIZONS) t.long[h] = longTrade(bars, i, h, openEnd);
    for (const [key, stop] of Object.entries(STOPS)) {
      t.short[key] = {};
      for (const h of HORIZONS) t.short[key][h] = shortTrade(bars, i, h, stop, openEnd);
    }
    acc.trades.push(t);
  }
}

// ---- statistics ------------------------------------------------------------------------------

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const DRAWS = 1000;

/** Session-block bootstrap of a ratio of per-session sums; `cells` = [[num, den], …] one per session. */
function bootstrap(cells, fn, seed = 11) {
  const random = rng(seed), out = [];
  for (let k = 0; k < DRAWS; k++) {
    const acc = cells[0].map(() => 0);
    for (let j = 0; j < cells.length; j++) { const c = cells[Math.floor(random() * cells.length)]; for (let q = 0; q < c.length; q++) acc[q] += c[q]; }
    const v = fn(acc);
    if (Number.isFinite(v)) out.push(v);
  }
  out.sort((a, b) => a - b);
  return out.length ? [r3(out[Math.floor(0.025 * out.length)]), r3(out[Math.ceil(0.975 * out.length) - 1])] : null;
}

/** values: [{d, v}] (net pp per trade). Pooled mean, bootstrap CI over the era's sessions, tails. */
export function summarize(values, sessions, extra = {}) {
  const n = values.length;
  if (!n) return { trades: 0, days: 0, mean_pct: null, ci95: null, ...extra };
  const byDay = new Map(sessions.map((d) => [d, [0, 0]]));
  for (const x of values) { const c = byDay.get(x.d); if (c) { c[0] += x.v; c[1] += 1; } }
  const sorted = values.map((x) => x.v).sort((a, b) => a - b);
  const mean = sorted.reduce((a, v) => a + v, 0) / n;
  return {
    trades: n,
    days: [...byDay.values()].filter((c) => c[1]).length,
    mean_pct: r3(mean),
    median_pct: r3(sorted[Math.floor(n / 2)]),
    win_rate: r3(sorted.filter((v) => v > 0).length / n),
    ci95: bootstrap([...byDay.values()], ([s, c]) => (c ? s / c : NaN)),
    worst_pct: r3(sorted[0]),
    p05_pct: r3(sorted[Math.floor(0.05 * n)]),
    p_loss_gt_50: r3(sorted.filter((v) => v < -50).length / n),
    p_loss_gt_100: r3(sorted.filter((v) => v < -100).length / n),
    ...extra,
  };
}

const inEra = (d, era) => d >= era.from && d <= era.to;
const has = (t, name) => name === 'extended_any' || t.ev.includes(name);

export function shortValues(trades, name, h, stopKey, borrow) {
  return trades.filter((t) => has(t, name) && t.short[stopKey][h]).map((t) => ({ d: t.d, v: shortNet(t.short[stopKey][h], borrow) }));
}

export function shortSummary(trades, sessions, name, h, stopKey = PRIMARY_STOP, borrow = PRIMARY_BORROW) {
  const picked = trades.filter((t) => has(t, name) && t.short[stopKey][h]);
  const stops = picked.filter((t) => t.short[stopKey][h].kind.startsWith('stop')).length;
  const ended = picked.filter((t) => t.short[stopKey][h].kind === 'ended').length;
  return summarize(picked.map((t) => ({ d: t.d, v: shortNet(t.short[stopKey][h], borrow) })), sessions,
    { stop_rate: r3(picked.length ? stops / picked.length : null), ended_rate: r3(picked.length ? ended / picked.length : null) });
}

/** Long flagged vs unflagged baseline on the same sessions (difference in net means; costs cancel). */
export function avoidTest(trades, base, sessions, name, h) {
  const cells = sessions.map((d) => {
    const b = base.get(d)?.[h] ?? [0, 0];
    return [0, 0, b[0], b[1]];
  });
  const idx = new Map(sessions.map((d, k) => [d, k]));
  for (const t of trades) {
    const k = idx.get(t.d);
    if (k == null || !has(t, name) || !Number.isFinite(t.long[h])) continue;
    cells[k][0] += t.long[h]; cells[k][1] += 1;
  }
  const tot = cells.reduce((a, c) => a.map((x, q) => x + c[q]), [0, 0, 0, 0]);
  const diff = (a) => (a[1] && a[3] ? a[0] / a[1] - a[2] / a[3] : NaN);
  return {
    flagged_trades: tot[1],
    baseline_trades: tot[3],
    flagged_net_pct: r3(tot[1] ? tot[0] / tot[1] - COST_PP : null),
    baseline_net_pct: r3(tot[3] ? tot[2] / tot[3] - COST_PP : null),
    diff_pct: r3(diff(tot)),
    diff_ci95: bootstrap(cells, diff, 17),
    flagged_gross_pct: r3(tot[1] ? tot[0] / tot[1] : null),
    flagged_gross_ci95: bootstrap(cells, (a) => (a[1] ? a[0] / a[1] : NaN), 19),
  };
}

export function analyze(acc, allSessions) {
  const sess = Object.fromEntries(Object.entries(ERAS).map(([k, e]) => [k, allSessions.filter((d) => inEra(d, e))]));
  const cut = Math.floor(sess.development.length * 2 / 3);
  sess.contaminated_dev = sess.development.slice(0, cut);
  sess.contaminated_holdout = sess.development.slice(cut);
  const tr = Object.fromEntries(Object.entries(sess).map(([k, s]) => { const set = new Set(s); return [k, acc.trades.filter((t) => set.has(t.d))]; }));

  // A. short table at primary costs, every event × horizon × era.
  const shortTable = {};
  for (const name of EVENT_NAMES) {
    shortTable[name] = {};
    for (const h of HORIZONS) {
      shortTable[name][h] = Object.fromEntries(Object.keys(sess).map((k) => [k, shortSummary(tr[k], sess[k], name, h)]));
    }
  }
  const ranked = EVENT_NAMES.flatMap((name) => HORIZONS.map((h) => ({ name, h, dev: shortTable[name][h].development })))
    .filter((x) => x.dev.trades >= 200 && x.dev.mean_pct > 0 && x.dev.ci95)
    .sort((a, b) => b.dev.ci95[0] - a.dev.ci95[0]);
  const pick = ranked[0] ?? null;
  const cfg = pick ? { name: pick.name, h: pick.h } : { name: 'extended_any', h: 5 };
  const holdPrimary = shortTable[cfg.name][cfg.h].holdout;
  const hold100 = shortSummary(tr.holdout, sess.holdout, cfg.name, cfg.h, PRIMARY_STOP, 1);
  const shortHolds = Boolean(pick && holdPrimary.ci95 && holdPrimary.ci95[0] > 0 && hold100.mean_pct > 0);

  // Sensitivity grid (stop × borrow) for the selected (or reference) configuration.
  const grid = {};
  for (const era of ['development', 'holdout']) {
    grid[era] = {};
    for (const stopKey of Object.keys(STOPS)) {
      grid[era][stopKey] = {};
      for (const b of BORROW) {
        const s = shortSummary(tr[era], sess[era], cfg.name, cfg.h, stopKey, b);
        grid[era][stopKey][`${Math.round(b * 100)}`] = { trades: s.trades, mean_pct: s.mean_pct, ci95: s.ci95, worst_pct: s.worst_pct, p_loss_gt_50: s.p_loss_gt_50, stop_rate: s.stop_rate };
      }
    }
  }
  // Per-year and current easy-to-borrow split (diagnostics, not point in time for ETB).
  const years = {};
  for (const t of acc.trades) {
    const y = t.d.slice(0, 4);
    if (has(t, cfg.name) && t.short[PRIMARY_STOP][cfg.h] && (inEra(t.d, ERAS.development) || inEra(t.d, ERAS.holdout))) (years[y] ??= []).push({ d: t.d, v: shortNet(t.short[PRIMARY_STOP][cfg.h], PRIMARY_BORROW) });
  }
  const perYear = Object.fromEntries(Object.entries(years).sort().map(([y, v]) => [y, summarize(v, allSessions.filter((d) => d.startsWith(y)))]).map(([y, s]) => [y, { trades: s.trades, mean_pct: s.mean_pct, ci95: s.ci95, worst_pct: s.worst_pct }]));
  const etb = {};
  for (const era of ['development', 'holdout']) {
    etb[era] = {};
    for (const flag of [true, false]) {
      const sub = tr[era].filter((t) => t.etb === flag);
      const s = shortSummary(sub, sess[era], cfg.name, cfg.h);
      etb[era][flag ? 'easy_to_borrow_now' : 'not_easy_to_borrow_now'] = { trades: s.trades, mean_pct: s.mean_pct, ci95: s.ci95 };
    }
  }

  // B. avoid / exit flag.
  const avoid = {};
  for (const name of EVENT_NAMES) {
    avoid[name] = {};
    for (const h of HORIZONS) avoid[name][h] = Object.fromEntries(Object.keys(sess).map((k) => [k, avoidTest(tr[k], acc.base, sess[k], name, h)]));
  }
  const avoidPrimary = avoid.extended_any[5];
  const avoidHolds = Boolean(avoidPrimary.holdout.diff_ci95 && avoidPrimary.holdout.diff_ci95[1] < 0);
  const exitHolds = Boolean(avoidPrimary.holdout.flagged_gross_ci95 && avoidPrimary.holdout.flagged_gross_ci95[1] < 0);

  return {
    schema: 1,
    protocol: 'fade-study-1',
    updated_at: new Date().toISOString(),
    status: 'RESEARCH_EVIDENCE_ONLY',
    profitability_claim_allowed: false,
    costs: { round_trip_pp: COST_PP, primary_borrow_annual: PRIMARY_BORROW, borrow_sensitivity: BORROW, primary_stop: STOPS[PRIMARY_STOP], stop_slippage: STOP_SLIP },
    eras: Object.fromEntries(Object.entries(sess).map(([k, s]) => [k, { sessions: s.length, from: s[0] ?? null, to: s.at(-1) ?? null }])),
    universe: acc.universe,
    short: {
      selected: pick ? { event: pick.name, horizon_days: pick.h, development: pick.dev, holdout: holdPrimary, holdout_borrow_100: hold100 } : null,
      reference: { event: cfg.name, horizon_days: cfg.h, development: shortTable[cfg.name][cfg.h].development, holdout: holdPrimary, holdout_borrow_100: hold100, contaminated_holdout: shortTable[cfg.name][cfg.h].contaminated_holdout },
      holds: shortHolds,
      sensitivity: grid,
      per_year: perYear,
      easy_to_borrow_diagnostic: etb,
      table: shortTable,
    },
    avoid: {
      primary: { flag: 'extended_any', horizon_days: 5, ...avoidPrimary },
      holds: avoidHolds,
      exit_holds: exitHolds,
      table: avoid,
    },
  };
}

// ---- data ------------------------------------------------------------------------------------

let lastCall = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let requests = 0;
async function paced(url) {
  const wait = lastCall + PACE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  requests++;
  try { return await getJson(url); } finally { lastCall = Date.now(); }
}

async function relayPages(params, maxPages = 400) {
  const out = [];
  let token = null;
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams(params);
    if (token) q.set('page_token', token);
    const body = await paced(`${SERVICE}/api/lab/provider?${q}`);
    out.push(body);
    token = body?.next_page_token;
    if (!token) break;
  }
  return out;
}

async function universe(cacheDir) {
  const file = `${cacheDir}/universe.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const out = {};
  for (const status of ['active', 'inactive']) {
    const [list] = await relayPages({ resource: 'assets', status });
    for (const a of Array.isArray(list) ? list : []) {
      if (a.exchange === 'NASDAQ' && SYMBOL.test(a.symbol) && !EXCLUDE.test(a.name ?? '')) out[a.symbol] = { status, shortable: a.shortable ?? null, etb: a.easy_to_borrow ?? null };
    }
  }
  writeFileSync(file, JSON.stringify(out));
  return out;
}

const cacheFile = (dir, s) => `${dir}/${s}.json.gz`;
function readCache(dir, s) {
  try { return JSON.parse(gunzipSync(readFileSync(cacheFile(dir, s))).toString()); } catch { return { w: {} }; }
}

/** Bars for one group of symbols; fetches only (symbol, window) pairs missing from the cache. */
async function groupBars(dir, group, offline) {
  const cache = Object.fromEntries(group.map((s) => [s, readCache(dir, s)]));
  for (const [start, end] of WINDOWS) {
    const key = `${start}_${end}`;
    const need = group.filter((s) => !cache[s].w[key]);
    if (!need.length || offline) continue;
    const got = Object.fromEntries(need.map((s) => [s, []]));
    const pages = await relayPages({ resource: 'bars', symbols: need.join(','), timeframe: '1Day', start: `${start}T00:00:00Z`, end: `${end}T23:59:00Z`, feed: 'sip', adjustment: 'split', limit: '10000', sort: 'asc' });
    for (const body of pages) {
      for (const [s, list] of Object.entries(body?.bars ?? {})) for (const b of list) got[s]?.push([nyDate.format(new Date(b.t)), b.o, b.h, b.l, b.c, b.v]);
    }
    for (const s of need) {
      cache[s].w[key] = got[s];
      writeFileSync(cacheFile(dir, s), gzipSync(JSON.stringify(cache[s])));
    }
  }
  const out = new Map();
  for (const s of group) {
    const seen = new Map();
    for (const arr of Object.values(cache[s].w)) for (const [d, o, h, l, c, v] of arr) seen.set(d, { d, o, h, l, c, v });
    const bars = [...seen.values()].sort((a, b) => a.d.localeCompare(b.d));
    bars.symbol = s;
    if (bars.length) out.set(s, bars);
  }
  return out;
}

/** Daily flag list for the site: extension events on the last FADE_WINDOW_SESSIONS completed sessions. */
export function flagList(barsBySymbol, now = new Date()) {
  const nyNow = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (t) => nyNow.find((x) => x.type === t).value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const closed = Number(part('hour')) * 60 + Number(part('minute')) >= 16 * 60 + 20;
  const all = new Set();
  for (const bars of barsBySymbol.values()) for (const b of bars) if (b.d < today || (b.d === today && closed)) all.add(b.d);
  const sessions = [...all].sort().reverse().slice(0, FADE_WINDOW_SESSIONS);
  const symbols = {};
  for (const [s, raw] of barsBySymbol) {
    const bars = raw.filter((b) => b.d <= (sessions[0] ?? ''));
    for (let i = bars.length - 1; i >= 21 && sessions.includes(bars[i].d); i--) {
      const events = extensionEvents(bars, i);
      if (events.length) { symbols[s] = { d: bars[i].d, events, c: bars[i].c }; break; }
    }
  }
  return { schema: 1, protocol: 'fade-study-1', updated_at: now.toISOString(), as_of: sessions[0] ?? null, window_sessions: FADE_WINDOW_SESSIONS, sessions, symbols };
}

async function flagsMain() {
  const dir = `${tmpdir()}/tagit-fade-flags-${Date.now()}`;
  mkdirSync(dir, { recursive: true });
  const u = await universe(dir);
  const symbols = Object.keys(u).filter((s) => u[s].status === 'active').sort();
  const start = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  const end = new Date().toISOString().slice(0, 10);
  const barsBySymbol = new Map();
  for (let i = 0; i < symbols.length; i += 100) {
    const group = symbols.slice(i, i + 100);
    for (const body of await relayPages({ resource: 'bars', symbols: group.join(','), timeframe: '1Day', start: `${start}T00:00:00Z`, end: `${end}T23:59:00Z`, feed: 'sip', adjustment: 'split', limit: '10000', sort: 'asc' })) {
      for (const [s, list] of Object.entries(body?.bars ?? {})) {
        const arr = barsBySymbol.get(s) ?? [];
        for (const b of list) arr.push({ d: nyDate.format(new Date(b.t)), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
        barsBySymbol.set(s, arr);
      }
    }
  }
  for (const arr of barsBySymbol.values()) arr.sort((a, b) => a.d.localeCompare(b.d));
  const out = flagList(barsBySymbol);
  out.relay_requests = requests;
  writeFileSync(new URL('../data/fade-flags.json', import.meta.url), JSON.stringify(out) + '\n');
  console.log(`flags as of ${out.as_of}: ${Object.keys(out.symbols).length} symbols · ${requests} requests`);
}

async function main() {
  if (process.argv.includes('--flags')) return flagsMain();
  const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
  const limit = Number(arg('--limit-symbols') ?? Infinity);
  const offline = process.argv.includes('--offline');
  const dir = arg('--cache') ?? process.env.FADE_CACHE ?? `${tmpdir()}/tagit-fade-bars`;
  mkdirSync(dir, { recursive: true });
  const u = await universe(dir);
  const symbols = Object.keys(u).sort().slice(0, limit);
  const lastTo = ERAS.development.to;
  const acc = { trades: [], base: new Map(), universe: { symbols: symbols.length, inactive: symbols.filter((s) => u[s].status === 'inactive').length, easy_to_borrow_now: symbols.filter((s) => u[s].etb).length } };
  console.log(`universe ${symbols.length} Nasdaq listings (${acc.universe.inactive} inactive), cache ${dir}`);
  const sessions = new Set();
  let dataEnd = '0000';
  const started = Date.now();
  const groups = [];
  for (let i = 0; i < symbols.length; i += 100) groups.push(symbols.slice(i, i + 100));
  // Fetch (or load) everything first so the global end of data is known before labelling trades.
  for (const [k, group] of groups.entries()) {
    const bars = await groupBars(dir, group, offline);
    for (const arr of bars.values()) if (arr.length && arr.at(-1).d > dataEnd) dataEnd = arr.at(-1).d;
    console.log(`fetch ${k + 1}/${groups.length} · ${requests} requests · ${Math.round((Date.now() - started) / 60000)} min`);
  }
  // A symbol whose bars run to within a week of the end of data has not delisted.
  const openEnd = new Date(dayMs(dataEnd) - 7 * 86_400_000).toISOString().slice(0, 10);
  for (const group of groups) {
    const bars = await groupBars(dir, group, true);
    for (const [s, arr] of bars) {
      for (const b of arr) if (b.d >= ERAS.holdout.from && b.d <= lastTo) sessions.add(b.d);
      // Bars after `lastTo` stay attached for exits only; no signal is taken after it.
      scanSymbol(arr, acc, openEnd, { etb: u[s].etb }, lastTo);
    }
  }
  for (const d of [...acc.base.keys()]) if (d > lastTo || d < ERAS.holdout.from) acc.base.delete(d);
  const days = [...sessions].sort();
  const report = analyze(acc, days);
  report.data_end = dataEnd;
  report.relay_requests = requests;
  report.examples = [...acc.trades].sort((a, b) => a.d.localeCompare(b.d)).slice(-30)
    .map((t) => ({ s: t.s, d: t.d, c: t.c, ev: t.ev, short_net_h5: t.short[PRIMARY_STOP][5] ? r3(shortNet(t.short[PRIMARY_STOP][5], PRIMARY_BORROW)) : null }));
  writeFileSync(new URL('../data/fade-study.json', import.meta.url), JSON.stringify(report, null, 1) + '\n');
  const brief = (tab, pick) => Object.fromEntries(Object.entries(tab).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([h, s]) => [h, pick(s)]))]));
  console.log(JSON.stringify({
    eras: report.eras,
    short_selected: report.short.selected, short_holds: report.short.holds, short_reference: report.short.reference,
    short: brief(report.short.table, (s) => [s.development.trades, s.development.mean_pct, s.holdout.trades, s.holdout.mean_pct, s.holdout.ci95, s.holdout.p_loss_gt_50]),
    avoid_primary: report.avoid.primary, avoid_holds: report.avoid.holds, exit_holds: report.avoid.exit_holds,
  }, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
