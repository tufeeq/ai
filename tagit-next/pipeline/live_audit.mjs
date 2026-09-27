// Live data audit (read-only). Runs on a GitHub runner, which can reach the Render service,
// Nasdaq.com and the Alpaca relay (this sandbox cannot). Measures:
//   A. the deployed service: scanner coverage/freshness, overlay counts, /api/live if present;
//   B. Nasdaq.com unofficial endpoints: which answer, batch sizes, throughput before throttling,
//      and how many universe symbols they cover;
//   C. correctness: Nasdaq.com last price / previous close and IEX closes versus consolidated
//      (SIP, split-adjusted) daily bars from the relay;
//   D. freshness upper bounds from a recent full session: per minute, how many universe symbols
//      traded on IEX versus on the consolidated tape (SIP minute bars).
// Output: JSON (AUDIT_OUT, default live-audit.json) plus a readable log.
//
// Usage: node live_audit.mjs [--parts A,B,C,D] [--session YYYY-MM-DD]
import { writeFileSync } from 'node:fs';
import { getJson as relayJson, eligibleSymbols, session } from './sip_study.mjs';
import { parseWatchlist, parseInfo, nasdaqMinute, WATCHLIST_URL, INFO_URL, HEADERS } from './nasdaq.mjs';

const SERVICE = process.env.TAGIT_SERVICE || 'https://tagit-next-quotes.onrender.com';
const OUT = process.env.AUDIT_OUT || 'live-audit.json';
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const PARTS = new Set((arg('--parts') || 'A,B,C,D').split(','));
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
  log('A health', health.status, health.ms + 'ms', JSON.stringify(health.body)?.slice(0, 600));
  const scan = await timed(`${SERVICE}/api/scanner`, { timeout: 120_000 });
  const b = scan.body;
  if (b?.rows) {
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
  } else out.scanner = { status: scan.status, ms: scan.ms, error: scan.error ?? scan.text ?? b?.status };
  log('A scanner', JSON.stringify(out.scanner).slice(0, 1200));
  const live = await timed(`${SERVICE}/api/live`, { timeout: 60_000 });
  out.live = { status: live.status, ms: live.ms, summary: live.body?.coverage ?? live.body?.status ?? live.text ?? live.error };
  log('A /api/live', live.status, JSON.stringify(out.live.summary)?.slice(0, 800));
  report.service_audit = out;
}

// ---- B. Nasdaq.com endpoints ----------------------------------------------------------------
async function partB() {
  const out = {};
  const sample = universe.filter((_, i) => i % Math.max(1, Math.floor(universe.length / 60)) === 0).slice(0, 60);
  // B1 single-symbol info endpoint, sequential pacing 250 ms.
  const info = [];
  for (const s of sample.slice(0, 30)) {
    const r = await timed(INFO_URL(s), { headers: HEADERS });
    const parsed = r.body ? parseInfo(s, r.body, Date.now()) : null;
    info.push({ s, status: r.status, ms: r.ms, ok: Boolean(parsed?.price) });
    await sleep(250);
  }
  out.info = { requests: info.length, ok: info.filter((x) => x.ok).length, statuses: tally(info.map((x) => x.status)), ms_p50: q(info.map((x) => x.ms), 0.5) };
  log('B info', JSON.stringify(out.info));
  const one = await timed(INFO_URL(sample[0]), { headers: HEADERS });
  out.info_shape = JSON.stringify(one.body?.data ?? one.body)?.slice(0, 1500);
  log('B info shape', out.info_shape);
  // B2 watchlist batch endpoint at several batch sizes.
  out.watchlist = [];
  for (const size of [10, 25, 50, 100, 200]) {
    const batch = universe.slice(0, size);
    const r = await timed(WATCHLIST_URL(batch), { headers: HEADERS, timeout: 30_000 });
    const rows = r.body ? parseWatchlist(r.body, Date.now()) : [];
    const entry = { size, status: r.status, ms: r.ms, rows: rows.length, priced: rows.filter((x) => x.price).length, error: r.error ?? r.text ?? null };
    out.watchlist.push(entry);
    log('B watchlist', JSON.stringify(entry));
    if (size === 10) { out.watchlist_shape = JSON.stringify(r.body)?.slice(0, 2500); log('B watchlist shape', out.watchlist_shape); }
    await sleep(1000);
  }
  // B3 whole universe through the batch endpoint, then a throughput burst.
  const best = out.watchlist.filter((w) => w.status === 200 && w.priced >= w.size * 0.5).map((w) => w.size).at(-1) ?? 0;
  out.best_batch = best;
  if (best) {
    const seen = new Map();
    const t0 = Date.now();
    const statuses = [];
    for (let i = 0; i < universe.length; i += best) {
      const r = await timed(WATCHLIST_URL(universe.slice(i, i + best)), { headers: HEADERS, timeout: 30_000 });
      statuses.push(r.status);
      for (const row of r.body ? parseWatchlist(r.body, Date.now()) : []) if (row.price) seen.set(row.symbol, row);
    }
    out.universe_pass = { batch: best, requests: statuses.length, seconds: round((Date.now() - t0) / 1000, 1), statuses: tally(statuses), priced: seen.size, of: universe.length,
      missing_sample: universe.filter((s) => !seen.has(s)).slice(0, 25) };
    log('B universe pass', JSON.stringify(out.universe_pass));
    report._nasdaq = seen;
    // Burst: repeat full passes back to back for ~3 minutes to find throttling.
    const burst = []; const tb = Date.now(); let passes = 0;
    while (Date.now() - tb < 180_000) {
      for (let i = 0; i < universe.length; i += best) {
        const r = await timed(WATCHLIST_URL(universe.slice(i, i + best)), { headers: HEADERS, timeout: 30_000 });
        burst.push(r.status);
        if (r.status !== 200) break;
      }
      passes++;
      if (burst.at(-1) !== 200) break;
    }
    out.burst = { seconds: round((Date.now() - tb) / 1000, 1), requests: burst.length, passes, statuses: tally(burst),
      requests_per_min: round(burst.length / ((Date.now() - tb) / 60_000), 1) };
    log('B burst', JSON.stringify(out.burst));
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

try {
  if (PARTS.has('A')) await partA().catch((e) => { report.service_audit = { error: e.message }; log('A failed', e.message); });
  if (PARTS.has('B')) await partB().catch((e) => { report.nasdaq = { ...(report.nasdaq ?? {}), error: e.message }; log('B failed', e.message); });
  if (PARTS.has('C')) await partC().catch((e) => { report.correctness = { error: e.message }; log('C failed', e.message); });
  if (PARTS.has('D')) await partD().catch((e) => { report.freshness = { error: e.message }; log('D failed', e.message); });
} finally {
  delete report._nasdaq; delete report._sessions;
  writeFileSync(OUT, JSON.stringify(report, null, 1));
  log('wrote', OUT);
}
