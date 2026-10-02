// Independent recompute of every published outcome summary from its committed raw file.
//
// Written from the file formats only (no pipeline summarize/buildReport code is imported), so a
// bug in a pipeline's summary cannot hide itself. Checks, for each published file:
//   sip-outcomes.json    ← sip-events.json       counts, means, medians, win rates, plan R, split
//   paper-ledger.json    ← paper-ledger.raw.json books, trades, $ and R, hit rate, exits, statuses
//   forward-outcomes.json (self-contained)       day summaries ← events, totals ← days
//   outcome-relabel.json (self-contained)        primary-window summary ← events
// and raw-data integrity: duplicate signals, weekend/holiday days, signals outside the regular
// session, entries before the signal (look-ahead) or later than the entry window, exits after the
// horizon, P&L arithmetic.
//
// Usage: node research/recompute-outcomes.mjs   (exit code 1 on any mismatch)
import { readFileSync, existsSync } from 'node:fs';

const DATA = new URL('../data/', import.meta.url);
const load = (name) => (existsSync(new URL(name, DATA)) ? JSON.parse(readFileSync(new URL(name, DATA))) : null);

const NY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
function nyParts(ms) {
  const p = Object.fromEntries(NY.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute), weekday: p.weekday };
}
const EARLY = new Set(['2026-11-27', '2026-12-24']);
const HOLIDAYS = new Set(['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25']);
const isWeekend = (date) => ['Sat', 'Sun'].includes(nyParts(Date.parse(`${date}T16:00:00Z`)).weekday);
/** Minute of the New York day at which the regular session closes. */
const closeMinute = (date) => (EARLY.has(date) ? 13 * 60 : 16 * 60);

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const problems = [];
const results = [];
function same(label, published, recomputed, eps = 0.0015) {
  const ok = (published === null || published === undefined) ? (recomputed === null || recomputed === undefined)
    : typeof published === 'number' ? Number.isFinite(recomputed) && Math.abs(published - recomputed) <= eps : published === recomputed;
  results.push({ label, published, recomputed, ok });
  if (!ok) problems.push(`${label}: published ${published}, recomputed ${recomputed}`);
}
const flag = (msg) => problems.push(msg);

// ---- SIP study ------------------------------------------------------------------------------

function sipSummary(events, key) {
  const labels = events.map((e) => e[key]);
  const resolved = labels.filter((l) => l.s === 'R');
  const rets = resolved.map((l) => l.ret);
  const plans = resolved.filter((l) => l.plan === 'STOP' || l.plan === 'TARGET_2R' || l.plan === 'TIME');
  return {
    signals: labels.length, resolved: resolved.length, no_entry: labels.length - resolved.length,
    mean_return_pct: mean(rets), median_return_pct: median(rets),
    win_rate: resolved.length ? rets.filter((r) => r > 0).length / resolved.length : null,
    plan_traded: plans.length, plan_mean_r: mean(plans.map((l) => l.r)),
  };
}

function checkSip() {
  const raw = load('sip-events.json'), pub = load('sip-outcomes.json');
  if (!raw || !pub) return;
  const days = [...raw.days].sort((a, b) => a.date.localeCompare(b.date));
  const seen = new Set();
  let afterClose = 0, dup = 0;
  for (const d of days) {
    if (isWeekend(d.date) || HOLIDAYS.has(d.date)) flag(`sip-events: ${d.date} is not a session`);
    if (d.failed > 0) flag(`sip-events: ${d.date} kept with ${d.failed} failed symbols`);
    for (const e of d.events) {
      const k = `${e.symbol}|${e.at}`;
      if (seen.has(k)) dup++;
      seen.add(k);
      const p = nyParts(Date.parse(e.at) - 60_000); // the signal bar
      if (p.date !== d.date || p.minute < 570 || p.minute >= closeMinute(d.date)) afterClose++;
    }
  }
  if (dup) flag(`sip-events: ${dup} duplicate signals`);
  if (afterClose) flag(`sip-events: ${afterClose} signals from bars outside the regular session`);
  same('sip sessions', pub.sessions, days.length, 0);
  const cut = Math.floor(days.length * 2 / 3);
  same('sip holdout_from', pub.split.holdout_from, days[cut]?.date ?? null);
  const parts = { totals: days, development: days.slice(0, cut), holdout: days.slice(cut) };
  for (const [part, list] of Object.entries(parts)) {
    const events = list.flatMap((d) => d.events);
    for (const [key, name] of [['now', 'at_detection'], ['late', 'delayed']]) {
      const s = sipSummary(events, key);
      const counts = new Set(['signals', 'resolved', 'no_entry', 'plan_traded']);
      for (const f of Object.keys(s)) same(`sip ${part}.${name}.${f}`, pub[part][name][f], s[f], counts.has(f) ? 0 : 0.0006);
    }
  }
}

// ---- paper ledger ---------------------------------------------------------------------------

function checkPaper() {
  const raw = load('paper-ledger.raw.json'), pub = load('paper-ledger.json');
  if (!raw || !pub) return;
  const days = raw.days.filter((d) => d.date >= pub.forward_start).sort((a, b) => a.date.localeCompare(b.date));
  same('paper sessions', pub.sessions, days.length, 0);
  for (const d of days) {
    const keys = new Set();
    for (const r of d.records) {
      const k = `${r.book}|${r.symbol}|${r.detected_at}`;
      if (keys.has(k)) flag(`paper ${d.date}: duplicate record ${k}`);
      keys.add(k);
      if (r.status !== 'TRADED') continue;
      const det = Date.parse(r.detected_at), entry = Date.parse(r.entry_at), exit = Date.parse(r.exit_at);
      const visible = r.book === 'SIP_DELAYED' ? det + 17 * 60_000 : det;
      if (entry < visible) flag(`paper ${r.symbol} ${r.detected_at}: entry ${r.entry_at} before the signal was visible (look-ahead)`);
      if (entry >= visible + 2 * 60_000) flag(`paper ${r.symbol} ${r.detected_at}: entry later than the 2-minute window`);
      if (exit < entry || exit > entry + 31 * 60_000) flag(`paper ${r.symbol} ${r.detected_at}: exit ${r.exit_at} outside [entry, entry + 30 min]`);
      const pe = nyParts(entry), px = nyParts(exit - 1);
      if (pe.date !== d.date || pe.minute < 570 || px.minute >= closeMinute(d.date)) flag(`paper ${r.symbol}: trade outside the regular session`);
      const risk = r.shares * (r.entry - r.stop);
      if (Math.abs(r.shares * (r.exit - r.entry) - r.gross_usd) > 0.01 + r.shares * 1e-4) flag(`paper ${r.symbol}: gross ${r.gross_usd} ≠ shares × move`);
      if (Math.abs(r.gross_usd - r.cost_usd - r.net_usd) > 0.011) flag(`paper ${r.symbol}: net ≠ gross − cost`);
      // Rows written before 2026-09-29 store the stop rounded to 4 decimals; with sub-cent stops
      // that rounding alone moves R, so allow half a unit of the 4th decimal per share of risk.
      const riskSlack = Math.abs(r.net_r) * r.shares * 0.00005 + 0.02;
      if (Math.abs(r.net_usd - r.net_r * risk) > riskSlack) flag(`paper ${r.symbol}: net R ${r.net_r} ≠ ${r.net_usd / risk}`);
      if (r.exit_kind === 'STOP' && Math.abs(r.exit - r.stop) > 1e-4) flag(`paper ${r.symbol}: STOP exit not at the stop`);
      if (r.exit_kind === 'STOP_GAP' && r.exit > r.stop) flag(`paper ${r.symbol}: STOP_GAP exit above the stop`);
      if (r.exit_kind === 'TARGET_2R' && Math.abs(r.exit - r.target) > 1e-4) flag(`paper ${r.symbol}: target exit not at the target`);
      if (r.notional > 10_000.01) flag(`paper ${r.symbol}: notional above the reference capital`);
    }
  }
  for (const name of ['SIP_DELAYED', 'LIVE_ALERTS']) {
    const bookDays = days.filter((d) => name !== 'LIVE_ALERTS' || (d.live_source ?? 'FORWARD_OUTCOMES') === 'FORWARD_OUTCOMES');
    for (const [part, keep] of [['all', () => true], ['gate_passed', (r) => r.gate === 'PASSED']]) {
      const t = bookDays.flatMap((d) => d.records.filter((r) => r.book === name && r.status === 'TRADED' && keep(r)));
      const b = pub.books[name][part];
      const tag = `paper ${name}.${part}`;
      same(`${tag}.sessions`, b.sessions, bookDays.length, 0);
      same(`${tag}.trades`, b.trades, t.length, 0);
      same(`${tag}.net_usd`, b.net_usd, sum(t.map((x) => x.net_usd)), 0.011);
      same(`${tag}.mean_net_r`, b.mean_net_r, mean(t.map((x) => x.net_r)), 0.0002);
      same(`${tag}.hit_rate`, b.hit_rate, t.length ? t.filter((x) => x.net_usd > 0).length / t.length : null, 0.0002);
      for (const k of Object.keys(b.exits ?? {})) same(`${tag}.exits.${k}`, b.exits[k], t.filter((x) => x.exit_kind === k).length, 0);
    }
    const counts = {};
    for (const r of days.flatMap((d) => d.records).filter((x) => x.book === name)) counts[r.status] = (counts[r.status] ?? 0) + 1;
    same(`paper ${name}.signal_status`, JSON.stringify(Object.entries(pub.signal_status[name]).sort()), JSON.stringify(Object.entries(counts).sort()));
  }
}

// ---- forward outcomes -----------------------------------------------------------------------

function checkForward() {
  const pub = load('forward-outcomes.json');
  if (!pub) return;
  const seen = new Set();
  const observed = [];
  for (const d of pub.days) {
    const s = d.summary;
    if (isWeekend(s.date) || HOLIDAYS.has(s.date)) flag(`forward: ${s.date} is not a session`);
    if (s.evaluated_at && Date.parse(s.evaluated_at) < Date.parse(`${s.date}T20:00:00Z`)) flag(`forward: ${s.date} evaluated before its close`);
    for (const e of d.events) {
      const k = `${e.symbol}|${e.detected_at}`;
      if (seen.has(k)) flag(`forward: duplicate alert ${k}`);
      seen.add(k);
      if (nyParts(Date.parse(e.detected_at)).date !== s.date) flag(`forward: ${k} filed under ${s.date}`);
      if (e.status === 'RESOLVED' && Date.parse(e.entry_at) < Date.parse(e.detected_at)) flag(`forward: ${k} entry before the alert (look-ahead)`);
    }
    const regular = d.events.filter((e) => (e.session ?? 'REGULAR') === 'REGULAR');
    const resolved = regular.filter((e) => e.status === 'RESOLVED');
    same(`forward ${s.date}.alerts`, s.alerts, d.events.length, 0);
    same(`forward ${s.date}.resolved`, s.resolved, resolved.length, 0);
    same(`forward ${s.date}.mean`, s.mean_return_after_cost_pct, mean(resolved.map((e) => e.return_after_cost_pct)), 1e-9);
    if (s.recorded ?? s.health.samples > 0) observed.push(d);
  }
  const res = observed.flatMap((d) => d.events).filter((e) => (e.session ?? 'REGULAR') === 'REGULAR' && e.status === 'RESOLVED');
  same('forward totals.days', pub.totals.days, observed.length, 0);
  same('forward totals.resolved', pub.totals.resolved, res.length, 0);
  same('forward totals.mean', pub.totals.mean_return_after_cost_pct, mean(res.map((e) => e.return_after_cost_pct)), 1e-9);
}

// ---- outcome relabel ------------------------------------------------------------------------

function checkRelabel() {
  const pub = load('outcome-relabel.json');
  if (!pub) return;
  const s = pub.corrected[pub.primary_entry_window];
  const resolved = pub.events.filter((e) => e.status === 'RESOLVED');
  same('relabel signals', s.signals, pub.events.length, 0);
  same('relabel resolved', s.resolved, resolved.length, 0);
  same('relabel mean', s.mean_return_after_cost_pct, mean(resolved.map((e) => e.return_after_cost_pct)), 1e-9);
  const traded = resolved.map((e) => e.plan).filter((p) => ['STOP', 'TARGET_2R', 'TIME'].includes(p.status));
  same('relabel plan.mean_r', s.plan.mean_r, mean(traded.map((p) => p.r)), 1e-9);
  if ('mean_r_after_cost' in s.plan) same('relabel plan.mean_r_after_cost', s.plan.mean_r_after_cost, mean(traded.map((p) => p.r_after_cost)), 1e-9);
  for (const e of resolved) if (Date.parse(e.entry_at) < Date.parse(e.detected_at)) flag(`relabel ${e.symbol} ${e.detected_at}: entry before decision`);
}

export function recompute() {
  problems.length = 0;
  results.length = 0;
  checkSip();
  checkPaper();
  checkForward();
  checkRelabel();
  return { checked: results.length, problems: [...problems], results: [...results] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = recompute();
  console.log(`${r.checked} published numbers recomputed from raw; ${r.problems.length} problem(s)`);
  for (const p of r.problems) console.log(`  ✗ ${p}`);
  process.exitCode = r.problems.length ? 1 : 0;
}
