// Live data audit (read-only). Runs on a GitHub runner, which can reach the Render service,
// Nasdaq.com and the Alpaca relay (this sandbox cannot). Measures:
//   A. the deployed service: scanner coverage/freshness, overlay counts, /api/live if present;
//   B. Nasdaq.com unofficial endpoints: which answer, batch sizes, throughput before throttling,
//      and how many universe symbols they cover;
//   C. correctness: Nasdaq.com last price / previous close and IEX closes versus consolidated
//      (SIP, split-adjusted) daily bars from the relay;
//   D. freshness upper bounds from a recent full session: per minute, how many universe symbols
//      traded on IEX versus on the consolidated tape (SIP minute bars);
//   E. during a session: Nasdaq.com and IEX last prices versus the SIP tape 17 minutes later.
// Output: JSON (AUDIT_OUT, default live-audit.json) plus a readable log.
//
// Usage: node live_audit.mjs [--parts A,B,C,D] [--session YYYY-MM-DD]
import { writeFileSync } from 'node:fs';
import { getJson as relayJson, eligibleSymbols, session } from './sip_study.mjs';
import { parseWatchlist, WATCHLIST_URL, HEADERS } from './nasdaq.mjs';

const SERVICE = process.env.TAGIT_SERVICE || 'https://tagit-next-quotes.onrender.com';
const OUT = process.env.AUDIT_OUT || 'live-audit.json';
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const PARTS = new Set((arg('--parts') || 'A,B,E').split(','));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { generated_at: new Date().toISOString(), service: SERVICE };
const log = (...a) => console.log(...a);
const q = (xs, p) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const round = (x, d = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

async function timed(url, opts = {}) {
  const t = Date.now();
  try {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeout ?? 20_000) });
    const text = await r.text();
    let body = null; try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, ms: Date.now() - t, body, text: body ? null : text.slice(0, 200) };
  } catch (e) {
    return { status: 0, ms: Date.now() - t, error: e.name + ':' + e.message.slice(0, 100) };
  }
}

const universe = eligibleSymbols().sort();
report.universe = universe.length;
log(`Universe (reference cap < $100M): ${universe.length}`);

// ---- A. deployed service ----------------------------------------------------------------
async function partA() {
  const out = {};
  const health = await timed(`${SERVICE}/api/health`, { timeout: 90_000 });
  out.health = { status: health.status, ms: health.ms, body: health.body };
  log('A health', health.status, health.ms + 'ms', JSON.stringify(health.body?.complements ?? health.body)?.slice(0, 1500));
  const scan = await timed(`${SERVICE}/api/scanner`, { timeout: 120_000 });
  const b = scan.body;
  if (scan.status === 200 && b?.rows) {
    const now = Date.parse(b.server_time);
    const ages = b.rows.map((r) => (r.price_at ? now - Date.parse(r.price_at) : NaN));
    const overlay = b.rows.filter((r) => r.consolidated);
    const overlayAges = overlay.map((r) => now - Date.parse(r.consolidated.trade_minute_at));
    out.scanner = {
      status: scan.status, ms: scan.ms, server_time: b.server_time, feed: b.feed, coverage: b.coverage,
      rows: b.rows.length, fresh_15s: ages.filter((a) => a >= 0 && a <= 15_000).length,
      fresh_60s: ages.filter((a) => a >= 0 && a <= 60_000).length,
      age_p50_s: round(q(ages, 0.5) / 1000, 0), age_p90_s: round(q(ages, 0.9) / 1000, 0),
      signals_ready: b.rows.filter((r) => r.signal?.ready).length,
      change_basis: Object.fromEntries(['SIP_PREVIOUS_CLOSE', 'SPLIT_ADJUSTED_PREVIOUS_CLOSE', 'UNVERIFIED'].map((k) => [k, b.rows.filter((r) => r.change_basis === k).length])),
      consolidated_overlay: overlay.length, overlay_age_p50_s: round(q(overlayAges, 0.5) / 1000, 0),
      complements: b.complements ?? null,
    };
  } else out.scanner = { status: scan.status, ms: scan.ms, error: scan.error ?? scan.text ?? b?.status ?? null };
  log('A scanner', JSON.stringify(out.scanner).slice(0, 1200));
  const live = await timed(`${SERVICE}/api/live`, { timeout: 60_000 });
  out.live = { status: live.status, ms: live.ms, summary: live.body?.coverage ?? live.body?.status ?? live.text ?? live.error };
  log('A /api/live', live.status, JSON.stringify(out.live.summary)?.slice(0, 800));
  report.service_audit = out;
}

// ---- B. Nasdaq.com endpoints ----------------------------------------------------------------
// Run 1 (2026-09-27) established: the watchlist endpoint answers at most 20 symbols per request
// (100+ symbols → 404), the single-symbol info endpoint works, and 25 sequential requests/min for
// 4 minutes drew no throttling. This part now measures a full pass at batch 20 and the parallelism
// the endpoint tolerates.
const BATCH = 20;
async function pass(concurrency, seconds) {
  const statuses = [], seen = new Map(), t0 = Date.now();
  let next = 0, passes = 0, stop = false;
  const groups = [];
  for (let i = 0; i < universe.length; i += BATCH) groups.push(universe.slice(i, i + BATCH));
  async function worker() {
    while (!stop && Date.now() - t0 < seconds * 1000) {
      const g = groups[next++ % groups.length];
      if (next % groups.length === 0) passes++;
      const r = await timed(WATCHLIST_URL(g), { headers: HEADERS, timeout: 30_000 });
      statuses.push(r.status);
      if (r.status !== 200) { stop = true; break; }
      for (const row of parseWatchlist(r.body, Date.now())) seen.set(row.symbol, row);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const secs = (Date.now() - t0) / 1000;
  return { concurrency, seconds: round(secs, 1), requests: statuses.length, statuses: tally(statuses), requests_per_min: round(statuses.length / (secs / 60), 1),
    full_pass_seconds: round(groups.length / (statuses.length / secs), 1), priced: seen.size, of: universe.length, seen };
}
async function partB() {
  const out = {};
  const first = await pass(1, 60);
  report._nasdaq = first.seen;
  const stamps = [...first.seen.values()];
  out.stamps = { with_minute_time: stamps.filter((x) => x.trade_minute_at).length, date_only: stamps.filter((x) => !x.trade_minute_at).length,
    sample: stamps.slice(0, 3).map((x) => ({ symbol: x.symbol, stamp: x.stamp_text, datetime: x.stamp_datetime })) };
  delete first.seen;
  out.sequential = first;
  log('B sequential', JSON.stringify(first), JSON.stringify(out.stamps));
  for (const c of [2, 3]) {
    await sleep(10_000);
    const r = await pass(c, 90);
    delete r.seen;
    out['parallel_' + c] = r;
    log('B parallel', JSON.stringify(r));
    if (Object.keys(r.statuses).some((k) => k !== '200')) break;
  }
  report.nasdaq = out;
}
const tally = (xs) => xs.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});

// ---- C. correctness versus SIP daily bars -------------------------------------------------
function lastSessions(n) {
  const out = []; let d = new Date();
  while (out.length < n) {
    d = new Date(d.getTime() - 86_400_000);
    if (![0, 6].includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
async function dailyBars(feed, adjustment = 'split') {
  const bars = {};
  const start = new Date(Date.now() - 12 * 86_400_000).toISOString().replace(/\.\d+Z$/, 'Z');
  const end = new Date(Date.now() - 17 * 60_000).toISOString().replace(/\.\d+Z$/, 'Z');
  for (let i = 0; i < universe.length; i += 100) {
    const p = new URLSearchParams({ resource: 'bars', symbols: universe.slice(i, i + 100).join(','), timeframe: '1Day', start, end, feed, adjustment, limit: '10000' });
    let token = null;
    do {
      if (token) p.set('page_token', token);
      const body = await relayJson(`${SERVICE}/api/lab/provider?${p}`);
      for (const [s, list] of Object.entries(body?.bars ?? {})) (bars[s] ??= []).push(...list);
      token = body?.next_page_token;
    } while (token);
  }
  return bars;
}
const nyDay = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(t));
async function partC() {
  const out = {};
  const sip = await dailyBars('sip'), iex = await dailyBars('iex');
  // Last complete session and the one before, per the SIP tape.
  const days = [...new Set(Object.values(sip).flat().map((b) => nyDay(b.t)))].sort();
  const last = days.at(-1), prev = days.at(-2);
  out.sessions = { last, prev };
  const closeOn = (bars, day) => bars?.find((b) => nyDay(b.t) === day)?.c ?? null;
  // C1 IEX close versus SIP close (what an IEX-based previous close gets wrong).
  const diffs = [];
  let iexMissing = 0, sipHave = 0;
  for (const s of universe) {
    const sc = closeOn(sip[s], prev); if (!sc) continue; sipHave++;
    const ic = closeOn(iex[s], prev);
    if (!ic) { iexMissing++; continue; }
    diffs.push(Math.abs(ic / sc - 1) * 100);
  }
  out.iex_vs_sip_close = { session: prev, sip_closes: sipHave, iex_missing: iexMissing, compared: diffs.length,
    abs_diff_pct_p50: round(q(diffs, 0.5), 3), p90: round(q(diffs, 0.9), 3), over_1pct: diffs.filter((d) => d > 1).length, over_5pct: diffs.filter((d) => d > 5).length };
  log('C IEX vs SIP previous close', JSON.stringify(out.iex_vs_sip_close));
  // C2 Nasdaq.com last price and change versus the SIP close of the last session.
  const nasdaq = report._nasdaq;
  if (nasdaq?.size) {
    const price = [], change = [], prevClose = [];
    for (const [s, n] of nasdaq) {
      const lc = closeOn(sip[s], last), pc = closeOn(sip[s], prev);
      if (lc && n.price) price.push(Math.abs(n.price / lc - 1) * 100);
      if (lc && pc && Number.isFinite(n.change_pct)) change.push(Math.abs(n.change_pct - (lc / pc - 1) * 100));
      if (pc && n.previous_close) prevClose.push(Math.abs(n.previous_close / pc - 1) * 100);
    }
    const stat = (xs) => ({ n: xs.length, p50: round(q(xs, 0.5), 3), p90: round(q(xs, 0.9), 3), over_0_5: xs.filter((d) => d > 0.5).length, over_2: xs.filter((d) => d > 2).length });
    out.nasdaq_vs_sip = { session: last, last_price_abs_diff_pct: stat(price), change_abs_diff_pp: stat(change), previous_close_abs_diff_pct: stat(prevClose),
      note: 'Outside the session, Nasdaq.com shows the regular close (or an after-hours last); compared with the SIP daily close.' };
    log('C Nasdaq vs SIP', JSON.stringify(out.nasdaq_vs_sip));
  }
  report.correctness = out;
  report._sessions = out.sessions;
}

// ---- D. freshness upper bounds from one full session -----------------------------------
async function minuteBars(feed, day) {
  const { open, close } = session(day);
  const bars = {};
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
  for (let i = 0; i < universe.length; i += 100) {
    const p = new URLSearchParams({ resource: 'bars', symbols: universe.slice(i, i + 100).join(','), timeframe: '1Min', start: iso(open), end: iso(close), feed, adjustment: 'raw', limit: '10000', sort: 'asc' });
    let token = null;
    do {
      if (token) p.set('page_token', token);
      const body = await relayJson(`${SERVICE}/api/lab/provider?${p}`);
      for (const [s, list] of Object.entries(body?.bars ?? {})) for (const b of list) (bars[s] ??= new Set()).add(Date.parse(b.t));
      token = body?.next_page_token;
    } while (token);
  }
  return bars;
}
async function partD() {
  const day = arg('--session') || report._sessions?.last || lastSessions(1)[0];
  const { open } = session(day);
  const sip = await minuteBars('sip', day), iex = await minuteBars('iex', day);
  // For every minute m, a symbol is "current" for a window W if it printed a bar within the last W minutes.
  const windows = [1, 2, 5, 15];
  const per = { sip: Object.fromEntries(windows.map((w) => [w, []])), iex: Object.fromEntries(windows.map((w) => [w, []])) };
  for (let m = 15; m < 390; m++) {
    const t = open + m * 60_000;
    for (const [feed, bars] of [['sip', sip], ['iex', iex]]) {
      for (const w of windows) {
        let n = 0;
        for (const set of Object.values(bars)) {
          for (let k = 1; k <= w; k++) if (set.has(t - k * 60_000)) { n++; break; }
        }
        per[feed][w].push(n);
      }
    }
  }
  const sum = (xs) => ({ median: q(xs, 0.5), p10: q(xs, 0.1), p90: q(xs, 0.9) });
  report.freshness = {
    session: day, universe: universe.length,
    symbols_with_any_bar: { sip: Object.keys(sip).length, iex: Object.keys(iex).length },
    traded_in_last_w_minutes: Object.fromEntries(['sip', 'iex'].map((f) => [f, Object.fromEntries(windows.map((w) => [`${w}m`, sum(per[f][w])]))])),
    note: 'Counts over minutes 09:45–16:00 ET. SIP = every exchange/TRF print; IEX = one exchange. An IEX price is only fresh when IEX itself traded.',
  };
  log('D freshness', JSON.stringify(report.freshness));
}

// ---- E. in-session truth check ----------------------------------------------------------------
// At time T fetch Nasdaq.com consolidated quotes for the universe; 17 minutes later fetch SIP and
// IEX minute bars up to T through the relay. The last SIP bar at or before T is the truth. Measures
// how often each live source shows the true last price and how far behind its trade minute is.
async function partE() {
  const t = Date.now();
  const sess = session(nyDay(t));
  if (!(t > sess.open + 5 * 60_000 && t < sess.close)) { report.in_session = { skipped: 'market not in regular session', at: new Date(t).toISOString() }; log('E skipped (not in session)'); return; }
  const snap = await pass(1, 150);
  const quotes = snap.seen; delete snap.seen;
  const T = Date.now();
  log(`E fetched ${quotes.size} consolidated quotes; waiting 17 minutes for SIP bars`);
  await sleep(Math.max(0, T + 17 * 60_000 - Date.now()));
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
  const last = { sip: {}, iex: {} };
  for (const feed of ['sip', 'iex']) {
    for (let i = 0; i < universe.length; i += 100) {
      const p = new URLSearchParams({ resource: 'bars', symbols: universe.slice(i, i + 100).join(','), timeframe: '1Min', start: iso(sess.open - 4 * 3600_000), end: iso(T), feed, adjustment: 'raw', limit: '10000', sort: 'asc' });
      let token = null;
      do {
        if (token) p.set('page_token', token);
        const body = await relayJson(`${SERVICE}/api/lab/provider?${p}`);
        for (const [s, bars] of Object.entries(body?.bars ?? {})) for (const b of bars) if (Date.parse(b.t) <= T - 60_000 && (!last[feed][s] || Date.parse(b.t) > Date.parse(last[feed][s].t))) last[feed][s] = b;
        token = body?.next_page_token;
      } while (token);
    }
  }
  const res = { at: new Date(T).toISOString(), consolidated_quotes: quotes.size, compared: 0, nasdaq_price_matches_sip_last: 0, nasdaq_minute_matches_sip_last: 0, nasdaq_minute_behind_min: [],
    iex_price_matches_sip_last: 0, iex_minute_matches_sip_last: 0, iex_minute_behind_min: [], iex_missing: 0, sip_traded_last_2m: 0 };
  for (const s of universe) {
    const truth = last.sip[s];
    if (!truth) continue;
    const n = quotes.get(s), x = last.iex[s];
    if (Date.parse(truth.t) >= T - 3 * 60_000) res.sip_traded_last_2m++;
    if (n) {
      res.compared++;
      if (Math.abs(n.price / truth.c - 1) <= 0.005) res.nasdaq_price_matches_sip_last++;
      if (n.trade_minute_at) {
        const lag = (Date.parse(truth.t) - Date.parse(n.trade_minute_at)) / 60_000;
        if (lag === 0) res.nasdaq_minute_matches_sip_last++;
        res.nasdaq_minute_behind_min.push(lag);
      }
    }
    if (!x) { res.iex_missing++; continue; }
    if (Math.abs(x.c / truth.c - 1) <= 0.005) res.iex_price_matches_sip_last++;
    const lag = (Date.parse(truth.t) - Date.parse(x.t)) / 60_000;
    if (lag === 0) res.iex_minute_matches_sip_last++;
    res.iex_minute_behind_min.push(lag);
  }
  const d = (xs) => ({ p50: q(xs, 0.5), p90: q(xs, 0.9), n: xs.length });
  res.nasdaq_minute_behind_min = d(res.nasdaq_minute_behind_min);
  res.iex_minute_behind_min = d(res.iex_minute_behind_min);
  res.fetch = snap;
  report.in_session = res;
  log('E in-session', JSON.stringify(res));
}

try {
  if (PARTS.has('A')) await partA().catch((e) => { report.service_audit = { error: e.message }; log('A failed', e.message); });
  if (PARTS.has('B')) await partB().catch((e) => { report.nasdaq = { ...(report.nasdaq ?? {}), error: e.message }; log('B failed', e.message); });
  if (PARTS.has('C')) await partC().catch((e) => { report.correctness = { error: e.message }; log('C failed', e.message); });
  if (PARTS.has('E')) await partE().catch((e) => { report.in_session = { error: e.message }; log('E failed', e.message); });
  if (PARTS.has('D')) await partD().catch((e) => { report.freshness = { error: e.message }; log('D failed', e.message); });
} finally {
  delete report._nasdaq; delete report._sessions;
  writeFileSync(OUT, JSON.stringify(report, null, 1));
  log('wrote', OUT);
}
