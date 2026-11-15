// Minimal HTTP router and response helpers built on node:http only.
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const DEFAULT_MAX_BODY_BYTES = 1000000;

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code || 'error');
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/** Parse req.url into a URL without trusting the Host header or `//host` tricks. */
export function parseUrl(req) {
  const raw = typeof req.url === 'string' ? req.url : '/';
  if (!raw.startsWith('/')) throw new HttpError(400, 'bad_request', 'Malformed URL');
  return new URL(raw.replace(/^\/{2,}/, '/'), 'http://localhost');
}

export function sendJson(res, status, obj) {
  if (res.headersSent || res.writableEnded) return;
  const body = Buffer.from(JSON.stringify(obj === undefined ? null : obj), 'utf8');
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

export function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

/** Start a Server-Sent Events response. */
export function startSSE(res) {
  if (!res.headersSent) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
  }
  let closed = false;
  res.on('close', () => { closed = true; });
  return {
    /** Writes `data: <json>\n\n`. Returns false once the stream is closed. */
    send(obj) {
      if (closed || res.writableEnded || res.destroyed) return false;
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
      return true;
    },
    close() {
      closed = true;
      if (!res.writableEnded && !res.destroyed) res.end();
    },
    get closed() {
      return closed || res.writableEnded || res.destroyed;
    },
  };
}

function splitPath(pathname) {
  return pathname.split('/').filter((s) => s !== '');
}

function compilePattern(pattern) {
  if (typeof pattern !== 'string' || !pattern.startsWith('/')) {
    throw new TypeError(`Route pattern must start with "/": ${pattern}`);
  }
  return splitPath(pattern).map((seg) =>
    seg.startsWith(':') && seg.length > 1 ? { param: seg.slice(1) } : { literal: seg },
  );
}

function matchRoute(route, segments) {
  if (route.parts.length !== segments.length) return null;
  const entries = [];
  for (let i = 0; i < segments.length; i++) {
    const part = route.parts[i];
    if (part.literal !== undefined) {
      if (part.literal !== segments[i]) return null;
    } else {
      let value;
      try {
        value = decodeURIComponent(segments[i]);
      } catch {
        throw new HttpError(400, 'bad_request', 'Malformed path parameter');
      }
      entries.push([part.param, value]);
    }
  }
  return Object.fromEntries(entries);
}

function readJsonBody(req, res, limit) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => {
      // Discard whatever is left and close the connection after the response.
      try {
        if (!res.headersSent) res.setHeader('Connection', 'close');
      } catch { /* ignore */ }
      req.resume();
      reject(new HttpError(413, 'payload_too_large', `Request body exceeds ${limit} bytes`));
    };

    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) return tooLarge();

    const chunks = [];
    let size = 0;
    let settled = false;

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('close', onClose);
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > limit) {
        if (settled) return;
        settled = true;
        cleanup();
        tooLarge();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      let text = Buffer.concat(chunks).toString('utf8');
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      if (text.trim() === '') return finish(resolve, {});
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return finish(reject, new HttpError(400, 'invalid_json', 'Request body is not valid JSON'));
      }
      if (parsed === null || typeof parsed !== 'object') {
        return finish(reject, new HttpError(400, 'invalid_json', 'Request body must be a JSON object'));
      }
      finish(resolve, parsed);
    };
    const onError = () => finish(reject, new HttpError(400, 'bad_request', 'Could not read request body'));
    const onClose = () => finish(reject, new HttpError(400, 'bad_request', 'Request aborted'));

    if (req.readableEnded) return onEnd();
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('close', onClose);
  });
}

function handleRouteError(res, err) {
  const hasStatus = Number.isInteger(err?.status) && err.status >= 400 && err.status <= 599;
  const status = hasStatus ? err.status : 500;
  const code = typeof err?.code === 'string' && err.code ? err.code : 'internal';
  if (status >= 500) {
    // Never log request bodies or headers: only the error itself.
    console.error(`[router] handler error (${code}):`, err?.stack || err);
  }
  if (res.headersSent) {
    if (!res.writableEnded && !res.destroyed) res.end();
    return;
  }
  const message = hasStatus && err.message ? err.message : 'Internal server error';
  sendError(res, status, code, message);
}

export function createRouter({ config } = {}) {
  const routes = [];
  const maxBodyBytes = () => {
    const n = Number(config?.maxBodyBytes);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BODY_BYTES;
  };

  function find(method, segments) {
    for (const route of routes) {
      if (route.method !== method) continue;
      const params = matchRoute(route, segments);
      if (params) return { route, params };
    }
    return null;
  }

  return {
    add(method, pattern, handler) {
      if (typeof handler !== 'function') throw new TypeError('Route handler must be a function');
      routes.push({
        method: String(method).toUpperCase(),
        pattern,
        parts: compilePattern(pattern),
        handler,
      });
      return this;
    },

    /** Resolves true when a route matched (and a response was produced). */
    async handle(req, res) {
      let url;
      let found;
      try {
        url = parseUrl(req);
        const method = String(req.method || 'GET').toUpperCase();
        const segments = splitPath(url.pathname);
        found = find(method, segments);
        // HEAD falls back to the GET route; node:http drops the body itself.
        if (!found && method === 'HEAD') found = find('GET', segments);
      } catch (err) {
        handleRouteError(res, err);
        return true;
      }
      if (!found) return false;

      let bodyPromise = null;
      const ctx = {
        req,
        res,
        url,
        params: found.params,
        query: Object.fromEntries(url.searchParams),
        config,
        json() {
          if (!bodyPromise) bodyPromise = readJsonBody(req, res, maxBodyBytes());
          return bodyPromise;
        },
      };

      try {
        await found.route.handler(ctx);
      } catch (err) {
        handleRouteError(res, err);
      }
      return true;
    },

    /** Registered routes, for diagnostics and tests. */
    routes() {
      return routes.map((r) => ({ method: r.method, pattern: r.pattern }));
    },
  };
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Static file handler. Resolves true when it produced a response.
 * `/` maps to index.html and `/admin` to admin.html. Only GET and HEAD.
 */
export function serveStatic(publicDir) {
  const root = path.resolve(publicDir);
  let rootReal = null;

  return async function staticHandler(req, res) {
    const method = String(req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return false;

    let pathname;
    try {
      pathname = decodeURIComponent(parseUrl(req).pathname);
    } catch {
      return false;
    }
    if (pathname.includes('\0') || pathname.includes('\\')) return false;

    if (pathname === '/admin/') {
      // Keep relative asset URLs working by using the canonical path.
      res.statusCode = 302;
      res.setHeader('Location', '/admin');
      res.setHeader('Content-Length', 0);
      res.end();
      return true;
    }

    let rel;
    if (pathname === '/') rel = 'index.html';
    else if (pathname === '/admin') rel = 'admin.html';
    else rel = pathname.slice(1);

    const segments = rel.split('/');
    // Rejects traversal ('..'), empty segments and dotfiles.
    if (segments.some((s) => s === '' || s.startsWith('.'))) return false;

    const file = path.join(root, ...segments);
    if (!file.startsWith(root + path.sep)) return false;

    let info;
    try {
      info = await stat(file);
      if (!info.isFile()) return false;
      // Refuse symlinks that point outside the public folder.
      if (!rootReal) rootReal = await realpath(root);
      const fileReal = await realpath(file);
      if (!fileReal.startsWith(rootReal + path.sep)) return false;
    } catch {
      return false;
    }

    const ext = path.extname(file).toLowerCase();
    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    res.setHeader('Content-Type', CONTENT_TYPES[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', ext === '.html' ? 'no-cache' : 'public, max-age=300');
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', info.mtime.toUTCString());

    if (req.headers['if-none-match'] === etag) {
      res.statusCode = 304;
      res.end();
      return true;
    }

    res.statusCode = 200;
    res.setHeader('Content-Length', info.size);
    if (method === 'HEAD') {
      res.end();
      return true;
    }
    try {
      await pipeline(createReadStream(file), res);
    } catch {
      if (!res.destroyed) res.destroy();
    }
    return true;
  };
}
