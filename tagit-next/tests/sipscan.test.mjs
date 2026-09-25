import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { scanWindow, batches, relayUrl, detectSymbol, sipScan, SIP_DELAY_MS } from '../src/core/sipscan.js';

test('window ends on a shared 5-minute bucket at least the SIP delay in the past', () => {
  const now = Date.parse('2026-09-25T15:07:40Z');
  const w = scanWindow(now);
  assert.equal(w.end, '2026-09-25T14:50:00Z');
  assert.ok(now - w.endMs >= SIP_DELAY_MS);
  assert.deepEqual(scanWindow(now + 60_000), w, 'viewers a minute apart request the same window');
});

test('batches are sorted, de-duplicated and at most 100 symbols', () => {
  const syms = Array.from({ length: 250 }, (_, i) => `S${String(i).padStart(3, '0')}`).reverse();
  const b = batches([...syms, 'S000']);
  assert.deepEqual(b.map((x) => x.length), [100, 100, 50]);
  assert.equal(b[0][0], 'S000');
  assert.match(relayUrl('https://x.test', b[0], scanWindow(Date.now())), /resource=bars.*feed=sip/);
});

test('detection on study bars reproduces the frozen study signals for a session', () => {
  const raw = JSON.parse(gunzipSync(readFileSync(new URL('../research/study/2026-08-24.json.gz', import.meta.url))));
  const audit = JSON.parse(readFileSync(new URL('../research/study/discovery-audit.json', import.meta.url)));
  const expected = audit.events.filter((e) => e.date === '2026-08-24');
  const found = [];
  for (const [symbol, input] of Object.entries(raw.bars)) {
    // The study filtered to 13:30-20:00 UTC before detecting.
    const bars = input.filter((b) => { const d = new Date(b.timestamp), m = d.getUTCHours() * 60 + d.getUTCMinutes(); return m >= 810 && m < 1200; })
      .map((b) => ({ t: b.timestamp, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume, n: b.trade_count, vw: b.vwap }));
    found.push(...detectSymbol(symbol, bars).map((s) => `${s.symbol}|${s.detected_at}`));
  }
  assert.deepEqual(found.sort(), expected.map((e) => `${e.symbol}|${e.detected_at}`).sort());
});

test('scan reports coverage, keeps failed batches visible and only recent signals', async () => {
  const now = Date.parse('2026-09-25T16:00:00Z');
  const { endMs } = scanWindow(now);
  // A quiet baseline then a 3-minute burst ending at the window end.
  const bars = [];
  for (let m = 110; m >= 1; m--) {
    const t = endMs - m * 60_000;
    const burst = m <= 3;
    bars.push({ t: new Date(t).toISOString(), o: 1, h: burst ? 1.05 : 1.001, l: 0.999, c: burst ? 1 + (4 - m) * 0.01 : 1, v: burst ? 20000 : 1000, n: burst ? 40 : 5, vw: 1 });
  }
  const getJson = async (url) => {
    if (url.includes('ZF')) throw new Error('boom');
    return { bars: { AAA: bars }, next_page_token: null };
  };
  const good = Array.from({ length: 99 }, (_, i) => `G${String(i).padStart(3, '0')}`);
  const bad = Array.from({ length: 50 }, (_, i) => `ZF${String(i).padStart(3, '0')}`);
  const out = await sipScan({ getJson, service: 'https://x.test', symbols: ['AAA', ...good, ...bad], now });
  assert.equal(out.symbols, 150);
  assert.equal(out.with_bars, 1);
  assert.equal(out.failed, 50);
  assert.ok(out.signals.length >= 1);
  assert.equal(out.signals[0].symbol, 'AAA');
  assert.equal(out.signals[0].source, 'SIP_DELAYED');
});
