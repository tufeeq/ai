// auth — API key issuing and verification for AI Hub.
//
// Keys look like `hub_` + 32 base64url chars. Project keys are persisted only
// as sha256 hex digests in the store collection `keys`; the plain key is
// returned exactly once by createKey(). The admin key comes from
// config.adminKey, or is generated and kept in `<dataDir>/admin.key` (mode 600).

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KEY_PREFIX = 'hub_';
const KEYS_COLLECTION = 'keys';
const ADMIN_KEY_FILE = 'admin.key';
const PROJECT_RE = /^[a-z0-9-]{1,40}$/;
const MAX_NAME_LENGTH = 80;
const MAX_PRESENTED_KEY_LENGTH = 512;

function sha256Hex(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

// Constant-time comparison of two sha256 hex digests.
function hashEquals(aHex, bHex) {
  if (typeof aHex !== 'string' || typeof bHex !== 'string') return false;
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

function generateKey() {
  // 24 random bytes -> exactly 32 base64url characters.
  return KEY_PREFIX + randomBytes(24).toString('base64url');
}

function invalid(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'invalid_request';
  return err;
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  let value = headers[name];
  if (value === undefined) {
    // Node lowercases incoming header names; be lenient with hand-built requests.
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === name) {
        value = headers[key];
        break;
      }
    }
  }
  if (Array.isArray(value)) value = value[0];
  return typeof value === 'string' ? value.trim() : '';
}

// Extracts the presented key from `Authorization: Bearer <key>` or `x-api-key`.
function presentedKey(req) {
  const headers = req && req.headers;
  const authorization = headerValue(headers, 'authorization');
  if (authorization) {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization);
    if (match) return match[1];
  }
  return headerValue(headers, 'x-api-key');
}

function loadOrCreateAdminKey(config, log) {
  const configured = typeof config.adminKey === 'string' ? config.adminKey.trim() : '';
  if (configured) return configured;

  const dataDir = config.dataDir || './data';
  const file = join(dataDir, ADMIN_KEY_FILE);

  try {
    if (existsSync(file)) {
      const existing = readFileSync(file, 'utf8').trim();
      if (existing) {
        try { chmodSync(file, 0o600); } catch { /* best effort */ }
        return existing;
      }
    }
  } catch { /* unreadable file: fall through and generate a new key */ }

  const key = generateKey();
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, key + '\n', { mode: 0o600 });
    chmodSync(file, 0o600); // writeFileSync mode is ignored when the file already exists
  } catch (err) {
    log(`WARNING: could not persist admin key to ${file}: ${err.message}`);
  }
  log(`ADMIN KEY (save it): ${key}`);
  return key;
}

export function createAuth({ config, store, log = (line) => console.log(line) } = {}) {
  if (!config) throw new Error('createAuth: config is required');
  if (!store) throw new Error('createAuth: store is required');

  const adminHash = sha256Hex(loadOrCreateAdminKey(config, log));

  function readKeys() {
    const keys = store.get(KEYS_COLLECTION, []);
    return Array.isArray(keys) ? keys : [];
  }

  function verify(req) {
    const key = presentedKey(req);
    if (!key || key.length > MAX_PRESENTED_KEY_LENGTH) return { ok: false };

    const hash = sha256Hex(key);
    if (hashEquals(hash, adminHash)) {
      return { ok: true, role: 'admin', keyId: 'admin', project: '*', name: 'admin' };
    }

    // Scan every record (no early exit) so timing does not reveal the position.
    let found = null;
    for (const record of readKeys()) {
      if (record && hashEquals(hash, record.hash) && !found) found = record;
    }
    if (!found || found.revoked) return { ok: false };
    return { ok: true, role: 'project', keyId: found.id, project: found.project, name: found.name };
  }

  function deny(res, status, code, message) {
    if (!res || res.headersSent || res.writableEnded) return;
    const body = JSON.stringify({ error: { code, message } });
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    };
    if (status === 401) headers['WWW-Authenticate'] = 'Bearer';
    res.writeHead(status, headers);
    res.end(body);
  }

  function guard(ctx, role = 'project') {
    const identity = verify(ctx && ctx.req);
    if (!identity.ok) {
      deny(ctx && ctx.res, 401, 'unauthorized', 'Missing or invalid API key');
      return null;
    }
    if (role === 'admin' && identity.role !== 'admin') {
      deny(ctx && ctx.res, 403, 'forbidden', 'Admin key required');
      return null;
    }
    return identity;
  }

  function createKey({ name, project } = {}) {
    if (typeof name !== 'string') throw invalid('name must be a string of 1-80 characters');
    const cleanName = name.trim();
    if (cleanName.length < 1 || cleanName.length > MAX_NAME_LENGTH) {
      throw invalid('name must be a string of 1-80 characters');
    }
    if (typeof project !== 'string' || !PROJECT_RE.test(project)) {
      throw invalid('project must match /^[a-z0-9-]{1,40}$/');
    }

    const key = generateKey();
    const record = {
      id: 'key_' + randomBytes(8).toString('hex'),
      name: cleanName,
      project,
      hash: sha256Hex(key),
      createdAt: new Date().toISOString(),
      revoked: false,
    };
    store.set(KEYS_COLLECTION, [...readKeys(), record]);
    return { id: record.id, key, name: record.name, project: record.project, createdAt: record.createdAt };
  }

  function listKeys() {
    return readKeys().map(({ id, name, project, createdAt, revoked }) => ({
      id, name, project, createdAt, revoked: Boolean(revoked),
    }));
  }

  function revokeKey(id) {
    if (typeof id !== 'string' || !id) return false;
    const keys = readKeys();
    if (!keys.some((record) => record && record.id === id)) return false;
    store.set(KEYS_COLLECTION, keys.map((record) => (
      record && record.id === id ? { ...record, revoked: true } : record
    )));
    return true;
  }

  return { verify, guard, createKey, listKeys, revokeKey };
}
