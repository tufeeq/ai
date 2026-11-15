// Anthropic Messages API compatibility layer (subset) in front of the self-hosted model.
//
//   POST /v1/messages               text answers, JSON-schema output, single-tool structured output
//   POST /v1/messages/count_tokens  token estimate
//
// Projects built on the Anthropic SDK point ANTHROPIC_BASE_URL at the hub origin (no /v1 suffix) and
// use a hub key as the API key. What is supported, and what is refused with a clear 400:
//
//   supported   system (string or text blocks), text messages, temperature, max_tokens, stop_sequences
//               (non-stream), stream, output_config.format = { type:'json_schema', schema },
//               ONE custom tool (the answer is returned as a tool_use block matching its input_schema)
//   accepted    thinking, output_config.effort, cache_control, metadata, top_p, top_k, service_tier
//   and ignored (they have no meaning for the local model)
//   refused     images, documents, tool_result turns, several tools chosen by the model,
//               server tools such as web search, prompts larger than the model's context window
//
// The local model is small: it does not browse, does not see files and is weaker than Claude.
// The refusals above are deliberate so callers fall back instead of receiving a degraded answer silently.

import { randomBytes } from 'node:crypto';

const MAX_OUTPUT_TOKENS = 4096;
const ANSWER_RESERVE_TOKENS = 256;

class ApiError extends Error {
  constructor(status, type, message, headers) {
    super(message);
    this.status = status;
    this.type = type;
    this.headers = headers;
  }
}

const bad = (message) => new ApiError(400, 'invalid_request_error', message);
const newId = (prefix) => prefix + randomBytes(12).toString('base64url');

function sendError(res, err) {
  if (res.headersSent) return;
  const status = err.status || 500;
  const body = JSON.stringify({ type: 'error', error: { type: err.type || 'api_error', message: err.message } });
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(err.headers || {}),
  });
  res.end(body);
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

/** Map errors from the model client to Anthropic-shaped errors. */
function fromLLMError(err) {
  const code = err && err.code;
  if (code === 'unreachable' || code === 'model_missing') {
    return new ApiError(503, 'api_error', 'The self-hosted model is not ready yet. Try again shortly.');
  }
  if (code === 'timeout') return new ApiError(504, 'api_error', 'The self-hosted model took too long to answer.');
  if (code === 'bad_response') return new ApiError(502, 'api_error', 'The self-hosted model returned an unusable answer.');
  return null;
}

/** Join the text of a content value (string or blocks); refuse what the local model cannot handle. */
function textOf(content, where) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) throw bad(`${where}: content must be a string or an array of blocks`);
  const parts = [];
  for (const block of content) {
    const type = block && block.type;
    if (type === 'text') {
      if (typeof block.text !== 'string') throw bad(`${where}: text block without text`);
      parts.push(block.text);
    } else if (type === 'thinking' || type === 'redacted_thinking') {
      // earlier reasoning blocks carry nothing the local model can use
    } else if (type === 'image' || type === 'document') {
      throw bad('Images and documents are not supported by the self-hosted model.');
    } else if (type === 'tool_use' || type === 'tool_result' || type === 'server_tool_use') {
      throw bad('Multi-step tool use is not supported by the self-hosted model.');
    } else {
      throw bad(`${where}: unsupported content block type "${String(type).slice(0, 40)}"`);
    }
  }
  return parts.join('\n');
}

/** Decide how the answer must be shaped: plain text, JSON text, or one tool_use block. */
function outputMode(body) {
  const choice = body.tool_choice && body.tool_choice.type;
  const tools = Array.isArray(body.tools) && choice !== 'none' ? body.tools : [];
  for (const t of tools) {
    const custom = t && (t.type === undefined || t.type === 'custom') && t.input_schema && typeof t.input_schema === 'object';
    if (!custom) throw bad('Server tools such as web search are not supported by the self-hosted model.');
    if (typeof t.name !== 'string' || !t.name) throw bad('tools: every tool needs a name');
  }
  if (tools.length) {
    let tool = tools.length === 1 ? tools[0] : null;
    if (choice === 'tool') {
      tool = tools.find((t) => t.name === body.tool_choice.name) || null;
      if (!tool) throw bad('tool_choice names a tool that is not in tools');
    }
    if (!tool) throw bad('Several tools chosen by the model are not supported by the self-hosted model; send one tool.');
    return { kind: 'tool', name: tool.name, schema: tool.input_schema, description: tool.description };
  }
  const format = body.output_config && body.output_config.format;
  if (format !== undefined && format !== null) {
    if (format.type !== 'json_schema' || !format.schema || typeof format.schema !== 'object') {
      throw bad('output_config.format must be { type: "json_schema", schema }');
    }
    return { kind: 'json', schema: format.schema };
  }
  return { kind: 'text' };
}

/** Pull one JSON object out of a model answer, tolerating code fences and stray prose. */
export function parseObject(text) {
  if (typeof text !== 'string') return null;
  const tryParse = (s) => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(text.trim());
  if (direct) return direct;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? tryParse(text.slice(start, end + 1)) : null;
}

function missingRequired(schema, obj) {
  const required = schema && Array.isArray(schema.required) ? schema.required : [];
  return required.filter((key) => typeof key === 'string' && !(key in obj));
}

function parseRequest(body, deps) {
  const { config, usage } = deps;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('The request body must be a JSON object');
  if (!Array.isArray(body.messages) || body.messages.length === 0) throw bad('messages: at least one message is required');

  let system = '';
  if (typeof body.system === 'string') system = body.system;
  else if (Array.isArray(body.system)) system = textOf(body.system, 'system');
  else if (body.system !== undefined && body.system !== null) throw bad('system must be a string or an array of text blocks');

  const messages = [];
  body.messages.forEach((m, i) => {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) throw bad(`messages.${i}: role must be "user" or "assistant"`);
    const text = textOf(m.content, `messages.${i}`);
    if (text.trim()) messages.push({ role: m.role, content: text });
  });
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    throw bad('messages: the conversation must end with a non-empty user message');
  }

  const mode = outputMode(body);
  if (mode.kind !== 'text') {
    const schemaText = JSON.stringify(mode.schema);
    const purpose = mode.kind === 'tool' && typeof mode.description === 'string' && mode.description
      ? `\nPurpose of the object: ${mode.description.slice(0, 600)}`
      : '';
    system = `${system}\n\nReply with exactly one JSON object and nothing else. It must conform to this JSON Schema:\n${schemaText}${purpose}`.trim();
  }

  let maxTokens = Number(body.max_tokens);
  if (!Number.isFinite(maxTokens) || maxTokens < 1) maxTokens = 1024;
  maxTokens = Math.min(Math.floor(maxTokens), MAX_OUTPUT_TOKENS);

  let temperature = Number(body.temperature);
  temperature = Number.isFinite(temperature) ? Math.min(Math.max(temperature, 0), 1) : 0.3;

  const stops = Array.isArray(body.stop_sequences)
    ? body.stop_sequences.filter((s) => typeof s === 'string' && s).slice(0, 8)
    : [];

  const llmMessages = system ? [{ role: 'system', content: system }, ...messages] : messages;
  const inputTokens = llmMessages.reduce((n, m) => n + usage.estimateTokens(m.content) + 4, 0);
  const limit = Math.max(256, Number(config.numCtx) - ANSWER_RESERVE_TOKENS);
  if (inputTokens > limit) {
    throw bad(`prompt is too long for the self-hosted model: about ${inputTokens} tokens, limit ${limit}.`);
  }

  return { mode, llmMessages, maxTokens, temperature, stops, inputTokens, stream: body.stream === true, requestedModel: body.model };
}

async function resolveModel(requested, deps) {
  if (typeof requested === 'string' && requested && requested !== deps.config.model) {
    try {
      const installed = await deps.llm.models();
      if (installed.some((m) => m.id === requested)) return requested;
    } catch {
      // fall through to the default model; the chat call reports the real problem
    }
  }
  return deps.config.model;
}

/** Run the model for a structured answer, retrying once when the JSON is unusable. */
async function generateObject(req, model, deps, signal) {
  const totals = { promptTokens: 0, completionTokens: 0 };
  let lastProblem = 'no JSON object in the answer';
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages = attempt === 0
      ? req.llmMessages
      : [...req.llmMessages, { role: 'user', content: `Your previous reply was not usable (${lastProblem}). Reply again with only the JSON object.` }];
    const out = await deps.llm.chat({
      model, messages, temperature: attempt === 0 ? req.temperature : 0.1, maxTokens: req.maxTokens,
      json: true, schema: req.mode.schema, signal,
    });
    totals.promptTokens += out.promptTokens || 0;
    totals.completionTokens += out.completionTokens || 0;
    const obj = parseObject(out.content);
    if (obj) {
      const missing = missingRequired(req.mode.schema, obj);
      if (!missing.length) return { obj, ...totals, model: out.model || model };
      lastProblem = `missing required keys: ${missing.slice(0, 8).join(', ')}`;
    }
  }
  const err = new ApiError(502, 'api_error', `The self-hosted model did not return valid JSON for the requested schema (${lastProblem}).`);
  err.totals = totals;
  throw err;
}

function messageEnvelope({ id, model, content, stopReason, stopSequence = null, inputTokens, outputTokens }) {
  return {
    id, type: 'message', role: 'assistant', model, content,
    stop_reason: stopReason, stop_sequence: stopSequence,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

function openSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });
  return (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function register(router, deps) {
  const { auth, limiter, usage, llm, config } = deps;

  function authorize(ctx) {
    const identity = auth.verify(ctx.req);
    if (!identity || !identity.ok) throw new ApiError(401, 'authentication_error', 'invalid x-api-key');
    const limit = limiter.check(identity.keyId);
    if (!limit.ok) {
      throw new ApiError(429, 'rate_limit_error', 'Rate limit reached for this key.', { 'Retry-After': String(limit.retryAfterSec || 1) });
    }
    return identity;
  }

  async function readBody(ctx) {
    try {
      return await ctx.json();
    } catch (err) {
      if (err && err.status === 413) throw new ApiError(413, 'request_too_large', 'The request body is too large.');
      throw bad('The request body is not valid JSON');
    }
  }

  function record(identity, model, started, ok, promptTokens, completionTokens, req, outputText) {
    usage.record({
      keyId: identity.keyId, project: identity.project, kind: 'anthropic', model,
      promptTokens: promptTokens || (req ? req.inputTokens : 0),
      completionTokens: completionTokens || (outputText ? usage.estimateTokens(outputText) : 0),
      ms: Date.now() - started, ok,
    });
  }

  router.add('POST', '/v1/messages/count_tokens', async (ctx) => {
    try {
      authorize(ctx);
      const req = parseRequest({ ...(await readBody(ctx)), max_tokens: 1 }, { ...deps, config: { ...config, numCtx: Number.MAX_SAFE_INTEGER } });
      sendJson(ctx.res, 200, { input_tokens: req.inputTokens });
    } catch (err) {
      sendError(ctx.res, err instanceof ApiError ? err : new ApiError(500, 'api_error', 'Internal error'));
    }
  });

  router.add('POST', '/v1/messages', async (ctx) => {
    const { res } = ctx;
    const started = Date.now();
    let identity = null;
    let req = null;
    let model = config.model;
    const abort = new AbortController();
    const onClose = () => { if (!res.writableEnded) abort.abort(); };
    res.on('close', onClose);

    try {
      identity = authorize(ctx);
      req = parseRequest(await readBody(ctx), deps);
      model = await resolveModel(req.requestedModel, deps);
      const id = newId('msg_');

      // ---- structured answers: generated in one piece, then returned (or replayed as a stream) ----
      if (req.mode.kind !== 'text') {
        const out = await generateObject(req, model, deps, abort.signal);
        const jsonText = JSON.stringify(out.obj);
        const inputTokens = out.promptTokens || req.inputTokens;
        const outputTokens = out.completionTokens || usage.estimateTokens(jsonText);
        const block = req.mode.kind === 'tool'
          ? { type: 'tool_use', id: newId('toolu_'), name: req.mode.name, input: out.obj }
          : { type: 'text', text: jsonText };
        const stopReason = req.mode.kind === 'tool' ? 'tool_use' : 'end_turn';
        record(identity, out.model, started, true, inputTokens, outputTokens, req, jsonText);

        if (!req.stream) {
          sendJson(res, 200, messageEnvelope({ id, model: out.model, content: [block], stopReason, inputTokens, outputTokens }));
          return;
        }
        const send = openSSE(res);
        send('message_start', { type: 'message_start', message: messageEnvelope({ id, model: out.model, content: [], stopReason: null, inputTokens, outputTokens: 0 }) });
        if (req.mode.kind === 'tool') {
          send('content_block_start', { type: 'content_block_start', index: 0, content_block: { ...block, input: {} } });
          send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: jsonText } });
        } else {
          send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
          send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: jsonText } });
        }
        send('content_block_stop', { type: 'content_block_stop', index: 0 });
        send('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } });
        send('message_stop', { type: 'message_stop' });
        res.end();
        return;
      }

      // ---- plain text, not streamed ----
      if (!req.stream) {
        const out = await llm.chat({ model, messages: req.llmMessages, temperature: req.temperature, maxTokens: req.maxTokens, signal: abort.signal });
        let text = out.content;
        if (!text.trim()) throw new ApiError(502, 'api_error', 'The self-hosted model returned an empty answer.');
        let stopReason = (out.completionTokens || 0) >= req.maxTokens ? 'max_tokens' : 'end_turn';
        let stopSequence = null;
        for (const s of req.stops) {
          const at = text.indexOf(s);
          if (at >= 0) { text = text.slice(0, at); stopReason = 'stop_sequence'; stopSequence = s; }
        }
        const inputTokens = out.promptTokens || req.inputTokens;
        const outputTokens = out.completionTokens || usage.estimateTokens(text);
        record(identity, out.model || model, started, true, inputTokens, outputTokens, req, text);
        sendJson(res, 200, messageEnvelope({ id, model: out.model || model, content: [{ type: 'text', text }], stopReason, stopSequence, inputTokens, outputTokens }));
        return;
      }

      // ---- plain text, streamed. The first chunk is awaited before headers so early failures get a real status. ----
      const iterator = llm.chatStream({ model, messages: req.llmMessages, temperature: req.temperature, maxTokens: req.maxTokens, signal: abort.signal })[Symbol.asyncIterator]();
      let step = await iterator.next();
      const send = openSSE(res);
      send('message_start', { type: 'message_start', message: messageEnvelope({ id, model, content: [], stopReason: null, inputTokens: req.inputTokens, outputTokens: 0 }) });
      send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      send('ping', { type: 'ping' });
      let text = '';
      let final = null;
      try {
        while (!step.done) {
          const chunk = step.value;
          if (chunk && chunk.done) final = chunk;
          else if (chunk && typeof chunk.delta === 'string' && chunk.delta) {
            text += chunk.delta;
            send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk.delta } });
          }
          step = await iterator.next();
        }
      } catch (err) {
        record(identity, model, started, abort.signal.aborted, 0, 0, req, text);
        if (!res.writableEnded) {
          const mapped = fromLLMError(err) || new ApiError(500, 'api_error', 'The stream failed.');
          send('error', { type: 'error', error: { type: mapped.type, message: mapped.message } });
          res.end();
        }
        return;
      }
      const outputTokens = (final && final.completionTokens) || usage.estimateTokens(text);
      const stopReason = outputTokens >= req.maxTokens ? 'max_tokens' : 'end_turn';
      send('content_block_stop', { type: 'content_block_stop', index: 0 });
      send('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } });
      send('message_stop', { type: 'message_stop' });
      res.end();
      record(identity, (final && final.model) || model, started, true, (final && final.promptTokens) || req.inputTokens, outputTokens, req, text);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : fromLLMError(err) || new ApiError(500, 'api_error', 'Internal error');
      // Requests rejected before the model ran (auth, validation) are not usage.
      if (identity && req && apiErr.status >= 500 && !abort.signal.aborted) {
        const t = err && err.totals;
        record(identity, model, started, false, t ? t.promptTokens : 0, t ? t.completionTokens : 0, req, '');
      }
      if (res.headersSent) { if (!res.writableEnded) res.end(); } else sendError(res, apiErr);
    } finally {
      res.off('close', onClose);
    }
  });
}
