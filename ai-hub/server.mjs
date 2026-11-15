// AI Hub entry point: wires every module together and serves HTTP.
import http from 'node:http';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './src/config.mjs';
import { createRouter, parseUrl, sendJson, sendError, serveStatic } from './src/router.mjs';
import { createStore } from './src/store.mjs';
import { createAuth } from './src/auth.mjs';
import { createUsage } from './src/usage.mjs';
import { createLLM } from './src/llm.mjs';
import { createKnowledge } from './src/knowledge.mjs';
import { createProjects } from './src/projects.mjs';
import { createResearch } from './src/research.mjs';
import { createLimiter } from './src/ratelimit.mjs';
import { register as registerOpenAI } from './src/openai-compat.mjs';
import { register as registerChat } from './src/chat.mjs';
import { register as registerTagit } from './src/tagit.mjs';
import { register as registerAdmin } from './src/admin.mjs';

const DEP_NAMES = ['store', 'auth', 'usage', 'llm', 'knowledge', 'projects', 'research', 'limiter'];

function buildConfig(overrides) {
  const base = loadConfig();
  const merged = { ...base };
  // Config fields may be given flat (overrides.port) or nested (overrides.config.port).
  for (const [key, value] of Object.entries(overrides)) {
    if (key in base && !DEP_NAMES.includes(key) && value !== undefined) merged[key] = value;
  }
  if (overrides.config && typeof overrides.config === 'object') Object.assign(merged, overrides.config);
  return Object.freeze(merged);
}

function isApiPath(pathname) {
  return /^\/(api|v1)(\/|$)/.test(pathname);
}

/**
 * Build the app without listening.
 * `overrides` may replace any dependency (store, auth, usage, llm, knowledge,
 * projects, research, limiter) and any config field (`overrides.config`).
 * `overrides.log` replaces the request logger; `false` silences it.
 */
export async function createApp(overrides = {}) {
  const config    = buildConfig(overrides);
  const store     = overrides.store     ?? createStore({ dataDir: config.dataDir });
  const auth      = overrides.auth      ?? createAuth({ config, store });
  const usage     = overrides.usage     ?? createUsage({ config, store });
  const llm       = overrides.llm       ?? createLLM({ config });
  const knowledge = overrides.knowledge ?? await createKnowledge({ config });
  const projects  = overrides.projects  ?? createProjects({ config });
  const research  = overrides.research  ?? createResearch({ config, store });
  const limiter   = overrides.limiter   ?? createLimiter({ config });
  const deps = { config, store, auth, usage, llm, knowledge, projects, research, limiter };

  const router = createRouter({ config });

  // Public liveness endpoint. Always 200 while the hub itself is up; the
  // model state is reported inside `llm`.
  router.add('GET', '/health', async ({ res }) => {
    let health;
    try {
      health = await llm.health();
    } catch (err) {
      health = { ok: false, error: String(err?.message || err) };
    }
    sendJson(res, 200, { ok: true, version: config.version, llm: health });
  });

  registerOpenAI(router, deps);
  registerChat(router, deps);
  registerTagit(router, deps);
  registerAdmin(router, deps);

  const staticHandler = serveStatic(config.publicDir);
  const log = overrides.log === false
    ? () => {}
    : typeof overrides.log === 'function' ? overrides.log : (line) => console.log(line);

  async function onRequest(req, res) {
    const started = performance.now();
    let pathname = '/';
    let logged = false;
    // One line per request: method, path (no query string), status, duration.
    // Never headers, keys or bodies.
    res.on('close', () => {
      if (logged) return;
      logged = true;
      const ms = Math.round(performance.now() - started);
      log(`${req.method} ${pathname.slice(0, 200)} ${res.statusCode} ${ms}ms`);
    });

    try {
      limiter.securityHeaders(res);

      try {
        pathname = parseUrl(req).pathname;
      } catch {
        pathname = '(malformed)';
        sendError(res, 400, 'bad_request', 'Malformed URL');
        return;
      }

      if (await router.handle(req, res)) return;

      if (isApiPath(pathname)) {
        sendError(res, 404, 'not_found', `No route for ${req.method} ${pathname.slice(0, 200)}`);
        return;
      }

      if (await staticHandler(req, res)) return;

      sendError(res, 404, 'not_found', 'Not found');
    } catch (err) {
      console.error('[server] request failed:', err?.stack || err);
      if (!res.headersSent) sendError(res, 500, 'internal', 'Internal server error');
      else if (!res.writableEnded) res.end();
    }
  }

  const server = http.createServer(onRequest);
  // Runs behind Traefik: keep idle connections a little longer than the proxy does.
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  let closing = null;
  function close() {
    if (closing) return closing;
    closing = (async () => {
      try {
        await store.flush();
      } catch (err) {
        console.error('[server] store flush failed:', err?.message || err);
      }
      await new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
        // Open SSE streams and keep-alive sockets would otherwise block close().
        server.closeAllConnections();
      });
    })();
    return closing;
  }

  return { server, deps, router, close };
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

async function main() {
  const app = await createApp();
  const { config, llm } = app.deps;

  app.server.listen(config.port, '0.0.0.0', () => {
    console.log(`AI Hub v${config.version} listening on :${config.port} (model ${config.model})`);
  });

  if (config.autoPullModel) {
    // Background: never blocks boot, never throws.
    Promise.resolve()
      .then(() => llm.ensureModel(config.model))
      .then((ready) => console.log(`[llm] model ${config.model} ${ready ? 'ready' : 'not ready yet'}`))
      .catch((err) => console.error('[llm] ensureModel failed:', err?.message || err));
  }

  let stopping = false;
  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received, shutting down`);
    const force = setTimeout(() => process.exit(1), 10000);
    force.unref();
    app.close().then(() => process.exit(0), () => process.exit(1));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (isMain()) {
  main().catch((err) => {
    console.error('[server] failed to start:', err?.stack || err);
    process.exit(1);
  });
}
