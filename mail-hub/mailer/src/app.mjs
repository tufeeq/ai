// HTTP API: password reset + transactional send for registered projects, and a small admin API.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './store.mjs';
import { resetEmail, passwordChangedEmail, pickLocale } from './templates.mjs';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const STATIC = {
  '/admin': ['admin.html', 'text/html; charset=utf-8'],
  '/admin/': ['admin.html', 'text/html; charset=utf-8'],
  '/admin/admin.js': ['admin.js', 'text/javascript; charset=utf-8'],
  '/admin/admin.css': ['admin.css', 'text/css; charset=utf-8'],
};

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const isEmail = (s) => typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s);
const clean = (s, max) => (typeof s === 'string' ? s.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '');
const safeEq = (a, b) => {
  const x = Buffer.from(sha256(a)); const y = Buffer.from(sha256(b));
  return timingSafeEqual(x, y);
};

function validResetUrl(u) {
  try {
    const url = new URL(u);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch { return false; }
}

class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

// Fixed-window counter per key (in memory; resets on restart, which is acceptable for abuse throttling).
function createLimiter() {
  const hits = new Map();
  return (key, limit, windowMs) => {
    const now = Date.now();
    const cur = hits.get(key);
    if (!cur || cur.reset <= now) { hits.set(key, { n: 1, reset: now + windowMs }); return true; }
    if (cur.n >= limit) return false;
    cur.n += 1; return true;
  };
}

export function newProjectKey(id) { return `mh_${id}_${randomBytes(24).toString('hex')}`; }

export function createApp({ config, store, mailer, adminKey, now = () => Date.now() }) {
  const limit = createLimiter();
  const { q } = store;
  const failedAdmin = (() => {
    let n = 0; let reset = 0;
    return {
      blocked: () => (now() < reset ? n >= 10 : false),
      hit: () => { if (now() >= reset) { n = 0; reset = now() + 60_000; } n += 1; },
    };
  })();

  const fromHeader = (p) => ({ name: p.from_name, address: p.from_email });
  const projectName = (p) => p.from_name || p.name;

  function authProject(req) {
    const auth = req.headers.authorization || '';
    const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const parts = key.split('_');
    if (parts.length !== 3 || parts[0] !== 'mh' || !ID_RE.test(parts[1])) throw new HttpError(401, 'invalid_key');
    const p = q.getProject.get(parts[1]);
    if (!p || !timingSafeEqual(Buffer.from(p.key_hash), Buffer.from(sha256(key)))) throw new HttpError(401, 'invalid_key');
    if (p.disabled) throw new HttpError(403, 'project_disabled');
    if (!limit(`rpm:${p.id}`, config.projectRpm, 60_000)) throw new HttpError(429, 'rate_limited');
    return p;
  }

  function authAdmin(req) {
    const auth = req.headers.authorization || '';
    const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    // Only failed attempts are counted, so a brute-force run is cut off after 10 tries a minute.
    if (failedAdmin.blocked()) throw new HttpError(429, 'rate_limited');
    if (!key || !safeEq(key, adminKey)) { failedAdmin.hit(); throw new HttpError(401, 'invalid_admin_key'); }
  }

  // ---------- Project endpoints ----------

  async function requestReset(p, body) {
    const email = clean(body.email, 254).toLowerCase();
    if (!isEmail(email)) throw new HttpError(400, 'invalid_email');
    const userId = body.user_id == null ? null : clean(String(body.user_id), 128) || null;
    const name = clean(body.name, 80);
    const locale = pickLocale(body.locale || p.locale);
    const t = now();

    const windowStart = t - config.resetWindowMinutes * 60_000;
    if (q.countRecentResets.get(p.id, email, windowStart).n >= config.resetMaxPerEmailWindow) {
      store.log(p.id, 'reset_request', email, false, 'throttled');
      return [202, { ok: true, sent: false, reason: 'throttled' }];
    }

    const token = randomBytes(32).toString('base64url');
    const ttl = p.ttl_minutes || config.resetTtlMinutes;
    q.revokeOpenTokens.run(t, p.id, email); // only the newest link works
    q.insertToken.run(p.id, sha256(token), email, userId, t, t + ttl * 60_000);

    const url = new URL(p.reset_url);
    url.searchParams.set('token', token);
    const msg = resetEmail({ locale, project: projectName(p), color: p.brand_color, link: url.toString(), ttlMinutes: ttl, name });
    try {
      await mailer.send({ from: fromHeader(p), to: email, replyTo: p.reply_to || undefined, ...msg,
        headers: { 'X-Mail-Hub-Project': p.id, 'Auto-Submitted': 'auto-generated' } });
    } catch (e) {
      q.deleteToken.run(sha256(token));
      store.log(p.id, 'reset_request', email, false, `smtp: ${e.code || e.message}`);
      throw new HttpError(502, 'smtp_failed', 'The mail server did not accept the message');
    }
    store.log(p.id, 'reset_request', email, true);
    return [202, { ok: true, sent: true, expires_in_minutes: ttl }];
  }

  function tokenFrom(body) {
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(400, 'invalid_token');
    return token;
  }

  function verifyReset(p, body) {
    const row = q.peekToken.get(p.id, sha256(tokenFrom(body)), now());
    if (!row) return [410, { valid: false }];
    return [200, { valid: true, email: row.email, user_id: row.user_id, expires_at: new Date(row.expires_at).toISOString() }];
  }

  function consumeReset(p, body) {
    const row = q.consumeToken.get(now(), p.id, sha256(tokenFrom(body)), now());
    store.log(p.id, 'reset_consume', row?.email, !!row, row ? null : 'invalid_or_used');
    if (!row) return [410, { valid: false }];
    return [200, { valid: true, email: row.email, user_id: row.user_id }];
  }

  async function passwordChanged(p, body) {
    const email = clean(body.email, 254).toLowerCase();
    if (!isEmail(email)) throw new HttpError(400, 'invalid_email');
    const msg = passwordChangedEmail({ locale: body.locale || p.locale, project: projectName(p), color: p.brand_color, name: clean(body.name, 80) });
    try {
      await mailer.send({ from: fromHeader(p), to: email, replyTo: p.reply_to || undefined, ...msg,
        headers: { 'X-Mail-Hub-Project': p.id, 'Auto-Submitted': 'auto-generated' } });
    } catch (e) {
      store.log(p.id, 'password_changed', email, false, `smtp: ${e.code || e.message}`);
      throw new HttpError(502, 'smtp_failed');
    }
    store.log(p.id, 'password_changed', email, true);
    return [202, { ok: true }];
  }

  async function sendGeneric(p, body) {
    const to = clean(body.to, 254).toLowerCase();
    if (!isEmail(to)) throw new HttpError(400, 'invalid_to', 'One recipient address per call');
    const subject = clean(body.subject, 200);
    if (!subject) throw new HttpError(400, 'missing_subject');
    const text = typeof body.text === 'string' ? body.text.slice(0, 100_000) : '';
    const html = typeof body.html === 'string' ? body.html.slice(0, 200_000) : '';
    if (!text && !html) throw new HttpError(400, 'missing_body', 'Send text, html or both');
    const replyTo = body.reply_to && isEmail(body.reply_to) ? body.reply_to : (p.reply_to || undefined);
    const hourAgo = now() - 3600_000;
    if (q.countEvents.get(p.id, 'send', hourAgo).n >= config.sendPerHour) throw new HttpError(429, 'hourly_limit');
    try {
      const r = await mailer.send({ from: fromHeader(p), to, replyTo, subject, text: text || undefined, html: html || undefined,
        headers: { 'X-Mail-Hub-Project': p.id } });
      store.log(p.id, 'send', to, true);
      return [202, { ok: true, message_id: r.messageId }];
    } catch (e) {
      store.log(p.id, 'send', to, false, `smtp: ${e.code || e.message}`);
      throw new HttpError(502, 'smtp_failed');
    }
  }

  // ---------- Admin endpoints ----------

  function projectInput(body, existing = {}) {
    const v = {
      name: clean(body.name ?? existing.name, 80),
      reset_url: clean(body.reset_url ?? existing.reset_url, 500),
      from_email: clean(body.from_email ?? existing.from_email ?? config.defaultFromEmail, 254).toLowerCase(),
      from_name: clean(body.from_name ?? existing.from_name ?? body.name, 80),
      reply_to: clean(body.reply_to ?? existing.reply_to ?? '', 254).toLowerCase() || null,
      brand_color: clean(body.brand_color ?? existing.brand_color ?? '#4338CA', 7),
      locale: pickLocale(body.locale ?? existing.locale ?? 'ar'),
      ttl_minutes: Number.parseInt(body.ttl_minutes ?? existing.ttl_minutes ?? config.resetTtlMinutes, 10),
      disabled: body.disabled == null ? (existing.disabled ? 1 : 0) : (body.disabled ? 1 : 0),
    };
    if (!v.name) throw new HttpError(400, 'missing_name');
    if (!validResetUrl(v.reset_url)) throw new HttpError(400, 'invalid_reset_url', 'Use the https:// address of your reset page');
    if (!isEmail(v.from_email)) throw new HttpError(400, 'invalid_from_email');
    if (v.reply_to && !isEmail(v.reply_to)) throw new HttpError(400, 'invalid_reply_to');
    if (!COLOR_RE.test(v.brand_color)) throw new HttpError(400, 'invalid_brand_color');
    if (!(v.ttl_minutes >= 5 && v.ttl_minutes <= 120)) throw new HttpError(400, 'invalid_ttl', 'ttl_minutes must be 5–120');
    return v;
  }

  async function admin(method, path, body) {
    const t = now();
    if (method === 'GET' && path === '/admin/api/projects') {
      return [200, { projects: q.listProjects.all(t - 86_400_000, t - 86_400_000) }];
    }
    if (method === 'GET' && path === '/admin/api/status') {
      return [200, { smtp: await mailer.verify(), recent: q.recentEvents.all(50) }];
    }
    if (method === 'POST' && path === '/admin/api/projects') {
      const id = clean(body.id, 32).toLowerCase();
      if (!ID_RE.test(id)) throw new HttpError(400, 'invalid_id', 'Use 2–32 lowercase letters, digits or dashes');
      if (q.getProject.get(id)) throw new HttpError(409, 'id_taken');
      const v = projectInput(body);
      const key = newProjectKey(id);
      q.insertProject.run(id, v.name, sha256(key), v.reset_url, v.from_email, v.from_name, v.reply_to, v.brand_color, v.locale, v.ttl_minutes, t, t);
      store.log(id, 'project_created', null, true);
      return [201, { id, api_key: key, note: 'Shown once. Store it as a secret in the project.' }];
    }
    const m = path.match(/^\/admin\/api\/projects\/([a-z0-9-]{2,32})(\/rotate-key)?$/);
    if (m) {
      const p = q.getProject.get(m[1]);
      if (!p) throw new HttpError(404, 'not_found');
      if (method === 'POST' && m[2]) {
        const key = newProjectKey(p.id);
        q.rotateKey.run(sha256(key), t, p.id);
        store.log(p.id, 'key_rotated', null, true);
        return [200, { id: p.id, api_key: key, note: 'The old key stopped working now.' }];
      }
      if (method === 'PATCH' && !m[2]) {
        const v = projectInput(body, p);
        q.updateProject.run(v.name, v.reset_url, v.from_email, v.from_name, v.reply_to, v.brand_color, v.locale, v.ttl_minutes, v.disabled, p.id);
        return [200, { ok: true }];
      }
      if (method === 'DELETE' && !m[2]) { q.deleteProject.run(p.id); return [200, { ok: true }]; }
    }
    throw new HttpError(404, 'not_found');
  }

  // ---------- Plumbing ----------

  async function readJson(req) {
    const type = req.headers['content-type'] || '';
    const empty = !req.headers['transfer-encoding'] && Number(req.headers['content-length'] || 0) === 0;
    if (empty) return {};
    if (!type.includes('application/json')) throw new HttpError(415, 'json_required');
    let size = 0; const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > config.maxBodyBytes) throw new HttpError(413, 'body_too_large');
      chunks.push(c);
    }
    try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); return v && typeof v === 'object' ? v : {}; }
    catch { throw new HttpError(400, 'invalid_json'); }
  }

  const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store',
    'Strict-Transport-Security': 'max-age=31536000',
  };

  function send(res, status, obj) {
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  }

  const ROUTES = {
    'POST /v1/password-reset': requestReset,
    'POST /v1/password-reset/verify': verifyReset,
    'POST /v1/password-reset/consume': consumeReset,
    'POST /v1/notify/password-changed': passwordChanged,
    'POST /v1/send': sendGeneric,
  };

  return async function handler(req, res) {
    const path = new URL(req.url, 'http://x').pathname;
    try {
      if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true, service: 'mail-hub-mailer' });
      if ((req.method === 'GET' || req.method === 'HEAD') && STATIC[path]) {
        const [file, type] = STATIC[path];
        const content = await readFile(join(PUBLIC_DIR, file));
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type,
          'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
        return res.end(content);
      }
      if (path.startsWith('/admin/api/')) {
        authAdmin(req);
        const body = ['POST', 'PATCH'].includes(req.method) ? await readJson(req) : {};
        const [status, obj] = await admin(req.method, path, body);
        return send(res, status, obj);
      }
      const route = ROUTES[`${req.method} ${path}`];
      if (!route) throw new HttpError(404, 'not_found');
      const p = authProject(req);
      const body = await readJson(req);
      const [status, obj] = await route(p, body);
      return send(res, status, obj);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code, message: e.message !== e.code ? e.message : undefined });
      console.error('[mailer] unexpected error:', e);
      return send(res, 500, { error: 'internal_error' });
    }
  };
}
