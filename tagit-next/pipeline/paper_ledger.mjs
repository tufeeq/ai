// Forward paper-trade ledger (protocol paper-ledger-1). The only honest out-of-sample test left:
// every signal the tool would have shown in a session is traded on paper AFTER the session with
// consolidated (SIP) minute bars and the same cost model as the page's calculator.
//
// PRE-REGISTERED RULES (frozen 2026-09-27, before any forward session was recorded; changing any
// of them requires a new protocol name and a fresh ledger):
//  Books
//   SIP_DELAYED  every discovery-1 signal on SIP bars for the eligible universe (the page's SIP
//                tab). Visible at detection + 17 minutes (free SIP delay); entry = open of the
//                first bar in [visible, visible + 2 min).
//   LIVE_ALERTS  every alert of the live scanner recorded by forward.py (the page's live list);
//                entry = open of the first SIP bar in [detected, detected + 2 min).
//  Regular session only (09:30–16:00 New York); extended-hours alerts are counted, not traded.
//  Plan: the signal's own trigger/stop. Skipped (not traded) when there is no valid plan, the
//   entry is at or below the stop, or the entry is more than 1% above the trigger (the page's
//   chase rule). Target = entry + 2 × (entry − stop).
//  Exits, walking bars from the entry bar: a bar opening at/below the stop exits at its open
//   (gap); a bar trading at/below the stop exits at the stop; else a bar trading strictly above
//   the target exits at the target; else the last close before entry + 30 min or 16:00.
//   Stop is checked first within a bar (conservative).
//  Costs (src/core/costs.js, identical to the page): full quoted spread + square-root impact per
//   side + SEC/TAF fees, floor 0.5 pp round trip, plus one extra spread on stop exits. Spread =
//   median SIP quoted spread in the first 60 s after the entry time (measured for up to
//   QUOTE_CAP trades a day, earliest first; others use the 1.0% fallback, flagged).
//  Size: reference account $10,000, $100 maximum loss per trade INCLUDING costs, liquidity caps
//   (10% of the average minute dollar volume of the 3 bars before entry, 1% of the session's
//   dollar volume so far). Trades are independent (no portfolio limit).
//  Gate (src/core/tradeability.js thresholds, from data before entry only): halted at entry,
//   spread > 1.5%, minute dollar volume < $8K, or cost ≥ 0.5 R → GATED. Gated trades are still
//   simulated and reported separately, so the gate's own value is measured forward.
//  Statistics: net P&L ($ and R), hit rate (net > 0) with a Wilson 95% interval, mean net R with
//   a 95% session-block bootstrap interval. No verdict before 20 sessions and 100 trades; even
//   then only an interval entirely above zero counts as evidence of an edge.
// Paper trades are bar simulations, not fills; no order is ever placed.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { batches, fetchBatch, detectSymbol } from '../src/core/sipscan.js';
import { sizeWithCosts, roundTripCost, spreadPct } from '../src/core/costs.js';
import { GATE } from '../src/core/tradeability.js';

export const PROTOCOL = 'paper-ledger-1';
export const FORWARD_START = '2026-09-28';
export const ACCOUNT = Object.freeze({ capital: 10_000, riskBudget: 100 });
export const SIP_VISIBLE_MS = 17 * 60_000;
export const ENTRY_WINDOW_MS = 2 * 60_000;
export const HORIZON_MS = 30 * 60_000;
export const CHASE = 1.01;
export const QUOTE_CAP = 120;
export const MIN_SESSIONS = 20;
export const MIN_TRADES = 100;

const SERVICE = process.env.TAGIT_SERVICE || 'https://tagit-next-quotes.onrender.com';
const ROOT = new URL('../', import.meta.url);
const OUT_DEFAULT = new URL('data/paper-ledger.json', ROOT);
const PACE_MS = 3_100; // relay: 40 requests/min shared by every agent and the live site
const HALTS_RSS = 'https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (x, d = 4) => (Number.isFinite(x) ? Number(x.toFixed(d)) : x ?? null);
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };

// ---- paced relay access --------------------------------------------------------------------

let lastCall = 0;
export let requestCount = 0;
export async function getJson(url) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = lastCall + PACE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    requestCount++;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      const body = await r.json().catch(() => null);
      if (r.ok) return body;
      if (r.status === 429 || r.status === 503 || body?.status === 'RATE_LIMITED') { await sleep(20_000 * (attempt + 1)); continue; }
      throw new Error(`${r.status} ${body?.status ?? ''}`);
    } catch (e) {
      if (attempt === 5) throw e;
      await sleep(5_000 * (attempt + 1));
    }
  }
  throw new Error('RELAY_RETRIES_EXHAUSTED');
}

// ---- session, halts ------------------------------------------------------------------------

export function session(day) {
  const probe = new Date(`${day}T16:00:00Z`);
  const nyHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(probe));
  const open = Date.parse(`${day}T${String(9 + 16 - nyHour).padStart(2, '0')}:30:00Z`);
  return { open, close: open + 390 * 60_000 };
}

/** "09/25/2026" + "10:01:02" New York → epoch ms; null when malformed. */
export function nyTime(date, time) {
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date ?? ''), t = /^(\d{2}):(\d{2}):(\d{2})$/.exec(time ?? '');
  if (!d || !t) return null;
  const wall = Date.UTC(+d[3], +d[1] - 1, +d[2], +t[1], +t[2], +t[3]);
  for (const offset of [4, 5]) {
    const guess = wall + offset * 3_600_000;
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    if (+p.hour === +t[1] && +p.minute === +t[2]) return guess;
  }
  return null;
}

/** Every halt in a Nasdaq Trader RSS document, resumed or not: symbol → [{ from, to }]. */
export function parseHaltHistory(xml) {
  const tag = (item, name) => { const m = item.match(new RegExp(`<ndaq:${name}>([^<]*)</ndaq:${name}>`)); return m ? m[1].trim() || null : null; };
  const out = new Map();
  for (const item of String(xml).split('<item>').slice(1)) {
    const symbol = tag(item, 'IssueSymbol');
    const from = nyTime(tag(item, 'HaltDate'), tag(item, 'HaltTime'));
    if (!symbol || !from) continue;
    const resumed = nyTime(tag(item, 'ResumptionDate'), tag(item, 'ResumptionTradeTime'));
    if (!out.has(symbol)) out.set(symbol, []);
    out.get(symbol).push({ from, to: resumed ?? Infinity, reason: tag(item, 'ReasonCode') });
  }
  return out;
}

export const haltedAt = (halts, symbol, t) => (halts?.get(symbol) ?? []).some((h) => h.from <= t && t < h.to);
export const haltDuring = (halts, symbol, a, b) => (halts?.get(symbol) ?? []).some((h) => h.from < b && h.to > a);

async function loadHalts(day) {
  const [y, m, d] = day.split('-');
  try {
    const r = await fetch(`${HALTS_RSS}&haltdate=${m}${d}${y}`, { headers: { 'User-Agent': 'Mozilla/5.0 TAGit NEXT paper ledger' }, signal: AbortSignal.timeout(20_000) });
    const text = await r.text();
    if (!r.ok || !text.includes('<rss')) throw new Error(`HTTP_${r.status}`);
    return { status: 'OK', halts: parseHaltHistory(text) };
  } catch (e) {
    return { status: 'UNAVAILABLE', error: e.message, halts: new Map() };
  }
}

// ---- simulation ----------------------------------------------------------------------------

/** Liquidity known at time `at`: average dollar volume of the 3 bars before it and the session so far. */
export function liquidityBefore(bars, at, open) {
  const before = bars.filter((b) => Date.parse(b.t) + 60_000 <= at);
  const last3 = before.slice(-3);
  const minuteDollars = last3.length ? last3.reduce((s, b) => s + b.c * b.v, 0) / 3 : null;
  const dayDollars = before.filter((b) => Date.parse(b.t) >= open).reduce((s, b) => s + b.c * b.v, 0) || null;
  return { minuteDollars, dayDollars };
}

/** Median quoted spread (%) of valid quotes; null without any. */
export function medianSpread(quotes) {
  const s = (quotes ?? []).map((q) => spreadPct(q.bp, q.ap)).filter((x) => x !== null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Simulate one paper trade. `signal` has trigger, stop, plan_valid; `visibleAt` is when the page
 * showed it. Returns { status, ... } — TRADED with P&L, or the reason it was not traded.
 */
export function simulate(bars, signal, { visibleAt, close, open, spread = null, halts = null, symbol = signal.symbol }) {
  const entryBar = bars.find((b) => { const t = Date.parse(b.t); return t >= visibleAt && t < visibleAt + ENTRY_WINDOW_MS && t < close; });
  if (!entryBar || !(entryBar.o > 0)) return { status: 'NO_ENTRY' };
  const entry = entryBar.o;
  const entryAt = Date.parse(entryBar.t);
  if (!signal.plan_valid || !(signal.stop > 0) || !(signal.trigger > 0)) return { status: 'NO_PLAN' };
  if (entry <= signal.stop) return { status: 'INVALIDATED', entry };
  if (entry > signal.trigger * CHASE) return { status: 'CHASED', entry };

  const stop = signal.stop;
  const riskPerShare = entry - stop;
  const target = entry + 2 * riskPerShare;
  const liq = liquidityBefore(bars, entryAt, open);
  const size = sizeWithCosts({ entry, stop, targets: [entry + riskPerShare, target] }, {
    riskBudget: ACCOUNT.riskBudget, capital: ACCOUNT.capital, spread, minuteDollars: liq.minuteDollars, dayDollars: liq.dayDollars,
  });
  if (!size || size.shares < 1) return { status: 'TOO_SMALL', entry };

  const horizon = Math.min(entryAt + HORIZON_MS, close);
  const path = bars.filter((b) => { const t = Date.parse(b.t); return t >= entryAt && t < horizon; });
  let exit = path.at(-1).c, exitAt = Date.parse(path.at(-1).t) + 60_000, kind = horizon < entryAt + HORIZON_MS ? 'SESSION_END' : 'TIME_30M';
  for (const b of path) {
    if (b.o <= stop && Date.parse(b.t) > entryAt) { exit = b.o; exitAt = Date.parse(b.t); kind = 'STOP_GAP'; break; }
    if (b.l <= stop) { exit = stop; exitAt = Date.parse(b.t); kind = 'STOP'; break; }
    if (b.h > target) { exit = target; exitAt = Date.parse(b.t); kind = 'TARGET_2R'; break; }
  }
  const shares = size.shares;
  const cost = roundTripCost({ price: entry, shares, spread, minuteDollars: liq.minuteDollars, exitPrice: exit });
  const stopExtra = kind.startsWith('STOP') ? shares * cost.stopExtraPerShare : 0;
  const gross = shares * (exit - entry);
  const costUsd = cost.totalUsd + stopExtra;
  const net = gross - costUsd;
  const plannedRisk = shares * riskPerShare;
  const costR = costUsd / plannedRisk;

  const gates = [];
  if (haltedAt(halts, symbol, entryAt)) gates.push('HALTED');
  if (spread !== null && spread > GATE.blockSpreadPct) gates.push('SPREAD');
  if (!(liq.minuteDollars >= GATE.blockMinuteDollars)) gates.push('LIQUIDITY');
  if (cost.totalUsd / plannedRisk >= GATE.blockCostR) gates.push('COST');

  return {
    status: 'TRADED',
    entry: round(entry), entry_at: iso(entryAt), exit: round(exit), exit_at: iso(exitAt), exit_kind: kind,
    stop: round(stop), target: round(target), shares, notional: round(shares * entry, 2), limited_by: size.limitedBy,
    spread_pct: round(cost.spreadPct, 3), spread_source: cost.spreadSource,
    minute_dollars: Math.round(liq.minuteDollars ?? 0),
    gross_usd: round(gross, 2), cost_usd: round(costUsd, 2), net_usd: round(net, 2),
    gross_r: round(gross / plannedRisk, 3), cost_r: round(costR, 3), net_r: round(net / plannedRisk, 3),
    halt_during: haltDuring(halts, symbol, entryAt, exitAt),
    gate: gates.length ? 'GATED' : 'PASSED', gate_reasons: gates,
  };
}

// ---- statistics -----------------------------------------------------------------------------

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Wilson 95% interval for k successes in n. */
export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [round(c - h, 4), round(c + h, 4)];
}

/** Session-block bootstrap 95% interval for the mean of per-trade values grouped by day. */
export function blockBootstrap(days, draws = 2000, seed = 7) {
  const groups = days.filter((d) => d.length);
  if (groups.length < 2) return null;
  const random = rng(seed), means = [];
  for (let k = 0; k < draws; k++) {
    let s = 0, n = 0;
    for (let j = 0; j < groups.length; j++) { const g = groups[Math.floor(random() * groups.length)]; for (const x of g) s += x; n += g.length; }
    if (n) means.push(s / n);
  }
  means.sort((a, b) => a - b);
  return [round(means[Math.floor(0.025 * means.length)], 4), round(means[Math.ceil(0.975 * means.length) - 1], 4)];
}

/** Summary of a book over days: [{ date, trades: [...] }]. */
export function summarizeBook(days) {
  const trades = days.flatMap((d) => d.trades);
  const n = trades.length;
  const wins = trades.filter((t) => t.net_usd > 0).length;
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  let cum = 0;
  const curve = days.map((d) => { cum += sum(d.trades.map((t) => t.net_usd)); return { date: d.date, trades: d.trades.length, cum_net_usd: round(cum, 2) }; });
  const meanR = n ? sum(trades.map((t) => t.net_r)) / n : null;
  const ci = blockBootstrap(days.map((d) => d.trades.map((t) => t.net_r)));
  const sessions = days.length;
  const enough = sessions >= MIN_SESSIONS && n >= MIN_TRADES;
  return {
    trades: n,
    sessions,
    net_usd: round(sum(trades.map((t) => t.net_usd)), 2),
    gross_usd: round(sum(trades.map((t) => t.gross_usd)), 2),
    cost_usd: round(sum(trades.map((t) => t.cost_usd)), 2),
    mean_net_r: round(meanR, 4),
    mean_gross_r: n ? round(sum(trades.map((t) => t.gross_r)) / n, 4) : null,
    mean_cost_r: n ? round(sum(trades.map((t) => t.cost_r)) / n, 4) : null,
    mean_net_r_ci95: ci,
    hit_rate: n ? round(wins / n, 4) : null,
    hit_rate_ci95: wilson(wins, n),
    exits: Object.fromEntries(['TARGET_2R', 'STOP', 'STOP_GAP', 'TIME_30M', 'SESSION_END'].map((k) => [k, trades.filter((t) => t.exit_kind === k).length])),
    measured_spread_trades: trades.filter((t) => t.spread_source === 'QUOTE').length,
    verdict: !enough ? 'INSUFFICIENT_SAMPLE' : ci && ci[0] > 0 ? 'EDGE_EVIDENCE' : ci && ci[1] < 0 ? 'NEGATIVE' : 'INCONCLUSIVE',
    curve,
  };
}

// ---- one session ----------------------------------------------------------------------------

function eligibleSymbols() {
  const e = JSON.parse(readFileSync(new URL('data/enrichment.json', ROOT)));
  return Object.entries(e.symbols).filter(([, v]) => v.reference_cap_millions > 0 && v.reference_cap_millions < 100).map(([s]) => s);
}

function sipSymbolsFor(day) {
  const path = new URL('data/sip-events.json', ROOT);
  if (!existsSync(path)) return null;
  const d = JSON.parse(readFileSync(path)).days?.find((x) => x.date === day);
  return d ? { symbols: [...new Set(d.events.map((e) => e.symbol))], signals: d.events.length } : null;
}

function liveAlertsFor(day) {
  const path = new URL('data/forward-outcomes.json', ROOT);
  if (!existsSync(path)) return [];
  const d = JSON.parse(readFileSync(path)).days?.find((x) => x.summary?.date === day);
  return d?.events ?? [];
}

async function quoteSpread(symbol, at) {
  const q = new URLSearchParams({ resource: 'quotes', symbols: symbol, start: iso(at), end: iso(at + 60_000), feed: 'sip', limit: '50', sort: 'asc' });
  const body = await getJson(`${SERVICE}/api/lab/provider?${q}`);
  return medianSpread(body?.quotes?.[symbol]);
}

export async function runDay(day, { log = console.log } = {}) {
  const { open, close } = session(day);
  // Regular-session bars only, exactly like the published SIP study, so detections match it.
  const window = { start: iso(open), end: iso(close) };
  const sip = sipSymbolsFor(day);
  const live = liveAlertsFor(day);
  const universe = sip ? sip.symbols : eligibleSymbols();
  const symbols = [...new Set([...universe, ...live.map((a) => a.symbol).filter(Boolean)])];
  const halts = await loadHalts(day);
  const bars = new Map();
  let failed = 0;
  for (const group of batches(symbols)) {
    try {
      const data = await fetchBatch(getJson, SERVICE, group, window);
      for (const [s, list] of Object.entries(data)) bars.set(s, list.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: b.n, vw: b.vw })));
    } catch (e) {
      failed += group.length;
      log(`${day}: bar batch failed ${e.message}`);
    }
  }
  if (!bars.size) return null;

  // Candidates: SIP signals re-detected (same detector as the page), live alerts as recorded.
  const candidates = [];
  for (const s of universe) {
    for (const sig of detectSymbol(s, bars.get(s) ?? [], { from: open, to: close })) {
      candidates.push({ book: 'SIP_DELAYED', symbol: s, detected_at: sig.detected_at, visibleAt: Date.parse(sig.detected_at) + SIP_VISIBLE_MS, signal: sig });
    }
  }
  const extendedLive = [];
  for (const a of live) {
    const t = Date.parse(a.detected_at);
    if (!(t >= open && t < close)) { extendedLive.push(a); continue; }
    const p = a.plan_levels ?? a.plan ?? {};
    const signal = { plan_valid: p.entry > 0 && p.stop > 0 && p.entry > p.stop, trigger: p.entry, stop: p.stop };
    candidates.push({ book: 'LIVE_ALERTS', symbol: a.symbol, detected_at: a.detected_at, visibleAt: t, signal });
  }
  candidates.sort((a, b) => a.visibleAt - b.visibleAt);

  // Measure the spread for trades that will be entered (earliest first, capped).
  const records = [];
  let quotes = 0;
  for (const c of candidates) {
    const series = bars.get(c.symbol) ?? [];
    const opts = { visibleAt: c.visibleAt, close, open, halts: halts.halts, symbol: c.symbol };
    let result = simulate(series, c.signal, opts);
    if (result.status === 'TRADED' && quotes < QUOTE_CAP) {
      quotes++;
      let spread = null;
      try { spread = await quoteSpread(c.symbol, Date.parse(result.entry_at)); } catch (e) { log(`${c.symbol} quotes: ${e.message}`); }
      if (spread !== null) result = simulate(series, c.signal, { ...opts, spread });
    }
    records.push(result.status === 'TRADED'
      ? { book: c.book, symbol: c.symbol, detected_at: c.detected_at, ...result }
      : { book: c.book, symbol: c.symbol, detected_at: c.detected_at, status: result.status });
  }
  const count = (book) => records.filter((r) => r.book === book).length;
  log(`${day}: ${bars.size}/${symbols.length} symbols with bars, ${count('SIP_DELAYED')} SIP signals (published ${sip?.signals ?? 'n/a'}), ${count('LIVE_ALERTS')} live alerts, ${records.filter((r) => r.status === 'TRADED').length} traded, ${quotes} quote requests`);
  return {
    date: day,
    symbols: symbols.length,
    with_bars: bars.size,
    failed,
    universe_source: sip ? 'sip-events.json' : 'eligible universe (sip-events missing)',
    published_sip_signals: sip?.signals ?? null,
    live_alerts_extended_hours: extendedLive.length,
    halts_source: halts.status,
    records,
  };
}

// ---- report ---------------------------------------------------------------------------------

export function buildLedger(days, { status = 'FORWARD_PAPER_TRADING' } = {}) {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const book = (name, filter = () => true) => summarizeBook(sorted.map((d) => ({ date: d.date, trades: d.records.filter((r) => r.book === name && r.status === 'TRADED' && filter(r)) })));
  const books = {};
  for (const name of ['SIP_DELAYED', 'LIVE_ALERTS']) {
    books[name] = { all: book(name), gate_passed: book(name, (r) => r.gate === 'PASSED') };
  }
  const statusCounts = (name) => {
    const out = {};
    for (const r of sorted.flatMap((d) => d.records).filter((x) => x.book === name)) out[r.status] = (out[r.status] ?? 0) + 1;
    return out;
  };
  return {
    schema: 1,
    protocol: PROTOCOL,
    status,
    forward_start: FORWARD_START,
    updated_at: new Date().toISOString(),
    profitability_claim_allowed: false,
    account: ACCOUNT,
    rules: {
      sip_visible_minutes: SIP_VISIBLE_MS / 60_000, entry_window_minutes: ENTRY_WINDOW_MS / 60_000, horizon_minutes: HORIZON_MS / 60_000,
      chase: CHASE, target_r: 2, min_round_trip_pct: 0.5, quote_cap_per_day: QUOTE_CAP, min_sessions: MIN_SESSIONS, min_trades: MIN_TRADES,
      gate: { max_spread_pct: GATE.blockSpreadPct, min_minute_dollars: GATE.blockMinuteDollars, max_cost_r: GATE.blockCostR, halted: true },
    },
    sessions: sorted.length,
    first_session: sorted[0]?.date ?? null,
    last_session: sorted.at(-1)?.date ?? null,
    signal_status: { SIP_DELAYED: statusCounts('SIP_DELAYED'), LIVE_ALERTS: statusCounts('LIVE_ALERTS') },
    books,
    days: sorted.map((d) => ({
      date: d.date, with_bars: d.with_bars, symbols: d.symbols, failed: d.failed, halts_source: d.halts_source, universe_source: d.universe_source,
      published_sip_signals: d.published_sip_signals, live_alerts_extended_hours: d.live_alerts_extended_hours,
      signals: d.records.length, traded: d.records.filter((r) => r.status === 'TRADED').length,
      net_usd: round(d.records.filter((r) => r.status === 'TRADED').reduce((s, r) => s + r.net_usd, 0), 2),
    })),
    recent_trades: sorted.slice(-3).flatMap((d) => d.records.filter((r) => r.status === 'TRADED')).slice(-150),
  };
}

function tradingDays(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function main() {
  const replay = process.argv.includes('--replay');
  const out = arg('--out') ? new URL(arg('--out'), `file://${process.cwd()}/`) : OUT_DEFAULT;
  const rawPath = new URL(String(out).replace(/\.json$/, '.raw.json'));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const existing = existsSync(rawPath) ? JSON.parse(readFileSync(rawPath)) : { days: [] };
  const known = new Map(existing.days.map((d) => [d.date, d]));
  const from = arg('--from') ?? (replay ? null : FORWARD_START);
  const to = arg('--to') ?? today;
  if (!from) throw new Error('--replay needs --from');
  if (!replay && from < FORWARD_START) throw new Error(`forward ledger starts ${FORWARD_START}; use --replay for earlier sessions`);
  const wanted = tradingDays(from, to).slice(-Number(arg('--max-days') ?? 5));
  let changed = !existsSync(out);
  for (const day of wanted) {
    if (known.has(day) && !process.argv.includes('--refresh')) continue;
    if (Date.now() < session(day).close + SIP_VISIBLE_MS) { console.log(`${day}: session not complete`); continue; }
    const result = await runDay(day);
    if (!result) { console.log(`${day}: no bars (holiday or provider gap)`); continue; }
    known.set(day, result);
    changed = true;
    writeFileSync(rawPath, JSON.stringify({ schema: 1, protocol: PROTOCOL, days: [...known.values()] }) + '\n');
  }
  if (!changed) { console.log('no new session; ledger unchanged'); return; }
  const days = [...known.values()].filter((d) => replay || d.date >= FORWARD_START);
  const ledger = buildLedger(days, { status: replay ? 'REPLAY_NOT_FORWARD' : 'FORWARD_PAPER_TRADING' });
  ledger.relay_requests_this_run = requestCount;
  writeFileSync(out, JSON.stringify(ledger) + '\n');
  const brief = (b) => ({ trades: b.trades, net_usd: b.net_usd, mean_net_r: b.mean_net_r, ci: b.mean_net_r_ci95, gross_r: b.mean_gross_r, cost_r: b.mean_cost_r, hit: b.hit_rate, verdict: b.verdict });
  console.log(JSON.stringify({ sessions: ledger.sessions, requests: requestCount, status: ledger.signal_status,
    SIP_all: brief(ledger.books.SIP_DELAYED.all), SIP_gate: brief(ledger.books.SIP_DELAYED.gate_passed),
    LIVE_all: brief(ledger.books.LIVE_ALERTS.all), LIVE_gate: brief(ledger.books.LIVE_ALERTS.gate_passed) }, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
