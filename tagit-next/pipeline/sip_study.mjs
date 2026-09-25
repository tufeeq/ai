// Consolidated (SIP) study and daily forward evaluation for discovery-1.
//
// For each session: fetch regular-session SIP minute bars for every eligible symbol through the
// quote service's read-only relay, replay the unchanged detector minute by minute (causal: each
// decision uses only earlier bars), and label every signal twice with outcome-relabel-1:
//   at_detection — entry within 2 minutes of the decision time (what the study measures);
//   delayed      — entry within 2 minutes after decision + 17 minutes, when a free SIP signal
//                  is first visible (what a user of the delayed list could actually do).
// Exits at the last trade before +30 minutes or the 16:00 close; 0.5 pp assumed cost.
//
// Usage: node sip_study.mjs --from 2026-07-01 --to 2026-09-25 [--out path]
//        node sip_study.mjs --today
// The universe is today's eligible list (Nasdaq-listed, reference cap < $100M): survivorship bias
// remains for past sessions and is reported.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { batches, fetchBatch, detectSymbol } from '../src/core/sipscan.js';

const SERVICE = process.env.TAGIT_SERVICE || 'https://tagit-next-quotes.onrender.com';
const ROOT = new URL('../', import.meta.url);
const OUT_DEFAULT = new URL('data/sip-outcomes.json', ROOT); // summary the page loads
const RAW_DEFAULT = new URL('data/sip-events.json', ROOT); // every labeled signal, for incremental runs
const COST_PP = 0.5;
const HORIZON = 30 * 60_000;
const ENTRY_WINDOW = 2 * 60_000;
const DELAY = 17 * 60_000;
const KEEP_DAYS = 250;
const MAX_CAP_MILLIONS = 100;

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The relay allows 40 provider requests per minute; stay under it and retry politely.
let lastCall = 0;
async function getJson(url) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = lastCall + 1600 - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      const body = await r.json().catch(() => null);
      if (r.ok) return body;
      if (r.status === 429 || r.status === 503) { await sleep(15_000 * (attempt + 1)); continue; }
      throw new Error(`${r.status} ${body?.status ?? ''}`);
    } catch (e) {
      if (attempt === 5) throw e;
      await sleep(5_000 * (attempt + 1));
    }
  }
  throw new Error('RELAY_RETRIES_EXHAUSTED');
}

export function eligibleSymbols() {
  const e = JSON.parse(readFileSync(new URL('data/enrichment.json', ROOT)));
  return Object.entries(e.symbols)
    .filter(([, v]) => v.reference_cap_millions > 0 && v.reference_cap_millions < MAX_CAP_MILLIONS)
    .map(([s]) => s);
}

/** Regular session bounds for a New York date, handling EDT/EST. */
export function session(day) {
  const probe = new Date(`${day}T16:00:00Z`);
  const nyHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(probe));
  const offset = 16 - nyHour; // 4 in EDT, 5 in EST
  const open = Date.parse(`${day}T${String(9 + offset).padStart(2, '0')}:30:00Z`);
  return { open, close: open + 390 * 60_000 };
}

/** outcome-relabel-1 on minute bars from `entryFrom`. */
export function label(bars, entryFrom, close, signal) {
  const horizonCap = Math.min(entryFrom + HORIZON, close);
  const entryBar = bars.find((b) => Date.parse(b.t) >= entryFrom && Date.parse(b.t) < entryFrom + ENTRY_WINDOW);
  if (!entryBar || !(entryBar.o > 0) || Date.parse(entryBar.t) >= close) return { status: 'NO_ENTRY' };
  const path = bars.filter((b) => Date.parse(b.t) >= Date.parse(entryBar.t) && Date.parse(b.t) < horizonCap);
  const entry = entryBar.o, exit = path.at(-1).c;
  const out = {
    status: 'RESOLVED',
    exit_kind: horizonCap < entryFrom + HORIZON ? 'SESSION_END' : 'TIME_30M',
    return_pct: (exit / entry - 1) * 100 - COST_PP,
    max_up_pct: (Math.max(...path.map((b) => b.h)) / entry - 1) * 100,
    max_down_pct: (Math.min(...path.map((b) => b.l)) / entry - 1) * 100,
  };
  if (signal.plan_valid && signal.stop > 0 && entry > signal.stop && entry <= signal.trigger * 1.01) {
    const risk = entry - signal.stop, target = entry + 2 * risk;
    let plan = { status: 'TIME', r: (exit - entry) / risk };
    for (const b of path) {
      if (b.l <= signal.stop) { plan = { status: 'STOP', r: (signal.stop - entry) / risk }; break; }
      if (b.h >= target) { plan = { status: 'TARGET_2R', r: 2 }; break; }
    }
    out.plan = plan;
  } else {
    out.plan = { status: !signal.plan_valid ? 'NO_PLAN' : entry > signal.trigger * 1.01 ? 'CHASED' : 'INVALIDATED' };
  }
  return out;
}

const round = (x, d = 3) => (Number.isFinite(x) ? Number(x.toFixed(d)) : x);

export async function studyDay(day, symbols) {
  const { open, close } = session(day);
  const window = { start: new Date(open).toISOString().replace('.000Z', 'Z'), end: new Date(close).toISOString().replace('.000Z', 'Z') };
  const events = [];
  let withBars = 0, bars = 0, failed = 0;
  for (const group of batches(symbols)) {
    let data;
    try {
      data = await fetchBatch(getJson, SERVICE, group, window);
    } catch (e) {
      failed += group.length;
      console.error(`${day} batch failed: ${e.message}`);
      continue;
    }
    for (const [symbol, raw] of Object.entries(data)) {
      withBars++;
      bars += raw.length;
      const series = raw.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: b.n, vw: b.vw }));
      for (const s of detectSymbol(symbol, series)) {
        const at = Date.parse(s.detected_at);
        const now = label(series, at, close, s);
        const late = label(series, at + DELAY, close, s);
        events.push({
          symbol, at: s.detected_at, price: s.price, r3: round(s.return_3m, 2), vr: round(s.volume_ratio, 2), usd3: Math.round(s.dollars_3m),
          n3: s.trades_3m, bo: s.breakout, now: compact(now), late: compact(late),
        });
      }
    }
  }
  return { date: day, symbols: symbols.length, with_bars: withBars, failed, bars, events };
}

const compact = (l) => (l.status !== 'RESOLVED' ? { s: l.status } : {
  s: 'R', ret: round(l.return_pct), up: round(l.max_up_pct), dn: round(l.max_down_pct), end: l.exit_kind === 'SESSION_END' ? 1 : 0,
  plan: l.plan.status, r: round(l.plan.r),
});

// ---- summaries --------------------------------------------------------------------------

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function summarize(events, key) {
  const labels = events.map((e) => e[key]);
  const resolved = labels.filter((l) => l.s === 'R');
  const rets = resolved.map((l) => l.ret);
  const plans = resolved.filter((l) => ['STOP', 'TARGET_2R', 'TIME'].includes(l.plan));
  return {
    signals: labels.length,
    resolved: resolved.length,
    no_entry: labels.length - resolved.length,
    mean_return_pct: round(mean(rets)),
    median_return_pct: round(median(rets)),
    win_rate: resolved.length ? round(rets.filter((r) => r > 0).length / resolved.length, 3) : null,
    reached_5pct: resolved.filter((l) => l.up >= 5).length,
    reached_10pct: resolved.filter((l) => l.up >= 10).length,
    plan_traded: plans.length,
    plan_target: plans.filter((l) => l.plan === 'TARGET_2R').length,
    plan_stop: plans.filter((l) => l.plan === 'STOP').length,
    plan_mean_r: round(mean(plans.map((l) => l.r))),
  };
}

/** Descriptive breakdowns on the development part only; the holdout is reported, never tuned on. */
export function breakdowns(events) {
  const groups = {
    price: (e) => (e.price < 1 ? '< $1' : e.price < 5 ? '$1–5' : '≥ $5'),
    volume_ratio: (e) => (e.vr < 3 ? '2–3×' : e.vr < 6 ? '3–6×' : '≥ 6×'),
    dollars_3m: (e) => (e.usd3 < 50_000 ? '$25–50K' : e.usd3 < 250_000 ? '$50–250K' : '≥ $250K'),
    time: (e) => {
      const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date(e.at)));
      return h < 11 ? 'قبل 11:00' : h < 14 ? '11:00–14:00' : 'بعد 14:00';
    },
    breakout: (e) => (e.bo ? 'اختراق' : 'دون اختراق'),
  };
  return Object.fromEntries(Object.entries(groups).map(([name, fn]) => {
    const buckets = {};
    for (const e of events) (buckets[fn(e)] ??= []).push(e);
    return [name, Object.fromEntries(Object.entries(buckets).map(([k, list]) => [k, summarize(list, 'now')]))];
  }));
}

export function buildReport(days, symbolsCount) {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date)).slice(-KEEP_DAYS);
  const all = sorted.flatMap((d) => d.events);
  const cut = Math.floor(sorted.length * 2 / 3);
  const dev = sorted.slice(0, cut).flatMap((d) => d.events);
  const hold = sorted.slice(cut).flatMap((d) => d.events);
  return {
    schema: 1,
    protocol: 'sip-study-1 (discovery-1 detector, outcome-relabel-1 labels)',
    updated_at: new Date().toISOString(),
    status: 'DEVELOPMENT_AND_FORWARD_OBSERVATION',
    profitability_claim_allowed: false,
    universe: `${symbolsCount} Nasdaq-listed symbols below $100M in today's reference (survivorship bias for past sessions)`,
    cost_pp: COST_PP,
    delay_minutes: DELAY / 60_000,
    sessions: sorted.length,
    first_session: sorted[0]?.date ?? null,
    last_session: sorted.at(-1)?.date ?? null,
    split: { development_sessions: cut, holdout_sessions: sorted.length - cut, holdout_from: sorted[cut]?.date ?? null },
    totals: { at_detection: summarize(all, 'now'), delayed: summarize(all, 'late') },
    development: { at_detection: summarize(dev, 'now'), delayed: summarize(dev, 'late') },
    holdout: { at_detection: summarize(hold, 'now'), delayed: summarize(hold, 'late') },
    breakdowns_development: breakdowns(dev),
    breakdowns_holdout: breakdowns(hold),
    days: sorted.map((d) => ({ date: d.date, symbols: d.symbols, with_bars: d.with_bars, failed: d.failed, signals: d.events.length, ...pick(summarize(d.events, 'now')) })),
    recent_signals: sorted.slice(-2).flatMap((d) => d.events).slice(-200),
  };
}
const pick = (s) => ({ resolved: s.resolved, mean_return_pct: s.mean_return_pct, win_rate: s.win_rate });

function tradingDays(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function main() {
  const out = arg('--out') ? new URL(arg('--out'), `file://${process.cwd()}/`) : OUT_DEFAULT;
  const rawOut = arg('--raw') ? new URL(arg('--raw'), `file://${process.cwd()}/`) : RAW_DEFAULT;
  const existing = existsSync(rawOut) ? JSON.parse(readFileSync(rawOut)) : null;
  const known = new Map((existing?.days ?? []).map((d) => [d.date, d]));
  const save = () => {
    const days = [...known.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-KEEP_DAYS);
    writeFileSync(rawOut, JSON.stringify({ schema: 1, days }) + '\n');
    const report = buildReport(days, symbols.length);
    writeFileSync(out, JSON.stringify(report) + '\n');
    return report;
  };
  const symbols = eligibleSymbols();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const wanted = process.argv.includes('--today') ? [today] : tradingDays(arg('--from'), arg('--to') ?? today);
  const maxMinutes = Number(arg('--max-minutes') ?? 300);
  const started = Date.now();
  console.log(`universe ${symbols.length} symbols; ${wanted.length} weekdays`);
  for (const day of wanted) {
    if (Date.now() - started > maxMinutes * 60_000) { console.log('time budget reached; rerun to continue'); break; }
    if (known.has(day) && day !== today && !process.argv.includes('--refresh')) continue;
    if (day === today && Date.now() < session(day).close + 17 * 60_000) { console.log(`${day}: session not complete`); continue; }
    const result = await studyDay(day, symbols);
    if (!result.with_bars) { console.log(`${day}: no bars (holiday or provider gap)`); continue; }
    known.set(day, result);
    const s = summarize(result.events, 'now');
    console.log(`${day}: ${result.with_bars}/${result.symbols} with bars, ${result.events.length} signals, resolved ${s.resolved}, mean ${s.mean_return_pct}%`);
    save();
  }
  const report = save();
  console.log(JSON.stringify({ sessions: report.sessions, totals: report.totals, holdout: report.holdout }, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
