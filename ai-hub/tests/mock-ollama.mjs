// In-process fake of the Ollama native HTTP API, for tests only (no network, no real model).
//
// Shapes follow ollama/ollama docs/api.md:
//   GET  /api/tags -> { models: [{ name, model, modified_at, size, digest, details }] }
//   POST /api/chat -> stream:false: one JSON object { model, created_at, message, done:true,
//                     done_reason, prompt_eval_count, eval_count, *_duration }
//                     stream:true (the Ollama default): NDJSON chunks
//                     { model, created_at, message:{ role, content }, done:false } and a final
//                     object with done:true carrying prompt_eval_count / eval_count.
//   POST /api/pull -> NDJSON status lines ending with { status: 'success' }
//                     (stream:false -> the single success object).
//   Errors         -> { error: '<text>' } with an HTTP error status.
import http from 'node:http';

const DIGEST = 'sha256:' + '0123456789abcdef'.repeat(4);

function normalizeName(name) {
  const s = String(name ?? '').trim().toLowerCase();
  if (!s) return '';
  const lastSlash = s.lastIndexOf('/');
  return s.indexOf(':', lastSlash + 1) === -1 ? `${s}:latest` : s;
}

function estimateTokens(text) {
  const n = Array.from(String(text ?? '')).length;
  return n === 0 ? 0 : Math.max(1, Math.ceil(n / 4));
}

// Splits on code points so a chunk never ends inside a surrogate pair.
function splitReply(text, pieces = 4) {
  const chars = Array.from(String(text ?? ''));
  if (chars.length === 0) return [];
  const size = Math.max(1, Math.ceil(chars.length / pieces));
  const out = [];
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(''));
  return out;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts the mock on an ephemeral port.
 * `reply` / `jsonReply` may also be functions `(requestBody) => string`.
 * Returns { url, close(), requests, models, set(partialOptions) }.
 */
export async function startMockOllama({
  models = ['qwen2.5:3b'],
  reply = 'مرحبا! Hello from mock.',
  jsonReply,
  failChat = false,
  delayMs = 0,
} = {}) {
  const state = { models: [...models], reply, jsonReply, failChat, delayMs };
  const requests = [];

  const sendJson = (res, status, obj) => {
    const body = Buffer.from(JSON.stringify(obj), 'utf8');
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
    res.end(body);
  };
  const hasModel = (name) => state.models.some((m) => normalizeName(m) === normalizeName(name));
  const resolveText = (value, body) => String(typeof value === 'function' ? value(body) : value ?? '');

  async function handleChat(res, body) {
    if (state.delayMs > 0) await sleep(state.delayMs);
    if (state.failChat) return sendJson(res, 500, { error: 'mock ollama: forced chat failure' });
    if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) {
      return sendJson(res, 400, { error: 'invalid request: messages must be an array' });
    }
    const model = String(body.model || '');
    if (!hasModel(model)) {
      return sendJson(res, 404, { error: `model '${model}' not found` });
    }

    const wantsJson = body.format === 'json' || (body.format && typeof body.format === 'object');
    const content = wantsJson && state.jsonReply !== undefined
      ? resolveText(state.jsonReply, body)
      : resolveText(state.reply, body);
    const promptTokens = Math.max(1, body.messages.reduce((n, m) => n + estimateTokens(m && m.content), 0));
    const completionTokens = Math.max(1, estimateTokens(content));
    const createdAt = new Date().toISOString();
    const final = {
      model,
      created_at: createdAt,
      message: { role: 'assistant', content: '' },
      done_reason: 'stop',
      done: true,
      total_duration: 5_000_000,
      load_duration: 1_000_000,
      prompt_eval_count: promptTokens,
      prompt_eval_duration: 2_000_000,
      eval_count: completionTokens,
      eval_duration: 2_000_000,
    };

    if (body.stream === false) {
      return sendJson(res, 200, { ...final, message: { role: 'assistant', content } });
    }

    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    for (const piece of splitReply(content)) {
      res.write(JSON.stringify({
        model, created_at: createdAt, message: { role: 'assistant', content: piece }, done: false,
      }) + '\n');
      await sleep(2); // separate TCP writes so clients see real incremental chunks
    }
    res.end(JSON.stringify(final) + '\n');
  }

  async function handlePull(res, body) {
    const model = String((body && (body.model || body.name)) || '').trim();
    if (!model) return sendJson(res, 400, { error: 'invalid model name' });
    const add = () => { if (!hasModel(model)) state.models.push(model); };
    if (body.stream === false) {
      add();
      return sendJson(res, 200, { status: 'success' });
    }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    const lines = [
      { status: 'pulling manifest' },
      { status: `pulling ${DIGEST.slice(7, 19)}`, digest: DIGEST, total: 1000 },
      { status: `pulling ${DIGEST.slice(7, 19)}`, digest: DIGEST, total: 1000, completed: 1000 },
      { status: 'verifying sha256 digest' },
      { status: 'writing manifest' },
      { status: 'removing any unused layers' },
    ];
    for (const line of lines) res.write(JSON.stringify(line) + '\n');
    add();
    res.end(JSON.stringify({ status: 'success' }) + '\n');
  }

  const server = http.createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      const raw = await readBody(req);
      let body;
      if (raw.trim() !== '') {
        try {
          body = JSON.parse(raw);
        } catch {
          requests.push({ method: req.method, path, body: raw });
          return sendJson(res, 400, { error: 'invalid character in request body' });
        }
      }
      requests.push({ method: req.method, path, body });

      if (req.method === 'GET' && path === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Ollama is running');
      }
      if (req.method === 'GET' && path === '/api/version') return sendJson(res, 200, { version: '0.0.0-mock' });
      if (req.method === 'GET' && path === '/api/tags') {
        return sendJson(res, 200, {
          models: state.models.map((name) => ({
            name,
            model: name,
            modified_at: '2025-01-01T00:00:00Z',
            size: 1_900_000_000,
            digest: DIGEST.slice(7),
            details: {
              parent_model: '', format: 'gguf', family: 'mock', families: ['mock'],
              parameter_size: '3B', quantization_level: 'Q4_K_M',
            },
          })),
        });
      }
      if (req.method === 'POST' && path === '/api/chat') return await handleChat(res, body);
      if (req.method === 'POST' && path === '/api/pull') return await handlePull(res, body || {});
      return sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { error: `mock ollama crashed: ${err?.message || err}` });
      else res.end();
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    get models() {
      return [...state.models];
    },
    /** Change behaviour mid-test, e.g. set({ failChat: true }). */
    set(partial = {}) {
      for (const key of ['models', 'reply', 'jsonReply', 'failChat', 'delayMs']) {
        if (key in partial) state[key] = key === 'models' ? [...partial.models] : partial[key];
      }
    },
    close() {
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
