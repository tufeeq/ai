// SQLite store (Node's built-in node:sqlite, no native build step).
// Secrets are never stored in clear: API keys and reset tokens are kept as SHA-256 hashes.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

export function openStore(dataDir) {
  let db;
  if (dataDir === ':memory:') {
    db = new DatabaseSync(':memory:');
  } else {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    db = new DatabaseSync(join(dataDir, 'mailer.db'));
  }
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS projects (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      key_hash      TEXT NOT NULL,
      reset_url     TEXT NOT NULL,
      from_email    TEXT NOT NULL,
      from_name     TEXT NOT NULL,
      reply_to      TEXT,
      brand_color   TEXT NOT NULL DEFAULT '#4338CA',
      locale        TEXT NOT NULL DEFAULT 'ar',
      ttl_minutes   INTEGER NOT NULL DEFAULT 30,
      disabled      INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL,
      key_rotated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reset_tokens (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      token_hash  TEXT NOT NULL UNIQUE,
      email       TEXT NOT NULL,
      user_id     TEXT,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      used_at     INTEGER,
      revoked_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_reset_lookup ON reset_tokens(project_id, email, created_at);

    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  TEXT,
      kind        TEXT NOT NULL,
      email_hash  TEXT,
      ok          INTEGER NOT NULL,
      detail      TEXT,
      at          INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, at);
  `);

  const q = {
    getProject: db.prepare('SELECT * FROM projects WHERE id = ?'),
    listProjects: db.prepare(`
      SELECT p.id, p.name, p.reset_url, p.from_email, p.from_name, p.reply_to, p.brand_color, p.locale,
             p.ttl_minutes, p.disabled, p.created_at, p.key_rotated_at,
             (SELECT COUNT(*) FROM events e WHERE e.project_id = p.id AND e.at > ?) AS events_24h,
             (SELECT COUNT(*) FROM events e WHERE e.project_id = p.id AND e.at > ? AND e.ok = 0) AS failures_24h
      FROM projects p ORDER BY p.created_at`),
    insertProject: db.prepare(`
      INSERT INTO projects (id, name, key_hash, reset_url, from_email, from_name, reply_to, brand_color, locale, ttl_minutes, created_at, key_rotated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    updateProject: db.prepare(`
      UPDATE projects SET name = ?, reset_url = ?, from_email = ?, from_name = ?, reply_to = ?, brand_color = ?, locale = ?, ttl_minutes = ?, disabled = ?
      WHERE id = ?`),
    rotateKey: db.prepare('UPDATE projects SET key_hash = ?, key_rotated_at = ? WHERE id = ?'),
    deleteProject: db.prepare('DELETE FROM projects WHERE id = ?'),

    countRecentResets: db.prepare(
      'SELECT COUNT(*) AS n FROM reset_tokens WHERE project_id = ? AND email = ? AND created_at > ?'),
    revokeOpenTokens: db.prepare(
      'UPDATE reset_tokens SET revoked_at = ? WHERE project_id = ? AND email = ? AND used_at IS NULL AND revoked_at IS NULL'),
    insertToken: db.prepare(`
      INSERT INTO reset_tokens (project_id, token_hash, email, user_id, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)`),
    deleteToken: db.prepare('DELETE FROM reset_tokens WHERE token_hash = ?'),
    peekToken: db.prepare(`
      SELECT email, user_id, expires_at FROM reset_tokens
      WHERE project_id = ? AND token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`),
    // Atomic single use: only one caller can flip used_at from NULL.
    consumeToken: db.prepare(`
      UPDATE reset_tokens SET used_at = ?
      WHERE project_id = ? AND token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
      RETURNING email, user_id`),
    purgeTokens: db.prepare('DELETE FROM reset_tokens WHERE expires_at < ?'),
    purgeEvents: db.prepare('DELETE FROM events WHERE at < ?'),

    logEvent: db.prepare(
      'INSERT INTO events (project_id, kind, email_hash, ok, detail, at) VALUES (?, ?, ?, ?, ?, ?)'),
    countEvents: db.prepare(
      'SELECT COUNT(*) AS n FROM events WHERE project_id = ? AND kind = ? AND at > ?'),
    recentEvents: db.prepare(
      'SELECT project_id, kind, ok, detail, at FROM events ORDER BY id DESC LIMIT ?'),
  };

  return {
    db,
    q,
    log(projectId, kind, email, ok, detail = null) {
      q.logEvent.run(projectId ?? null, kind, email ? sha256(email.toLowerCase()) : null, ok ? 1 : 0,
        detail ? String(detail).slice(0, 300) : null, Date.now());
    },
    housekeeping() {
      const now = Date.now();
      q.purgeTokens.run(now - 7 * 24 * 3600 * 1000); // keep used/expired tokens a week for audit
      q.purgeEvents.run(now - 90 * 24 * 3600 * 1000);
    },
    close() { db.close(); },
  };
}
