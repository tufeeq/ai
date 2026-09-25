// Pipeline funnel diagnostic: where do live stocks drop out, and does the same detector find
// signals on consolidated (SIP) minute bars that single-exchange IEX bars miss?
// Reads the live scanner and the service's read-only historical relay; writes a JSON report.
import { writeFileSync } from 'node:fs';
import { analyzeBars, RULES } from '../research/discovery-detector.mjs';

const SERVICE = process.env.TAGIT_SERVICE || 'https://tagit-next-quotes.onrender.com';
const OUT = process.argv[2] || 'funnel.json';

async function getJson(url, timeoutMs = 90_000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${r.status} ${body?.status ?? ''} ${url.slice(0, 120)}`);
  return body;
}

/** 1-minute bars for up to 100 symbols through the relay, following page tokens. */
export async function relayBars(symbols, start, end, feed) {
  const out = {};
  let token = null;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ resource: 'bars', symbols: symbols.join(','), timeframe: '1Min', start, end, feed, adjustment: 'raw', limit: '10000', sort: 'asc' });
    if (token) q.set('page_token', token);
    const body = await getJson(`${SERVICE}/api/lab/provider?${q}`);
    const data = body.data ?? body; // relay wraps the provider payload
    for (const [s, bars] of Object.entries(data.bars ?? {})) (out[s] ??= []).push(...bars);
    token = data.next_page_token;
    if (!token) break;
  }
  return out;
}

/** Replay the unchanged detector minute by minute (same loop as the frozen study). */
export function replay(bars, sessionStartMs) {
  const rows = bars
    .map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: b.n, vw: b.vw }))
    .filter((b) => Date.parse(b.t) >= sessionStartMs)
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const signals = [];
  let last = -Infinity;
  const fails = { ready: 0, volume: 0, momentum: 0, dollars: 0, trades: 0, balance: 0, vwap: 0 };
  let evaluated = 0;
  for (let i = 0; i < rows.length; i++) {
    const now = Date.parse(rows[i].t) + 60_000;
    const s = analyzeBars(rows.slice(Math.max(0, i - 89), i + 1), now);
    if (!s) continue;
    evaluated++;
    if (!s.ready) fails.ready++;
    else {
      if (!(s.volume_ratio >= RULES.volumeRatio)) fails.volume++;
      if (!(s.return_3m >= RULES.return3m)) fails.momentum++;
      if (!(s.dollars_3m >= RULES.minDollars3m)) fails.dollars++;
      if (!(s.trades_3m >= RULES.minTrades3m)) fails.trades++;
      if (!(s.volume_concentration <= RULES.maxSingleMinuteShare)) fails.balance++;
    }
    if (s.expansion && now - last >= RULES.cooldown) {
      last = now;
      signals.push({ at: new Date(now).toISOString(), price: rows[i].c, return_3m: s.return_3m, volume_ratio: s.volume_ratio, dollars_3m: s.dollars_3m, trades_3m: s.trades_3m });
    }
  }
  return { bars: rows.length, evaluated, signals, fails };
}

function liveFunnel(scan) {
  const now = Date.parse(scan.server_time);
  const rows = scan.rows ?? [];
  const sig = rows.filter((r) => r.signal);
  const count = (f) => sig.filter(f).length;
  return {
    server_time: scan.server_time,
    feed: scan.feed,
    eligible: scan.coverage?.eligible_small_caps,
    returned_rows: rows.length,
    fresh_trade_15s: rows.filter((r) => now - Date.parse(r.price_at) <= 15_000).length,
    fresh_quote_10s: rows.filter((r) => now - Date.parse(r.quote_at) <= 10_000).length,
    shortlisted_with_minutes: sig.length,
    ready_13_bars_contiguous: count((r) => r.signal.ready),
    volume_ratio_2x: count((r) => r.signal.ready && r.signal.volume_ratio >= 2),
    momentum_07: count((r) => r.signal.ready && r.signal.return_3m >= 0.7),
    dollars_25k: count((r) => r.signal.ready && r.signal.dollars_3m >= 25_000),
    trades_30: count((r) => r.signal.ready && r.signal.trades_3m >= 30),
    expansion: count((r) => r.signal.expansion),
    actionable: rows.filter((r) => r.actionable).length,
    alerts_in_ledger: (scan.alerts ?? []).length,
    median_bars_available: [...sig.map((r) => r.signal.bars)].sort((a, b) => a - b)[Math.floor(sig.length / 2)] ?? null,
  };
}

async function main() {
  const scan = await getJson(`${SERVICE}/api/scanner`);
  const funnel = liveFunnel(scan);
  console.log('LIVE FUNNEL', JSON.stringify(funnel, null, 1));

  // Same shortlist, today's regular session so far, both feeds, through the relay (≥ 16 min old).
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const offset = new Date(`${today}T12:00:00Z`).toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit' }) === '08' ? 4 : 5;
  const sessionStart = Date.parse(`${today}T${String(9 + offset).padStart(2, '0')}:30:00Z`);
  const start = new Date(sessionStart - 90 * 60_000).toISOString().replace(/\.\d+Z$/, 'Z');
  const end = new Date(Math.min(Date.now() - 17 * 60_000, sessionStart + 390 * 60_000)).toISOString().replace(/\.\d+Z$/, 'Z');
  const symbols = [...new Set((scan.rows ?? []).filter((r) => r.signal || r.day_change > 5).map((r) => r.symbol))].slice(0, 100);
  const comparison = { symbols: symbols.length, start, end, feeds: {} };
  for (const feed of ['iex', 'sip']) {
    try {
      const bars = await relayBars(symbols, start, end, feed);
      const per = Object.fromEntries(Object.entries(bars).map(([s, b]) => [s, replay(b, sessionStart - 90 * 60_000)]));
      const all = Object.values(per);
      const sum = (k) => all.reduce((a, r) => a + r.fails[k], 0);
      comparison.feeds[feed] = {
        symbols_with_bars: all.length,
        bars: all.reduce((a, r) => a + r.bars, 0),
        minutes_evaluated: all.reduce((a, r) => a + r.evaluated, 0),
        signals: all.reduce((a, r) => a + r.signals.length, 0),
        symbols_with_signal: all.filter((r) => r.signals.length).length,
        fail_counts: { ready: sum('ready'), volume: sum('volume'), momentum: sum('momentum'), dollars: sum('dollars'), trades: sum('trades'), balance: sum('balance') },
        examples: Object.entries(per).flatMap(([s, r]) => r.signals.map((x) => ({ symbol: s, ...x }))).slice(0, 15),
      };
    } catch (e) {
      comparison.feeds[feed] = { error: e.message };
    }
    console.log(feed.toUpperCase(), JSON.stringify({ ...comparison.feeds[feed], examples: undefined }));
  }
  writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), funnel, comparison }, null, 1));
  if (comparison.feeds.sip?.examples) console.log('SIP EXAMPLES', JSON.stringify(comparison.feeds.sip.examples.slice(0, 8)));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
