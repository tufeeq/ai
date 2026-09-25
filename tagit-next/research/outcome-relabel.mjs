// Outcome relabel for the frozen discovery-1 study (96 symbols, 10 sessions, SIP bars).
//
// Protocol, fixed before results were computed (2026-09-25):
//  1. Detection is unchanged: the same loop, session filter, 90-bar lookback and cooldown as
//     quote-service/scripts/evaluate-discovery.mjs, with the byte-exact detector. It must
//     reproduce every frozen event (symbol + detected_at) or the run fails.
//  2. The frozen label is recomputed as-is (30 contiguous future minutes, next-minute open)
//     and must reproduce the frozen 84 / 238 split and mean.
//  3. Corrected label ("time-carried"): a minute without a bar had no trade, so the last traded
//     price carries forward; it is not missing data.
//       entry  = open of the first bar starting within ENTRY_WINDOW after the decision time;
//                none → NO_ENTRY (counted, excluded from return statistics, never coded as zero).
//       horizon = min(decision + 30 min, 20:00 UTC session end used by the detector filter).
//       exit   = close of the last bar starting before the horizon (last trade before exit time).
//       excursions from bar highs/lows in [entry, horizon); cost 0.5 pp round trip, as before.
//  4. Plan label: the detector's own stop; target = 2R from the entry; a bar touching both the
//     stop and the target counts as a stop (conservative); otherwise the time exit above.
//     Entries above trigger × 1.01 are CHASED and entries at or below the stop INVALIDATED —
//     the live app would not offer those plans.
//  5. Sensitivity: entry windows of 1, 2 and 5 minutes are all reported; 2 minutes is primary.
// Still development evidence: 10 sessions, pre-selected symbols, survivorship bias, no quotes/fills.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { analyzeBars, RULES } from './discovery-detector.mjs';

const STUDY_DIR = new URL('./study/', import.meta.url);
const COST_PP = 0.5;
const HORIZON_MS = 30 * 60_000;
const SESSION_END_MIN = 1200; // 20:00 UTC, the detector's own session filter (EDT sessions only)
const WINDOWS = [60_000, 120_000, 300_000];
const PRIMARY_WINDOW = 120_000;

const minuteOfDay = (t) => { const d = new Date(t); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const sessionEnd = (t) => { const d = new Date(t); d.setUTCHours(0, SESSION_END_MIN, 0, 0); return d.getTime(); };

function loadSessions() {
  const sessions = [];
  for (const name of readdirSync(STUDY_DIR).filter((n) => /^2026.*json.gz$/.test(n)).sort()) {
    const raw = JSON.parse(gunzipSync(readFileSync(new URL(name, STUDY_DIR))));
    for (const [symbol, input] of Object.entries(raw.bars ?? {})) {
      const bars = input
        .map((b) => ({ t: b.timestamp, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume, n: b.trade_count, vw: b.vwap }))
        .filter((b) => { const m = minuteOfDay(b.t); return m >= 810 && m < SESSION_END_MIN; })
        .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
      sessions.push({ date: name.slice(0, 10), symbol, bars });
    }
  }
  return sessions;
}

/** Frozen label, recomputed exactly as evaluate-discovery.mjs defines it. */
function frozenLabel(future, now) {
  const continuous = future.length === 30 && future.every((b, j) => Date.parse(b.t) === now + j * 60_000);
  const entry = future[0] && Date.parse(future[0].t) === now ? future[0].o : null;
  if (!(continuous && entry > 0)) return { scorable: false, entry };
  return { scorable: true, entry, end_return_after_assumed_cost_pct: (future.at(-1).c / entry - 1) * 100 - COST_PP };
}

/** Corrected time-carried label for one entry window. */
function carriedLabel(bars, i, now, windowMs, signal) {
  const horizon = Math.min(now + HORIZON_MS, sessionEnd(now));
  const after = bars.slice(i + 1);
  const entryBar = after.find((b) => Date.parse(b.t) >= now && Date.parse(b.t) < now + windowMs);
  if (!entryBar || !(entryBar.o > 0)) return { status: 'NO_ENTRY' };
  const path = after.filter((b) => Date.parse(b.t) >= Date.parse(entryBar.t) && Date.parse(b.t) < horizon);
  const entry = entryBar.o;
  const exitBar = path.at(-1);
  const label = {
    status: 'RESOLVED',
    entry,
    entry_at: entryBar.t,
    exit: exitBar.c,
    exit_at: exitBar.t,
    exit_kind: horizon < now + HORIZON_MS ? 'SESSION_END' : 'TIME_30M',
    minutes_with_trades: path.length,
    max_up_pct: (Math.max(...path.map((b) => b.h)) / entry - 1) * 100,
    max_down_pct: (Math.min(...path.map((b) => b.l)) / entry - 1) * 100,
    return_after_cost_pct: (exitBar.c / entry - 1) * 100 - COST_PP,
  };
  label.plan = planLabel(path, entry, signal, label);
  return label;
}

function planLabel(path, entry, signal, timeLabel) {
  if (!(signal?.stop > 0) || !(signal?.trigger > 0) || !signal.plan_valid) return { status: 'NO_PLAN' };
  if (entry > signal.trigger * 1.01) return { status: 'CHASED' };
  if (entry <= signal.stop) return { status: 'INVALIDATED' };
  const risk = entry - signal.stop;
  const target = entry + 2 * risk;
  for (const b of path) {
    if (b.l <= signal.stop) return { status: 'STOP', r: (signal.stop - entry) / risk, return_after_cost_pct: (signal.stop / entry - 1) * 100 - COST_PP };
    if (b.h >= target) return { status: 'TARGET_2R', r: 2, return_after_cost_pct: (target / entry - 1) * 100 - COST_PP };
  }
  return { status: 'TIME', r: (timeLabel.exit - entry) / risk, return_after_cost_pct: timeLabel.return_after_cost_pct };
}

function detect(sessions) {
  const events = [];
  for (const { date, symbol, bars } of sessions) {
    let last = -Infinity;
    for (let i = 0; i < bars.length; i++) {
      const now = Date.parse(bars[i].t) + 60_000;
      const signal = analyzeBars(bars.slice(Math.max(0, i - 89), i + 1), now);
      if (!signal?.expansion || now - last < RULES.cooldown) continue;
      last = now;
      const future = bars.slice(i + 1).filter((b) => Date.parse(b.t) < now + HORIZON_MS);
      events.push({
        date, symbol, detected_at: new Date(now).toISOString(), signal_price: bars[i].c,
        frozen: frozenLabel(future, now),
        carried: Object.fromEntries(WINDOWS.map((w) => [w / 60_000 + 'm', carriedLabel(bars, i, now, w, signal)])),
      });
    }
  }
  return events;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

function summarize(labels) {
  const resolved = labels.filter((l) => l.status === 'RESOLVED');
  const returns = resolved.map((l) => l.return_after_cost_pct);
  const plans = resolved.map((l) => l.plan);
  const traded = plans.filter((p) => ['STOP', 'TARGET_2R', 'TIME'].includes(p.status));
  const count = (s) => plans.filter((p) => p.status === s).length;
  return {
    signals: labels.length,
    resolved: resolved.length,
    no_entry: labels.filter((l) => l.status === 'NO_ENTRY').length,
    unknown: labels.length - resolved.length - labels.filter((l) => l.status === 'NO_ENTRY').length,
    session_end_exits: resolved.filter((l) => l.exit_kind === 'SESSION_END').length,
    mean_return_after_cost_pct: mean(returns),
    median_return_after_cost_pct: median(returns),
    positive_after_cost: returns.filter((r) => r > 0).length,
    reached_5pct: resolved.filter((l) => l.max_up_pct >= 5).length,
    reached_10pct: resolved.filter((l) => l.max_up_pct >= 10).length,
    mean_max_down_pct: mean(resolved.map((l) => l.max_down_pct)),
    plan: {
      traded: traded.length,
      target_2r: count('TARGET_2R'),
      stop: count('STOP'),
      time: count('TIME'),
      chased: count('CHASED'),
      invalidated: count('INVALIDATED'),
      no_plan: count('NO_PLAN'),
      mean_r: mean(traded.map((p) => p.r)),
      mean_return_after_cost_pct: mean(traded.map((p) => p.return_after_cost_pct)),
    },
  };
}

export function run() {
  const sessions = loadSessions();
  const events = detect(sessions);
  const frozenAudit = JSON.parse(readFileSync(new URL('./study/discovery-audit.json', import.meta.url)));
  const key = (e) => `${e.symbol}|${e.detected_at}`;
  const same = events.length === frozenAudit.events.length && events.every((e, i) => key(e) === key(frozenAudit.events[i]));
  if (!same) throw new Error('DETECTION_DOES_NOT_REPRODUCE_FROZEN_EVENTS');
  const frozenScored = events.filter((e) => e.frozen.scorable);
  const frozenMean = mean(frozenScored.map((e) => e.frozen.end_return_after_assumed_cost_pct));
  if (frozenScored.length !== frozenAudit.scorable || Math.abs(frozenMean - frozenAudit.mean_30m_return_after_assumed_cost_pct) > 1e-9) {
    throw new Error('FROZEN_LABEL_DOES_NOT_REPRODUCE');
  }
  const byWindow = Object.fromEntries(WINDOWS.map((w) => {
    const k = w / 60_000 + 'm';
    return [k, summarize(events.map((e) => e.carried[k]))];
  }));
  const primary = PRIMARY_WINDOW / 60_000 + 'm';
  // How the corrected label treats the 238 signals the frozen label dropped.
  const dropped = events.filter((e) => !e.frozen.scorable).map((e) => e.carried[primary]);
  return {
    schema: 1,
    protocol: 'outcome-relabel-1',
    as_of: '2026-09-25',
    status: 'DEVELOPMENT_DIAGNOSTIC_ONLY',
    profitability_claim_allowed: false,
    scope: frozenAudit.scope,
    reproduced: { events: events.length, frozen_scorable: frozenScored.length, frozen_mean_return_after_cost_pct: frozenMean },
    primary_entry_window: primary,
    corrected: byWindow,
    previously_dropped: { count: dropped.length, ...summarize(dropped) },
    limitations: [
      '10 sessions and 96 pre-selected symbols: survivorship and selection bias remain',
      'Bar opens and closes, not quotes or fills; spread and queue position unknown',
      '0.5 percentage point round-trip cost is assumed, not measured',
      'Same-bar stop and target are counted as a stop',
      'Development evidence only; no holdout was used',
    ],
    events: events.map((e) => ({
      date: e.date, symbol: e.symbol, detected_at: e.detected_at, signal_price: e.signal_price,
      frozen_scorable: e.frozen.scorable, ...e.carried[primary],
    })),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = run();
  const out = process.argv[2] ?? new URL('../data/outcome-relabel.json', import.meta.url);
  writeFileSync(out, JSON.stringify(report, null, 1) + '\n');
  console.log(JSON.stringify({ ...report, events: undefined }, null, 2));
}
