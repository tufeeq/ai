// Admin API — key management, usage summary and service status.
//
// Every route requires the admin key (`auth.guard(ctx, 'admin')`) and is rate
// limited per key id. Responses are written here directly so this module does
// not depend on router.mjs exports. Nothing in here ever echoes the admin key,
// key hashes or any other secret.

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

const DEFAULT_DAYS = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 365;
const MAX_NAME_LENGTH = 80;

function writeJson(res, status, obj, extraHeaders) {
  if (!res || res.headersSent || res.writableEnded) return;
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    ...JSON_HEADERS,
    'Content-Length': Buffer.byteLength(body),
    ...(extraHeaders || {}),
  });
  res.end(body);
}

function writeError(res, status, code, message, extraHeaders) {
  writeJson(res, status, { error: { code, message } }, extraHeaders);
}

/** Clamp the `days` query value to 1..365; anything unusable becomes 30. */
export function clampDays(raw) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === null || String(value).trim() === '') return DEFAULT_DAYS;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, n));
}

function errorText(err) {
  const message = err && typeof err.message === 'string' ? err.message : String(err);
  return message.slice(0, 200) || 'unknown error';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function register(router, deps) {
  const { auth, usage, llm, knowledge, projects, limiter, config } = deps;

  // Wraps a handler with the admin guard, the rate limit and a last-resort
  // error boundary (the message of an unexpected error is not sent out).
  function admin(handler) {
    return async (ctx) => {
      const id = auth.guard(ctx, 'admin');
      if (!id) return; // guard already answered 401 / 403

      const limit = limiter.check('admin:' + id.keyId);
      if (!limit || !limit.ok) {
        const retryAfterSec = Math.max(1, Math.ceil(Number(limit && limit.retryAfterSec) || 1));
        writeError(ctx.res, 429, 'rate_limited', `Too many requests. Retry in ${retryAfterSec}s.`, {
          'Retry-After': String(retryAfterSec),
        });
        return;
      }

      try {
        await handler(ctx, id);
      } catch (err) {
        const status = Number(err && err.status);
        if (status >= 400 && status < 500) {
          writeError(ctx.res, status, (err && err.code) || 'invalid_request', errorText(err));
          return;
        }
        writeError(ctx.res, 500, 'internal', 'Internal error');
      }
    };
  }

  function projectIds() {
    const list = projects.list();
    return (Array.isArray(list) ? list : [])
      .map((entry) => (entry && typeof entry.id === 'string' ? entry.id : null))
      .filter(Boolean);
  }

  // ---- keys ---------------------------------------------------------------

  router.add('GET', '/api/admin/keys', admin(async (ctx) => {
    const keys = (auth.listKeys() || []).map(({ id, name, project, createdAt, revoked }) => ({
      id, name, project, createdAt, revoked: Boolean(revoked),
    }));
    writeJson(ctx.res, 200, { keys });
  }));

  router.add('POST', '/api/admin/keys', admin(async (ctx) => {
    const body = await ctx.json(); // HttpError(400|413) handled by the boundary
    if (!isPlainObject(body)) {
      writeError(ctx.res, 400, 'invalid_request', 'Body must be a JSON object: { name, project }');
      return;
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > MAX_NAME_LENGTH) {
      writeError(ctx.res, 400, 'invalid_request', `name must be a string of 1-${MAX_NAME_LENGTH} characters`);
      return;
    }

    const valid = projectIds();
    if (typeof body.project !== 'string' || !valid.includes(body.project)) {
      writeError(ctx.res, 400, 'invalid_project',
        `project must be one of: ${valid.join(', ') || '(no projects configured)'}`);
      return;
    }

    let created;
    try {
      created = auth.createKey({ name, project: body.project });
    } catch (err) {
      if (err && err.status === 400) {
        writeError(ctx.res, 400, err.code || 'invalid_request', errorText(err));
        return;
      }
      throw err;
    }

    // The plain key is returned exactly once, here.
    writeJson(ctx.res, 201, {
      id: created.id,
      key: created.key,
      name: created.name,
      project: created.project,
      createdAt: created.createdAt,
    });
  }));

  router.add('DELETE', '/api/admin/keys/:id', admin(async (ctx) => {
    const keyId = ctx.params && typeof ctx.params.id === 'string' ? ctx.params.id : '';
    if (!keyId || !auth.revokeKey(keyId)) {
      writeError(ctx.res, 404, 'not_found', 'Key not found');
      return;
    }
    writeJson(ctx.res, 200, { revoked: true });
  }));

  // ---- usage --------------------------------------------------------------

  router.add('GET', '/api/admin/usage', admin(async (ctx) => {
    const days = clampDays(ctx.query && ctx.query.days);
    writeJson(ctx.res, 200, usage.summary({ days }));
  }));

  // ---- status -------------------------------------------------------------

  router.add('GET', '/api/admin/status', admin(async (ctx) => {
    let health;
    try {
      health = await llm.health();
      if (!isPlainObject(health)) health = { ok: false, error: 'health check returned no data' };
    } catch (err) {
      health = { ok: false, error: errorText(err) };
    }

    let stats;
    try {
      stats = await knowledge.stats();
      if (!isPlainObject(stats)) stats = { chunks: 0, error: 'knowledge stats returned no data' };
    } catch (err) {
      stats = { chunks: 0, error: errorText(err) };
    }

    let projectCount = 0;
    try {
      projectCount = projectIds().length;
    } catch {
      projectCount = 0;
    }

    const cfg = ctx.config || config || {};
    // Only the three whitelisted, non-secret config fields are ever exposed.
    writeJson(ctx.res, 200, {
      version: cfg.version || null,
      uptimeSec: Math.floor(process.uptime()),
      llm: health,
      knowledge: stats,
      projects: projectCount,
      config: {
        model: cfg.model,
        numCtx: cfg.numCtx,
        rateLimitRpm: cfg.rateLimitRpm,
      },
    });
  }));
}
