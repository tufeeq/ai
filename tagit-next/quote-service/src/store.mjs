// Durable storage for the consolidated pulse detector: its signal ledger and what each signal's
// consolidated price did afterwards (5/15/30/60-minute and end-of-day observations), so the live
// record survives restarts and deploys. SQLite on the Railway volume (RAILWAY_VOLUME_MOUNT_PATH)
// or TAGIT_DB_PATH; without either, the pulse keeps working from memory and says so.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const HORIZONS_MIN = [5, 15, 30, 60];

export function dbPath(env = process.env) {
  if (env.TAGIT_DB_PATH) return env.TAGIT_DB_PATH;
  if (env.RAILWAY_VOLUME_MOUNT_PATH) return join(env.RAILWAY_VOLUME_MOUNT_PATH, 'tagit.sqlite');
  return null;
}

export function openStore(path, { now = Date.now } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS pulse_signals(
      id TEXT PRIMARY KEY, symbol TEXT NOT NULL, detected_at TEXT NOT NULL, rules TEXT NOT NULL,
      payload TEXT NOT NULL, observations TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS pulse_signals_time ON pulse_signals(detected_at);`);
  const insert = db.prepare('INSERT OR IGNORE INTO pulse_signals(id,symbol,detected_at,rules,payload,observations,updated_at) VALUES(?,?,?,?,?,?,?)');
  const update = db.prepare('UPDATE pulse_signals SET observations=?, updated_at=? WHERE id=?');
  const rewrite = db.prepare('UPDATE pulse_signals SET payload=?, updated_at=? WHERE id=?');
  const since = db.prepare('SELECT payload, observations FROM pulse_signals WHERE detected_at >= ? ORDER BY detected_at ASC LIMIT ?');
  const recent = db.prepare('SELECT payload, observations FROM pulse_signals ORDER BY detected_at DESC LIMIT ?');
  const count = db.prepare('SELECT COUNT(*) AS n FROM pulse_signals');
  const iso = () => new Date(now()).toISOString();
  return {
    path,
    record(entry) {
      insert.run(`${entry.symbol}@${entry.detected_at}`, entry.symbol, entry.detected_at, entry.rules ?? 'unknown', JSON.stringify(entry), JSON.stringify(entry.observed ?? {}), iso());
    },
    observe(entry) {
      update.run(JSON.stringify(entry.observed ?? {}), iso(), `${entry.symbol}@${entry.detected_at}`);
    },
    /** Replace the stored signal payload (context added after detection, e.g. news). */
    context(entry) {
      const { observed, ...payload } = entry;
      rewrite.run(JSON.stringify(payload), iso(), `${entry.symbol}@${entry.detected_at}`);
    },
    /** Every signal from `fromIso` on, oldest first (for the live study export). */
    since(fromIso, limit = 20_000) {
      return since.all(fromIso, limit).map((r) => ({ ...JSON.parse(r.payload), observed: JSON.parse(r.observations) }));
    },
    recent(limit = 300) {
      return recent.all(limit).map((r) => ({ ...JSON.parse(r.payload), observed: JSON.parse(r.observations) }));
    },
    count: () => Number(count.get().n),
    close: () => db.close(),
  };
}

/**
 * Update a ledger entry's observations from a consolidated price seen at `at` (ms): the first price
 * at or after each horizon, the running max/min since detection, and the latest price. Returns true
 * when something changed. Prices before detection are ignored.
 */
export function observe(entry, price, at) {
  const t0 = Date.parse(entry.detected_at);
  if (!(price > 0) || !Number.isFinite(at) || at < t0 || !(entry.price > 0)) return false;
  const o = (entry.observed ??= {});
  const ret = (p) => Math.round((p / entry.price - 1) * 1e4) / 100;
  let changed = false;
  for (const h of HORIZONS_MIN) {
    const key = `m${h}`;
    if (!o[key] && at - t0 >= h * 60_000) { o[key] = { price, at: new Date(at).toISOString(), return_pct: ret(price) }; changed = true; }
  }
  if (!(o.max_price >= price)) { o.max_price = price; o.max_return_pct = ret(price); changed = true; }
  if (!(o.min_price <= price)) { o.min_price = price; o.min_return_pct = ret(price); changed = true; }
  if (o.last_price !== price) { o.last_price = price; o.last_at = new Date(at).toISOString(); o.last_return_pct = ret(price); changed = true; }
  if (entry.stop > 0 && !o.stop_hit_at && price <= entry.stop) { o.stop_hit_at = new Date(at).toISOString(); changed = true; }
  // Price path for the first hour ([seconds since detection, price]), so alternative entries
  // (e.g. waiting for a pullback) can be evaluated later from what was actually observed.
  const sec = Math.round((at - t0) / 1000);
  if (sec <= 3600) {
    const path = (o.path ??= []);
    const last = path.at(-1);
    if ((!last || (sec > last[0] && (price !== last[1] || sec - last[0] >= 60))) && path.length < 240) { path.push([sec, price]); changed = true; }
  }
  return changed;
}
