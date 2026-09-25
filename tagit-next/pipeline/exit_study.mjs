// Exit-rule study for discovery-1 signals on consolidated (SIP) minute bars.
//
// Protocol exit-study-1, fixed before any result was computed (2026-09-25):
//  - Signals: the unchanged detector replayed on regular-session SIP bars for today's eligible
//    universe (same as sip-study-1). Two entries per signal: at detection (first bar within 2 min)
//    and delayed (first bar within 2 min after detection + 17 min, when a free signal is visible).
//  - Eleven exit rules, all capped at the 16:00 close, 0.5 pp assumed round-trip cost:
//      T10 / T30 / T60 / T120      hold 10, 30, 60, 120 minutes; exit at the last trade before then
//      TRAIL3 / TRAIL5 / TRAIL8    trailing stop 3/5/8% under the highest high since entry, max 120 min
//      DSTOP60                     detector stop, else 60 minutes
//      TP5_SL3_60                  +5% target / −3% stop / 60 minutes
//      TP10_SL5_120                +10% target / −5% stop / 120 minutes
//      HALF5_TRAIL3                sell half at +5%, trail the rest 3%, max 120 minutes
//    Inside one bar a stop is assumed hit before a target (conservative). A bar opening through a
//    stop exits at that open. Minutes without bars had no trades; the last price carries.
//  - Selection: the best rule is the highest development mean (entry at detection) among rules with
//    at least 1,000 trades. Every rule is reported on the holdout (last third of sessions), with a
//    95% interval from resampling whole sessions (1,000 draws). No rule is tuned on the holdout.
// Development evidence only: survivorship bias (today's universe), assumed cost, no quotes/fills.
import { writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { batches, fetchBatch, detectSymbol } from '../src/core/sipscan.js';
import { getJson, eligibleSymbols, session } from './sip_study.mjs';

const SERVICE = process.env.TAGIT_SERVICE || 'https://tagit-next-quotes.onrender.com';
const COST = 0.5;
const ENTRY_WINDOW = 2 * 60_000;
const DELAY = 17 * 60_000;
const PATH_MINUTES = 125;
const MIN = 60_000;

export const RULES = {
  T10: { hold: 10 }, T30: { hold: 30 }, T60: { hold: 60 }, T120: { hold: 120 },
  TRAIL3: { hold: 120, trail: 3 }, TRAIL5: { hold: 120, trail: 5 }, TRAIL8: { hold: 120, trail: 8 },
  DSTOP60: { hold: 60, detectorStop: true },
  TP5_SL3_60: { hold: 60, target: 5, stop: 3 },
  TP10_SL5_120: { hold: 120, target: 10, stop: 5 },
  HALF5_TRAIL3: { hold: 120, half: 5, trail: 3 },
};

/**
 * Apply one exit rule to a path of bars starting at the entry bar. Returns the net return after
 * cost in percent. `path` bars are {t (ms), o, h, l, c}.
 */
export function applyRule(rule, path, entry, closeMs, detectorStop) {
  const start = path[0].t;
  const end = Math.min(start + rule.hold * MIN, closeMs);
  let high = entry;
  let halfTaken = false;
  const stopLevel = rule.stop ? entry * (1 - rule.stop / 100) : rule.detectorStop && detectorStop > 0 && detectorStop < entry ? detectorStop : null;
  const target = rule.target ? entry * (1 + rule.target / 100) : null;
  const halfLevel = rule.half ? entry * (1 + rule.half / 100) : null;
  let last = entry;
  const done = (price) => {
    const gross = halfTaken ? 0.5 * (halfLevel / entry - 1) + 0.5 * (price / entry - 1) : price / entry - 1;
    return gross * 100 - COST;
  };
  for (const b of path) {
    if (b.t >= end) break;
    // Trailing level from the high before this bar (a bar cannot raise its own stop first).
    const trail = rule.trail && (!rule.half || halfTaken) ? high * (1 - rule.trail / 100) : null;
    const stops = [stopLevel, trail].filter((x) => x !== null);
    const activeStop = stops.length ? Math.max(...stops) : null;
    if (activeStop !== null && b.l <= activeStop) return done(Math.min(b.o, activeStop));
    if (target !== null && b.h >= target) return done(Math.max(b.o, target));
    if (halfLevel !== null && !halfTaken && b.h >= halfLevel) halfTaken = true;
    high = Math.max(high, b.h);
    last = b.c;
  }
  return done(last);
}

function entryPath(bars, from, closeMs) {
  const i = bars.findIndex((b) => b.t >= from && b.t < from + ENTRY_WINDOW);
  if (i < 0 || bars[i].t >= closeMs || !(bars[i].o > 0)) return null;
  const path = [];
  for (let j = i; j < bars.length && bars[j].t < bars[i].t + PATH_MINUTES * MIN && bars[j].t < closeMs; j++) path.push(bars[j]);
  return path;
}

export function evaluateSignal(bars, signal, closeMs) {
  const at = Date.parse(signal.detected_at);
  const out = {};
  for (const [mode, from] of [['now', at], ['late', at + DELAY]]) {
    const path = entryPath(bars, from, closeMs);
    if (!path) { out[mode] = null; continue; }
    const entry = path[0].o;
    out[mode] = Object.fromEntries(Object.entries(RULES).map(([k, r]) => [k, Math.round(applyRule(r, path, entry, closeMs, signal.stop) * 1000) / 1000]));
  }
  return out;
}

// ---- statistics -----------------------------------------------------------------------------

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

/** Deterministic PRNG so intervals are reproducible. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Per-rule mean, win rate and a session-block bootstrap interval for one entry mode. */
export function ruleStats(days, mode, draws = 1000) {
  const out = {};
  for (const rule of Object.keys(RULES)) {
    const perDay = days.map((d) => d.signals.map((s) => s[mode]?.[rule]).filter(Number.isFinite));
    const all = perDay.flat();
    const random = rng(42);
    const means = [];
    for (let i = 0; i < draws && perDay.length; i++) {
      let sum = 0, n = 0;
      for (let k = 0; k < perDay.length; k++) {
        const day = perDay[Math.floor(random() * perDay.length)];
        for (const x of day) { sum += x; n++; }
      }
      if (n) means.push(sum / n);
    }
    means.sort((a, b) => a - b);
    out[rule] = {
      trades: all.length,
      mean_pct: r3(mean(all)),
      win_rate: all.length ? r3(all.filter((x) => x > 0).length / all.length) : null,
      ci95: means.length ? [r3(means[Math.floor(0.025 * means.length)]), r3(means[Math.floor(0.975 * means.length) - 1])] : null,
    };
  }
  return out;
}

export function report(days) {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const cut = Math.floor(sorted.length * 2 / 3);
  const dev = sorted.slice(0, cut), hold = sorted.slice(cut);
  const devNow = ruleStats(dev, 'now');
  const eligible = Object.entries(devNow).filter(([, s]) => s.trades >= 1000);
  const best = eligible.sort((a, b) => b[1].mean_pct - a[1].mean_pct)[0]?.[0] ?? null;
  const holdNow = ruleStats(hold, 'now');
  return {
    schema: 1,
    protocol: 'exit-study-1',
    updated_at: new Date().toISOString(),
    status: 'DEVELOPMENT_DIAGNOSTIC_ONLY',
    profitability_claim_allowed: false,
    cost_pp: COST,
    rules: RULES,
    sessions: sorted.length,
    first_session: sorted[0]?.date ?? null,
    last_session: sorted.at(-1)?.date ?? null,
    split: { development_sessions: dev.length, holdout_sessions: hold.length, holdout_from: hold[0]?.date ?? null },
    signals: sorted.reduce((a, d) => a + d.signals.length, 0),
    selected_on_development: best,
    selected_holdout: best ? holdNow[best] : null,
    development: { now: devNow, late: ruleStats(dev, 'late') },
    holdout: { now: holdNow, late: ruleStats(hold, 'late') },
  };
}

// ---- run ------------------------------------------------------------------------------------

async function studyDay(day, symbols, pathsOut) {
  const { open, close } = session(day);
  const window = { start: new Date(open).toISOString().replace('.000Z', 'Z'), end: new Date(close).toISOString().replace('.000Z', 'Z') };
  const signals = [];
  let withBars = 0;
  for (const group of batches(symbols)) {
    let data;
    try { data = await fetchBatch(getJson, SERVICE, group, window); } catch (e) { console.error(`${day} batch failed: ${e.message}`); continue; }
    for (const [symbol, raw] of Object.entries(data)) {
      withBars++;
      const bars = raw.map((b) => ({ t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: b.n, vw: b.vw }));
      const iso = bars.map((b) => ({ ...b, t: new Date(b.t).toISOString() }));
      for (const s of detectSymbol(symbol, iso)) {
        const r = evaluateSignal(bars, s, close);
        signals.push({ symbol, at: s.detected_at, price: s.price, vr: s.volume_ratio, usd3: Math.round(s.dollars_3m), ...r });
        // Price path for later offline research (filters, other exits): from detection, 150 minutes.
        const at = Date.parse(s.detected_at);
        pathsOut.push({ date: day, symbol, at: s.detected_at, signal: s, bars: bars.filter((b) => b.t >= at - 30 * MIN && b.t < at + 150 * MIN).map((b) => [b.t, b.o, b.h, b.l, b.c, b.v, b.n]) });
      }
    }
  }
  return { date: day, with_bars: withBars, signals };
}

function tradingDays(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() % 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function main() {
  const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
  const symbols = eligibleSymbols();
  const days = [];
  const paths = [];
  const started = Date.now();
  for (const day of tradingDays(arg('--from'), arg('--to'))) {
    if (Date.now() - started > Number(arg('--max-minutes') ?? 320) * MIN) { console.log('time budget reached'); break; }
    const result = await studyDay(day, symbols, paths);
    if (!result.with_bars) { console.log(`${day}: no bars`); continue; }
    days.push(result);
    const t30 = result.signals.map((s) => s.now?.T30).filter(Number.isFinite);
    console.log(`${day}: ${result.signals.length} signals, T30 mean ${r3(mean(t30))}%`);
  }
  const out = report(days);
  writeFileSync(new URL('../data/exit-study.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
  mkdirSync('signal-paths', { recursive: true });
  writeFileSync('signal-paths/paths.json.gz', gzipSync(JSON.stringify({ schema: 1, universe: symbols.length, signals: paths })));
  console.log(JSON.stringify({ sessions: out.sessions, signals: out.signals, selected: out.selected_on_development, selected_holdout: out.selected_holdout, holdout_now: out.holdout.now }, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
