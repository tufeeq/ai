// LLM client for the Ollama native HTTP API (zero dependencies).
//
// Endpoints used (verified against ollama/ollama docs/api.md and docs.ollama.com/api):
//   POST /api/chat  { model, messages, stream, format?, options:{ temperature, num_predict, num_ctx } }
//                   stream:false -> one JSON object; stream:true -> NDJSON, last object has done:true
//                   and carries prompt_eval_count / eval_count.
//   GET  /api/tags  -> { models: [{ name, model, ... }] }
//   POST /api/pull  { model, stream:true } -> NDJSON status lines, last one { status: 'success' }
// Errors come back as { "error": "<text>" } (HTTP error status, or as a line inside a stream).

const TAGS_TIMEOUT_MS = 10_000;
const HEALTH_TIMEOUT_MS = 3_000;
const DEFAULT_PULL_TIMEOUT_MS = 2 * 60 * 60 * 1000; // overall cap for a model pull (>= 60 min)
const DEFAULT_LLM_TIMEOUT_MS = 180_000;

const STATUS_BY_CODE = {
  unreachable: 503,
  timeout: 504,
  model_missing: 503,
  bad_response: 502,
};

export class LLMError extends Error {
  /**
   * @param {'unreachable'|'timeout'|'model_missing'|'bad_response'} code
   * @param {string} message
   * @param {{ cause?: unknown, aborted?: boolean }} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message || code, extra.cause !== undefined ? { cause: extra.cause } : undefined);
    this.name = 'LLMError';
    this.code = code;
    // HTTP status hint so an uncaught LLMError maps to a sensible response in the router.
    this.status = STATUS_BY_CODE[code] || 502;
    // True when the request was cancelled by the caller's own signal (reported with code 'timeout').
    this.aborted = Boolean(extra.aborted);
  }
}

// "qwen2.5" and "qwen2.5:latest" are the same model for Ollama.
function normalizeModelName(name) {
  const s = String(name ?? '').trim().toLowerCase();
  if (!s) return '';
  const lastSlash = s.lastIndexOf('/');
  return s.indexOf(':', lastSlash + 1) === -1 ? `${s}:latest` : s;
}

function sameModel(a, b) {
  const na = normalizeModelName(a);
  return na !== '' && na === normalizeModelName(b);
}

function looksLikeModelMissing(text) {
  const s = String(text || '');
  return /model\b[^\n]*\bnot found/i.test(s) || /not found, try pulling/i.test(s);
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function describe(err) {
  if (!err) return 'unknown error';
  const cause = err.cause;
  const detail = cause && (cause.code || cause.message);
  return detail ? `${err.message} (${detail})` : String(err.message || err);
}

function cleanMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && typeof m === 'object')
    .map((m) => {
      const out = { role: String(m.role || 'user'), content: m.content == null ? '' : String(m.content) };
      if (Array.isArray(m.images) && m.images.length) out.images = m.images;
      return out;
    });
}

export function createLLM({ config, fetchImpl = fetch, pullTimeoutMs = DEFAULT_PULL_TIMEOUT_MS } = {}) {
  const cfg = config || {};
  const baseUrl = String(cfg.ollamaUrl || 'http://ollama:11434').replace(/\/+$/, '');
  const defaultModel = String(cfg.model || '');
  const llmTimeoutMs = Number(cfg.llmTimeoutMs) > 0 ? Number(cfg.llmTimeoutMs) : DEFAULT_LLM_TIMEOUT_MS;
  const numCtx = Number(cfg.numCtx) > 0 ? Math.floor(Number(cfg.numCtx)) : 4096;
  const numThread = Number(cfg.numThread) > 0 ? Math.floor(Number(cfg.numThread)) : 0;

  // model (normalized) -> in-flight ensureModel promise
  const inFlight = new Map();
  let activePulls = 0;

  // ---- low-level request plumbing -------------------------------------------------------------

  // Opens a request guarded by a timeout and an optional caller signal.
  // Returns { res, touch, fail, close, race } — caller MUST call close().
  async function open(path, { method = 'GET', body, timeoutMs, signal } = {}) {
    const controller = new AbortController();
    const state = { timedOut: false, callerAborted: false };
    let timer = null;

    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          state.timedOut = true;
          controller.abort();
        }, timeoutMs);
      }
    };
    const onCallerAbort = () => {
      state.callerAborted = true;
      controller.abort();
    };
    if (signal) {
      if (signal.aborted) onCallerAbort();
      else signal.addEventListener('abort', onCallerAbort, { once: true });
    }

    // Rejects as soon as our controller aborts, so a hung body read cannot outlive the timeout.
    let rejectAborted;
    const aborted = new Promise((_, reject) => {
      rejectAborted = reject;
    });
    aborted.catch(() => {});
    const onAbort = () => rejectAborted(new DOMException('This operation was aborted', 'AbortError'));
    if (controller.signal.aborted) onAbort();
    else controller.signal.addEventListener('abort', onAbort, { once: true });

    const close = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (signal) signal.removeEventListener('abort', onCallerAbort);
      controller.signal.removeEventListener('abort', onAbort);
    };
    const fail = (err) => {
      if (err instanceof LLMError) return err;
      if (state.timedOut) {
        return new LLMError('timeout', `Ollama did not answer within ${timeoutMs} ms`, { cause: err });
      }
      if (state.callerAborted) {
        return new LLMError('timeout', 'request aborted by caller', { cause: err, aborted: true });
      }
      return new LLMError('unreachable', `cannot reach Ollama: ${describe(err)}`, { cause: err });
    };
    const race = (promise) => Promise.race([promise, aborted]);

    arm();
    try {
      const init = { method, signal: controller.signal, headers: { accept: 'application/json' } };
      if (body !== undefined) {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const res = await race(Promise.resolve().then(() => fetchImpl(`${baseUrl}${path}`, init)));
      if (!res || typeof res.status !== 'number') {
        throw new LLMError('bad_response', 'Ollama returned no HTTP response');
      }
      return { res, touch: arm, fail, close, race, abort: () => controller.abort() };
    } catch (err) {
      close();
      controller.abort();
      throw fail(err);
    }
  }

  // Turns a non-2xx response into an LLMError.
  async function httpError(req, { modelPath = false, model = '' } = {}) {
    let text = '';
    try {
      text = await req.race(req.res.text());
    } catch {
      /* body unreadable — status alone decides */
    }
    let message = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.error === 'string') message = parsed.error;
      else if (parsed && parsed.error && typeof parsed.error.message === 'string') message = parsed.error.message;
    } catch {
      /* not JSON */
    }
    message = String(message || '').trim().slice(0, 300);
    const status = req.res.status;
    if (modelPath && (status === 404 || looksLikeModelMissing(message))) {
      return new LLMError('model_missing', message || `model "${model}" not found`);
    }
    return new LLMError('bad_response', `Ollama HTTP ${status}${message ? `: ${message}` : ''}`);
  }

  function inlineError(obj, model) {
    const message = typeof obj.error === 'string' ? obj.error : JSON.stringify(obj.error);
    const text = String(message || '').slice(0, 300);
    return looksLikeModelMissing(text)
      ? new LLMError('model_missing', text || `model "${model}" not found`)
      : new LLMError('bad_response', `Ollama error: ${text}`);
  }

  // Yields raw byte/string chunks from a fetch body (web ReadableStream or async iterable).
  async function* bodyChunks(req) {
    const body = req.res.body;
    if (!body) return;
    if (typeof body.getReader === 'function') {
      const reader = body.getReader();
      try {
        for (;;) {
          const { done, value } = await req.race(reader.read());
          if (done) return;
          if (value !== undefined && value !== null) yield value;
        }
      } finally {
        try {
          const cancelled = reader.cancel();
          if (cancelled && typeof cancelled.catch === 'function') cancelled.catch(() => {});
        } catch {
          /* already closed */
        }
      }
    } else if (typeof body[Symbol.asyncIterator] === 'function') {
      const iterator = body[Symbol.asyncIterator]();
      try {
        for (;;) {
          const { done, value } = await req.race(iterator.next());
          if (done) return;
          if (value !== undefined && value !== null) yield value;
        }
      } finally {
        try {
          const returned = iterator.return && iterator.return();
          if (returned && typeof returned.catch === 'function') returned.catch(() => {});
        } catch {
          /* already closed */
        }
      }
    }
  }

  // Parses newline-delimited JSON, tolerating objects (and multi-byte characters) split across
  // chunks, CRLF, blank lines and a missing trailing newline. Unparseable lines are skipped.
  async function* ndjson(req, { onChunk } = {}) {
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    const parseLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return undefined;
      try {
        const obj = JSON.parse(trimmed);
        return obj && typeof obj === 'object' ? obj : undefined;
      } catch {
        return undefined;
      }
    };
    for await (const chunk of bodyChunks(req)) {
      if (onChunk) onChunk();
      buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const obj = parseLine(line);
        if (obj !== undefined) yield obj;
      }
    }
    buffer += decoder.decode();
    const last = parseLine(buffer);
    if (last !== undefined) yield last;
  }

  function chatBody({ model, messages, temperature, maxTokens, json, schema, stream }) {
    const temp = Number(temperature);
    const max = Number(maxTokens);
    const body = {
      model,
      messages: cleanMessages(messages),
      stream,
      options: {
        temperature: Number.isFinite(temp) ? temp : 0.3,
        num_predict: Number.isFinite(max) && max > 0 ? Math.floor(max) : 1024,
        num_ctx: numCtx,
        ...(numThread ? { num_thread: numThread } : {}),
      },
    };
    // `schema` (a JSON Schema object) asks Ollama for structured output; plain `json` asks for any JSON.
    if (schema && typeof schema === 'object') body.format = schema;
    else if (json) body.format = 'json';
    return body;
  }

  async function fetchTags(timeoutMs, signal) {
    const req = await open('/api/tags', { timeoutMs, signal });
    try {
      if (!req.res.ok) throw await httpError(req);
      let data;
      try {
        data = JSON.parse(await req.race(req.res.text()));
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        throw new LLMError('bad_response', 'Ollama /api/tags returned invalid JSON', { cause: err });
      }
      if (!data || !Array.isArray(data.models)) {
        throw new LLMError('bad_response', 'Ollama /api/tags returned an unexpected shape');
      }
      const ids = [];
      for (const m of data.models) {
        const id = m && (m.name || m.model);
        if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id);
      }
      return ids;
    } catch (err) {
      throw req.fail(err);
    } finally {
      req.close();
    }
  }

  // ---- public API -----------------------------------------------------------------------------

  async function chat({ model, messages, temperature = 0.3, maxTokens = 1024, json = false, schema, signal } = {}) {
    const useModel = model || defaultModel;
    const started = Date.now();
    const req = await open('/api/chat', {
      method: 'POST',
      body: chatBody({ model: useModel, messages, temperature, maxTokens, json, schema, stream: false }),
      timeoutMs: llmTimeoutMs,
      signal,
    });
    try {
      if (!req.res.ok) throw await httpError(req, { modelPath: true, model: useModel });
      const text = await req.race(req.res.text());
      let data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        throw new LLMError('bad_response', 'Ollama returned invalid JSON', { cause: err });
      }
      if (!data || typeof data !== 'object') throw new LLMError('bad_response', 'Ollama returned an unexpected body');
      if (data.error) throw inlineError(data, useModel);
      const content = data.message && data.message.content;
      if (typeof content !== 'string') {
        throw new LLMError('bad_response', 'Ollama response has no message.content');
      }
      return {
        content,
        model: typeof data.model === 'string' && data.model ? data.model : useModel,
        promptTokens: toCount(data.prompt_eval_count),
        completionTokens: toCount(data.eval_count),
        ms: Date.now() - started,
      };
    } catch (err) {
      throw req.fail(err);
    } finally {
      req.close();
      req.abort();
    }
  }

  async function* chatStream({ model, messages, temperature = 0.3, maxTokens = 1024, json = false, signal } = {}) {
    const useModel = model || defaultModel;
    const started = Date.now();
    // For streams the timeout is an idle timeout: it is re-armed on every received chunk,
    // so a long answer on a slow CPU is not cut off while tokens keep arriving.
    const req = await open('/api/chat', {
      method: 'POST',
      body: chatBody({ model: useModel, messages, temperature, maxTokens, json, stream: true }),
      timeoutMs: llmTimeoutMs,
      signal,
    });
    try {
      if (!req.res.ok) throw await httpError(req, { modelPath: true, model: useModel });
      let seen = 0;
      let finalChunk = null;
      let modelName = useModel;
      for await (const obj of ndjson(req, { onChunk: req.touch })) {
        seen += 1;
        if (obj.error) throw inlineError(obj, useModel);
        if (typeof obj.model === 'string' && obj.model) modelName = obj.model;
        const delta = obj.message && obj.message.content;
        if (typeof delta === 'string' && delta.length > 0) yield { delta };
        if (obj.done === true) {
          finalChunk = obj;
          break;
        }
      }
      if (seen === 0) throw new LLMError('bad_response', 'Ollama stream ended without data');
      yield {
        done: true,
        model: modelName,
        promptTokens: toCount(finalChunk && finalChunk.prompt_eval_count),
        completionTokens: toCount(finalChunk && finalChunk.eval_count),
        ms: Date.now() - started,
      };
    } catch (err) {
      throw req.fail(err);
    } finally {
      req.close();
      req.abort(); // releases the connection if the consumer stopped early
    }
  }

  async function models() {
    const ids = await fetchTags(Math.min(TAGS_TIMEOUT_MS, llmTimeoutMs));
    return ids.map((id) => ({ id }));
  }

  async function health() {
    const base = { ok: false, defaultModel, defaultModelReady: false, models: [], pulling: activePulls > 0 };
    try {
      const ids = await fetchTags(HEALTH_TIMEOUT_MS);
      return {
        ok: true,
        defaultModel,
        defaultModelReady: ids.some((id) => sameModel(id, defaultModel)),
        models: ids,
        pulling: activePulls > 0,
      };
    } catch (err) {
      // Only the error code is exposed: /health is public and messages may contain internal URLs.
      return { ...base, pulling: activePulls > 0, error: (err && err.code) || 'unreachable' };
    }
  }

  async function pull(model) {
    activePulls += 1;
    let req = null;
    try {
      req = await open('/api/pull', {
        method: 'POST',
        body: { model, stream: true },
        timeoutMs: pullTimeoutMs,
      });
      if (!req.res.ok) throw await httpError(req, { modelPath: true, model });
      let success = false;
      for await (const obj of ndjson(req)) {
        if (obj.error) throw inlineError(obj, model);
        if (obj.status === 'success') success = true;
      }
      return success;
    } finally {
      if (req) {
        req.close();
        req.abort();
      }
      activePulls -= 1;
    }
  }

  async function ensure(model) {
    try {
      const present = (await fetchTags(TAGS_TIMEOUT_MS)).some((id) => sameModel(id, model));
      if (present) return true;
      if (await pull(model)) return true;
      // Stream ended without an explicit "success" line — trust the model list instead.
      return (await fetchTags(TAGS_TIMEOUT_MS)).some((id) => sameModel(id, model));
    } catch {
      return false;
    }
  }

  // Not async on purpose: concurrent callers get the very same promise while work is in flight.
  function ensureModel(model) {
    const useModel = String(model || defaultModel || '').trim();
    if (!useModel) return Promise.resolve(false);
    const key = normalizeModelName(useModel);
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = ensure(useModel)
      .catch(() => false)
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, promise);
    return promise;
  }

  return {
    chat,
    chatStream,
    models,
    health,
    ensureModel,
    get pulling() {
      return activePulls > 0;
    },
  };
}
