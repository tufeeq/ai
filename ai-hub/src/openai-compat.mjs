// OpenAI-compatible gateway: GET /v1/models and POST /v1/chat/completions.
// Existing OpenAI SDK clients only change base URL + key. Zero dependencies and no import
// of sibling modules, so this file loads (and is testable) on its own.

import { randomBytes } from 'node:crypto';

const ROLE_MAP = { system: 'system', developer: 'system', user: 'user', assistant: 'assistant' };
const LLM_CODES = new Set(['unreachable', 'timeout', 'model_missing', 'bad_response']);
const MAX_SCHEMA_HINT_CHARS = 4000;

class ApiError extends Error {
  constructor(status, message, type = 'invalid_request_error', code = 'invalid_request', headers = {}) {
    super(message);
    this.status = status;
    this.type = type;
    this.code = code;
    this.headers = headers;
  }
}

const badRequest = (message, code = 'invalid_request') => new ApiError(400, message, 'invalid_request_error', code);

function sendOpenAIError(res, status, message, type, code, headers = {}) {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  const body = JSON.stringify({ error: { message, type, code } });
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, obj) {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// Maps any thrown value to an OpenAI-shaped error description.
function describeError(err, model) {
  if (err instanceof ApiError) {
    return { status: err.status, message: err.message, type: err.type, code: err.code, headers: err.headers };
  }
  const code = err?.code;
  const isLLM = err?.name === 'LLMError' || LLM_CODES.has(code);
  if (!isLLM) {
    return {
      status: 500,
      message: 'Internal error while generating the completion.',
      type: 'server_error',
      code: 'internal_error',
      headers: {},
    };
  }
  if (code === 'unreachable') {
    return {
      status: 503,
      message: 'The self-hosted model is not ready yet: the model server is not reachable. Try again shortly.',
      type: 'server_error',
      code: 'unreachable',
      headers: { 'Retry-After': '30' },
    };
  }
  if (code === 'model_missing') {
    return {
      status: 503,
      message: `The self-hosted model is not ready yet: model '${model}' is not installed or is still downloading. Try again shortly.`,
      type: 'server_error',
      code: 'model_missing',
      headers: { 'Retry-After': '30' },
    };
  }
  if (code === 'timeout') {
    return {
      status: 504,
      message: 'The self-hosted model did not answer in time (CPU-only server). Try a shorter prompt or a lower max_tokens.',
      type: 'server_error',
      code: 'timeout',
      headers: {},
    };
  }
  return {
    status: 502,
    message: 'The self-hosted model returned an invalid response.',
    type: 'server_error',
    code: typeof code === 'string' && code ? code : 'bad_response',
    headers: {},
  };
}

// Accepts string content or the array form [{ type:'text', text }]; anything else is a 400.
function contentToText(content, index) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      if (typeof part === 'string') {
        parts.push(part);
        continue;
      }
      const type = part && typeof part === 'object' ? part.type : undefined;
      if (type !== 'text' || typeof part.text !== 'string') {
        throw badRequest(
          `messages[${index}].content contains a '${type ?? typeof part}' part. This self-hosted model accepts text only (parts of type 'text').`,
          'unsupported_content_type',
        );
      }
      parts.push(part.text);
    }
    return parts.join('\n');
  }
  throw badRequest(`messages[${index}].content must be a string or an array of text parts.`, 'invalid_content');
}

function normalizeMessages(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw badRequest("'messages' must be a non-empty array.", 'invalid_messages');
  }
  const out = [];
  input.forEach((msg, index) => {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      throw badRequest(`messages[${index}] must be an object.`, 'invalid_messages');
    }
    if (msg.role === 'tool' || msg.role === 'function') {
      throw badRequest(
        `messages[${index}].role '${msg.role}' is not supported: this gateway does not implement tool calling.`,
        'unsupported_role',
      );
    }
    const role = typeof msg.role === 'string' && Object.hasOwn(ROLE_MAP, msg.role) ? ROLE_MAP[msg.role] : null;
    if (!role) {
      throw badRequest(
        `messages[${index}].role must be one of 'system', 'developer', 'user', 'assistant'.`,
        'invalid_role',
      );
    }
    if (msg.content === null || msg.content === undefined) {
      // Assistant turns that only carried tool calls have no text: skip them.
      if (role === 'assistant') return;
      throw badRequest(`messages[${index}].content is required.`, 'invalid_content');
    }
    out.push({ role, content: contentToText(msg.content, index) });
  });
  if (out.length === 0) throw badRequest("'messages' contains no usable text message.", 'invalid_messages');
  return out;
}

function parseRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('Request body must be a JSON object.', 'invalid_body');
  }
  const messages = normalizeMessages(body.messages);

  let temperature;
  if (body.temperature !== null && body.temperature !== undefined) {
    if (typeof body.temperature !== 'number' || !Number.isFinite(body.temperature) || body.temperature < 0 || body.temperature > 2) {
      throw badRequest("'temperature' must be a number between 0 and 2.", 'invalid_temperature');
    }
    temperature = body.temperature;
  }

  let maxTokens;
  const rawMax = body.max_completion_tokens ?? body.max_tokens;
  if (rawMax !== null && rawMax !== undefined) {
    if (!Number.isInteger(rawMax) || rawMax < 1) {
      throw badRequest("'max_tokens' / 'max_completion_tokens' must be a positive integer.", 'invalid_max_tokens');
    }
    maxTokens = rawMax;
  }

  if (body.n !== null && body.n !== undefined && body.n !== 1) {
    throw badRequest("Only 'n: 1' is supported.", 'unsupported_n');
  }
  if (body.stream !== null && body.stream !== undefined && typeof body.stream !== 'boolean') {
    throw badRequest("'stream' must be a boolean.", 'invalid_stream');
  }

  let json = false;
  const rf = body.response_format;
  if (rf !== null && rf !== undefined) {
    const type = rf && typeof rf === 'object' ? rf.type : undefined;
    if (type === 'json_object' || type === 'json_schema') {
      json = true;
      // json_schema is served as plain JSON mode; the schema is passed on as an instruction.
      const schema = type === 'json_schema' ? rf.json_schema?.schema : undefined;
      if (schema && typeof schema === 'object') {
        const text = JSON.stringify(schema);
        if (text.length <= MAX_SCHEMA_HINT_CHARS) {
          messages.push({
            role: 'system',
            content: `Respond with a single valid JSON object only, matching this JSON schema: ${text}`,
          });
        }
      }
    } else if (type !== 'text') {
      throw badRequest("'response_format.type' must be 'text', 'json_object' or 'json_schema'.", 'invalid_response_format');
    }
  }

  return {
    requestedModel: body.model,
    messages,
    temperature,
    maxTokens,
    json,
    stream: body.stream === true,
    includeUsage: body.stream_options?.include_usage === true,
  };
}

// Aborts the returned signal when the client goes away before the response is finished.
function watchDisconnect(req, res) {
  const ac = new AbortController();
  let finished = false;
  const onReqClose = () => {
    if (finished) return;
    // Node >= 16 emits 'close' on a request once its body has been read; that is not a
    // disconnect while the socket is still alive.
    if (req.complete === true && req.socket && !req.socket.destroyed) return;
    ac.abort();
  };
  const onResClose = () => {
    if (!finished && !res.writableFinished) ac.abort();
  };
  req.on?.('close', onReqClose);
  res.on?.('close', onResClose);
  return {
    signal: ac.signal,
    done() {
      finished = true;
      req.off?.('close', onReqClose);
      res.off?.('close', onResClose);
    },
  };
}

export function register(router, deps, opts = {}) {
  const { auth, limiter, llm, usage } = deps;
  const streamHeaderDelayMs = opts.streamHeaderDelayMs ?? 10000;
  const keepAliveMs = opts.keepAliveMs ?? 15000;
  const modelsCacheMs = opts.modelsCacheMs ?? 30000;

  let modelsCache = { at: 0, ids: null };

  async function installedModelIds({ fresh = false } = {}) {
    const now = Date.now();
    if (!fresh && modelsCache.ids && now - modelsCache.at < modelsCacheMs) return modelsCache.ids;
    const list = await llm.models();
    const ids = (Array.isArray(list) ? list : [])
      .map((m) => (typeof m === 'string' ? m : m?.id))
      .filter((id) => typeof id === 'string' && id);
    modelsCache = { at: now, ids };
    return ids;
  }

  // Installed model ids are used as-is; everything else (missing, gpt-*, o*, claude-*, unknown)
  // maps to the configured default model.
  async function resolveModel(requested, config) {
    const fallback = config.model;
    if (typeof requested !== 'string' || !requested.trim()) return fallback;
    const name = requested.trim();
    if (name === fallback) return fallback;
    let ids;
    try {
      ids = await installedModelIds();
    } catch {
      return fallback;
    }
    if (ids.includes(name)) return name;
    if (!name.includes(':') && ids.includes(`${name}:latest`)) return `${name}:latest`;
    return fallback;
  }

  function estimate(text) {
    if (!text) return 0;
    try {
      const n = usage?.estimateTokens?.(text);
      if (Number.isFinite(n) && n > 0) return Math.round(n);
    } catch { /* fall through to the local estimate */ }
    return Math.max(1, Math.ceil(String(text).length / 4));
  }

  const validCount = (n) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
  const promptCount = (reported, messages) =>
    validCount(reported) || messages.reduce((sum, m) => sum + estimate(m.content), 0);
  const completionCount = (reported, text) => validCount(reported) || estimate(text);

  function recordUsage(identity, model, promptTokens, completionTokens, ms, ok) {
    try {
      usage?.record?.({
        keyId: identity.keyId,
        project: identity.project,
        kind: 'openai',
        model,
        promptTokens,
        completionTokens,
        ms,
        ok,
      });
    } catch { /* usage accounting must never break a response */ }
  }

  // Shared preamble: auth (guard answers 401/403 itself) then rate limit.
  async function admit(ctx) {
    const identity = await auth.guard(ctx);
    if (!identity) return null;
    const verdict = (await limiter?.check?.(identity.keyId)) ?? { ok: true };
    if (!verdict.ok) {
      const retryAfter = Math.max(1, Math.ceil(Number(verdict.retryAfterSec) || 1));
      sendOpenAIError(
        ctx.res,
        429,
        `Rate limit reached for this key. Retry after ${retryAfter} seconds.`,
        'rate_limit_error',
        'rate_limit_exceeded',
        { 'Retry-After': String(retryAfter) },
      );
      return null;
    }
    return identity;
  }

  const finishReason = (maxTokens, reportedCompletion) =>
    maxTokens && validCount(reportedCompletion) >= maxTokens ? 'length' : 'stop';

  function llmArgs(p, model, signal) {
    const args = { model, messages: p.messages, signal };
    if (p.temperature !== undefined) args.temperature = p.temperature;
    if (p.maxTokens !== undefined) args.maxTokens = p.maxTokens;
    return args;
  }

  async function completeOnce(ctx, identity, p, model) {
    const { req, res } = ctx;
    const watch = watchDisconnect(req, res);
    const started = Date.now();
    try {
      const args = llmArgs(p, model, watch.signal);
      if (p.json) args.json = true;
      const result = await llm.chat(args);
      const content = typeof result?.content === 'string' ? result.content : '';
      const promptTokens = promptCount(result?.promptTokens, p.messages);
      const completionTokens = completionCount(result?.completionTokens, content);
      const usedModel = result?.model || model;
      recordUsage(identity, usedModel, promptTokens, completionTokens, result?.ms ?? Date.now() - started, true);
      if (watch.signal.aborted) return;
      sendJson(res, 200, {
        id: `chatcmpl-${randomBytes(12).toString('hex')}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: usedModel,
        choices: [{
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: finishReason(p.maxTokens, result?.completionTokens),
        }],
        usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
      });
    } catch (err) {
      const ms = Date.now() - started;
      if (watch.signal.aborted) {
        // Client went away: nothing to answer.
        recordUsage(identity, model, promptCount(0, p.messages), 0, ms, true);
        return;
      }
      recordUsage(identity, model, promptCount(0, p.messages), 0, ms, false);
      const d = describeError(err, model);
      sendOpenAIError(res, d.status, d.message, d.type, d.code, d.headers);
    } finally {
      watch.done();
    }
  }

  // JSON mode has no streaming variant in the llm contract: generate once, emit as one chunk.
  async function* jsonAsStream(args) {
    const result = await llm.chat({ ...args, json: true });
    if (typeof result?.content === 'string' && result.content) yield { delta: result.content };
    yield {
      done: true,
      model: result?.model,
      promptTokens: result?.promptTokens,
      completionTokens: result?.completionTokens,
      ms: result?.ms,
    };
  }

  async function completeStream(ctx, identity, p, model) {
    const { req, res } = ctx;
    const watch = watchDisconnect(req, res);
    const started = Date.now();
    const id = `chatcmpl-${randomBytes(12).toString('hex')}`;
    const created = Math.floor(Date.now() / 1000);
    let opened = false;
    let text = '';
    let final = null;
    let keepAlive = null;

    const writable = () => !res.destroyed && !res.writableEnded;
    const sendChunk = (choices, extra = {}) => {
      if (!writable()) return;
      const chunk = { id, object: 'chat.completion.chunk', created, model, choices };
      if (p.includeUsage) chunk.usage = null;
      res.write(`data: ${JSON.stringify({ ...chunk, ...extra })}\n\n`);
    };
    const open = () => {
      if (opened || !writable()) return;
      opened = true;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      });
      sendChunk([{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]);
      if (keepAliveMs > 0) {
        keepAlive = setInterval(() => { if (writable()) res.write(': keep-alive\n\n'); }, keepAliveMs);
        keepAlive.unref?.();
      }
    };

    const abortError = new Error('client disconnected');
    const aborted = new Promise((_, reject) => {
      if (watch.signal.aborted) reject(abortError);
      else watch.signal.addEventListener('abort', () => reject(abortError), { once: true });
    });
    aborted.catch(() => {});

    let iterator = null;
    let headerTimer = null;
    try {
      const args = llmArgs(p, model, watch.signal);
      const source = p.json ? jsonAsStream(args) : llm.chatStream(args);
      iterator = source[Symbol.asyncIterator]();
      const next = () => {
        const step = Promise.resolve(iterator.next());
        step.catch(() => {});
        return Promise.race([step, aborted]);
      };

      // Hold the headers back briefly so early failures (model not ready, server down)
      // still get a real HTTP status; after the delay, open the stream to keep proxies happy.
      headerTimer = setTimeout(open, streamHeaderDelayMs);
      headerTimer.unref?.();

      for (;;) {
        const { value, done } = await next();
        if (done) break;
        clearTimeout(headerTimer);
        open();
        if (value?.done) {
          final = value;
        } else if (typeof value?.delta === 'string' && value.delta) {
          text += value.delta;
          sendChunk([{ index: 0, delta: { content: value.delta }, finish_reason: null }]);
        }
      }
      clearTimeout(headerTimer);
      open();

      const promptTokens = promptCount(final?.promptTokens, p.messages);
      const completionTokens = completionCount(final?.completionTokens, text);
      recordUsage(identity, final?.model || model, promptTokens, completionTokens, final?.ms ?? Date.now() - started, true);

      sendChunk([{ index: 0, delta: {}, finish_reason: finishReason(p.maxTokens, final?.completionTokens) }]);
      if (p.includeUsage) {
        sendChunk([], {
          usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
        });
      }
      if (writable()) {
        res.write('data: [DONE]\n\n');
        res.end();
      }
    } catch (err) {
      clearTimeout(headerTimer);
      const ms = Date.now() - started;
      const promptTokens = promptCount(0, p.messages);
      const completionTokens = completionCount(0, text);
      if (watch.signal.aborted) {
        // Client went away mid-generation: stop the model, account for what was produced.
        Promise.resolve(iterator?.return?.()).catch(() => {});
        recordUsage(identity, model, promptTokens, completionTokens, ms, true);
        if (opened && writable()) res.end();
        return;
      }
      recordUsage(identity, model, promptTokens, completionTokens, ms, false);
      const d = describeError(err, model);
      if (!opened) {
        sendOpenAIError(res, d.status, d.message, d.type, d.code, d.headers);
      } else if (writable()) {
        res.write(`data: ${JSON.stringify({ error: { message: d.message, type: d.type, code: d.code } })}\n\n`);
        res.end();
      }
    } finally {
      clearTimeout(headerTimer);
      if (keepAlive) clearInterval(keepAlive);
      watch.done();
    }
  }

  router.add('GET', '/v1/models', async (ctx) => {
    const identity = await admit(ctx);
    if (!identity) return;
    let ids;
    try {
      ids = await installedModelIds({ fresh: true });
    } catch (err) {
      const d = describeError(err, (ctx.config ?? deps.config).model);
      sendOpenAIError(ctx.res, d.status, d.message, d.type, d.code, d.headers);
      return;
    }
    sendJson(ctx.res, 200, {
      object: 'list',
      data: ids.map((id) => ({ id, object: 'model', owned_by: 'ai-hub' })),
    });
  });

  router.add('POST', '/v1/chat/completions', async (ctx) => {
    const identity = await admit(ctx);
    if (!identity) return;
    const config = ctx.config ?? deps.config;

    let p;
    try {
      let body;
      try {
        body = await ctx.json();
      } catch (err) {
        const status = err?.status === 413 ? 413 : 400;
        throw new ApiError(
          status,
          status === 413 ? 'Request body is too large.' : 'Request body must be valid JSON.',
          'invalid_request_error',
          typeof err?.code === 'string' && err.code ? err.code : 'invalid_json',
        );
      }
      p = parseRequest(body);
    } catch (err) {
      const d = describeError(err, config.model);
      sendOpenAIError(ctx.res, d.status, d.message, d.type, d.code, d.headers);
      return;
    }

    const model = await resolveModel(p.requestedModel, config);
    if (p.stream) await completeStream(ctx, identity, p, model);
    else await completeOnce(ctx, identity, p, model);
  });
}
