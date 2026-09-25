// Snapshot-volume pressure proxy: added volume between scans is attributed to
// the direction of the price move. It is not trade-side flow or measured money in/out.
import { finite, positive } from './util.js';
import { marketDate } from './market.js';

const SAMPLE_MAX_LAG_MS = 60_000;
const GAP_RESET_MS = 90_000;
const WINDOW_MS = 300_000;

export function updatePressure(previous, row, at) {
  const ts = Date.parse(at);
  const traded = Date.parse(row.price_at);
  const volume = row.day_volume;
  if (!Number.isFinite(ts) || !Number.isFinite(traded) || !positive(row.price) || !finite(volume) || volume < 0) {
    return previous ?? null;
  }
  if (ts - traded < 0 || ts - traded > SAMPLE_MAX_LAG_MS) return previous ?? null;
  if (previous && ts <= previous.at) return previous;

  const sample = { at: ts, price: row.price, volume };
  const reset = !previous || ts - previous.at > GAP_RESET_MS || volume < previous.volume ||
    marketDate(ts) !== marketDate(previous.at);
  if (reset) return { ...sample, segments: [] };

  const delta = volume - previous.volume;
  const dollars = (delta * (row.price + previous.price)) / 2;
  const side = row.price > previous.price ? 'up' : row.price < previous.price ? 'down' : 'flat';
  const segments = [
    ...(previous.segments ?? []).filter((x) => ts - x.at <= WINDOW_MS),
    ...(delta > 0 ? [{ at: ts, dollars, side }] : []),
  ];
  return { ...sample, segments };
}

export const PRESSURE_LABELS = {
  IN: '↗ ضغط شراء تقديري',
  OUT: '↘ ضغط بيع تقديري',
  BALANCED: '↔ متوازن',
  UNCLEAR: 'اتجاه غير واضح',
  WARMUP: 'تجميع عينات',
  UNKNOWN: 'غير متاح',
};

export function pressureSummary(state, now = Date.now()) {
  if (!state || now - state.at > GAP_RESET_MS) {
    return { status: 'UNKNOWN', label: PRESSURE_LABELS.UNKNOWN, up: null, down: null, flat: null, net: null };
  }
  const samples = state.segments.filter((x) => now - x.at <= WINDOW_MS);
  const sum = (side) => samples.filter((x) => x.side === side).reduce((s, x) => s + x.dollars, 0);
  const up = sum('up');
  const down = sum('down');
  const flat = sum('flat');
  const total = up + down + flat;
  if (samples.length < 3 || total <= 0) {
    return { status: 'WARMUP', label: PRESSURE_LABELS.WARMUP, up, down, flat, net: null };
  }
  const net = up - down;
  const classified = (up + down) / total;
  const status = classified < 0.6 ? 'UNCLEAR' : net / total > 0.15 ? 'IN' : net / total < -0.15 ? 'OUT' : 'BALANCED';
  return { status, label: PRESSURE_LABELS[status], up, down, flat, net, samples: samples.length, coverage: classified };
}
