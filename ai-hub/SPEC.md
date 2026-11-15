# AI Hub — build contract (v1)

Self-hosted AI service for all of the owner's projects. Runs an open-source model
through Ollama on the owner's own VPS (Dokploy, CPU only). **No paid AI API anywhere.**

Three jobs:
1. **OpenAI-compatible gateway** (`/v1/chat/completions`) so any project swaps
   `OPENAI_BASE_URL` + key and stops paying per token.
2. **Chat assistant** (web UI, Arabic + English, RTL) with per-project knowledge.
3. **TAGit stock analysis** endpoint producing the same JSON shape as
   `tag/data/ai-stock-analysis.json` (schemaVersion 4), using free news sources.

## Hard rules for every module

- Node.js 22, ES modules (`.mjs`), **zero npm dependencies** — only Node built-ins
  (`node:http`, `node:fs`, `node:crypto`, `node:test`, global `fetch`, ...).
- Everything lives under `ai-hub/`. Each agent writes ONLY the files it owns.
  Never edit another agent's file; never run `git` commands; never `npm install`.
- Every factory takes one options object and must work with fakes in tests.
- No secrets in the repo (the repo is PUBLIC). Config comes from env only.
- Never invent market data or news. If the model fails, say so explicitly —
  no rules-based text presented as AI output.
- Unit tests: `ai-hub/tests/<module>.test.mjs` using `node:test` + `node:assert/strict`.
  Tests must not need network or a real Ollama. Run with `node --test "ai-hub/tests/*.test.mjs"`.
- Code comments and identifiers in English. User-facing UI text bilingual (ar/en).

## Layout and ownership

```
ai-hub/
  SPEC.md                       contract (do not edit)
  package.json, server.mjs, src/config.mjs, src/router.mjs      [A1]
  Dockerfile, docker-compose.yml, .env.example, .dockerignore   [A2]
  src/auth.mjs                                                  [A3]
  src/store.mjs                                                 [A4]
  src/usage.mjs                                                 [A5]
  src/llm.mjs                                                   [A6]
  src/openai-compat.mjs                                         [A7]
  src/knowledge.mjs                                             [A8]
  src/projects.mjs, projects.json                               [A9]
  src/chat.mjs                                                  [A10]
  src/research.mjs                                              [A11]
  src/tagit.mjs                                                 [A12]
  src/admin.mjs                                                 [A13]
  src/ratelimit.mjs                                             [A14]
  public/index.html, public/chat.js, public/styles.css          [A15]
  public/admin.html, public/admin.js, public/admin.css          [A16]
  knowledge/build-knowledge.mjs (+ generated knowledge/index.json) [A17]
  ../.github/workflows/tagit-ai-stock-analysis-free.yml, scripts/tagit-analyze.py [A18]
  README.md, DEPLOY.md, clients/*                               [A19]
  tests/mock-ollama.mjs, tests/integration.test.mjs, scripts/smoke.mjs [A20]
```

## Config — `src/config.mjs`

`export function loadConfig(env = process.env)` returns a frozen object:

| field | env | default |
|---|---|---|
| port | PORT | 8080 |
| dataDir | DATA_DIR | `./data` |
| ollamaUrl | OLLAMA_URL | `http://ollama:11434` |
| model | AI_MODEL | `qwen2.5:3b` |
| numCtx | AI_NUM_CTX | 4096 |
| llmTimeoutMs | LLM_TIMEOUT_MS | 180000 |
| adminKey | ADMIN_KEY | `''` (auth generates one, see auth) |
| rateLimitRpm | RATE_LIMIT_RPM | 60 |
| maxBodyBytes | MAX_BODY_BYTES | 1000000 |
| refPriceInPerM | REF_PRICE_IN_PER_M | 2.5 (USD per 1M input tokens, reference only) |
| refPriceOutPerM | REF_PRICE_OUT_PER_M | 10 (USD per 1M output tokens, reference only) |
| knowledgePath | KNOWLEDGE_PATH | `<ai-hub>/knowledge/index.json` |
| projectsPath | PROJECTS_PATH | `<ai-hub>/projects.json` |
| publicDir | — | `<ai-hub>/public` |
| autoPullModel | AUTO_PULL_MODEL | true |
| version | — | from package.json |

## Router — `src/router.mjs`

```js
export function createRouter({ config })
// router.add(method, pattern, handler)   pattern supports ':param' segments, e.g. '/api/admin/keys/:id'
// router.handle(req, res)                returns Promise<boolean> (true if a route matched)
// handler: async (ctx) => void
// ctx = { req, res, url /*URL*/, params, query /*plain object*/, config,
//         json: async () => parsedBody   // throws HttpError(400|413)
//       }
export class HttpError extends Error { constructor(status, code, message) }
export function sendJson(res, status, obj)
export function sendError(res, status, code, message)   // body: { error: { code, message } }
export function startSSE(res)   // sets headers, returns { send(obj) /* writes `data: <json>\n\n` */, close() }
export function serveStatic(publicDir)  // returns handler(req,res) => Promise<boolean>; no path traversal
```
Uncaught handler errors → `sendError(res, err.status||500, err.code||'internal', ...)` (if headers not sent).

## Dependency wiring — `server.mjs` (exact order)

```js
const config    = loadConfig();
const store     = createStore({ dataDir: config.dataDir });        // src/store.mjs
const auth      = createAuth({ config, store });                   // src/auth.mjs
const usage     = createUsage({ config, store });                  // src/usage.mjs
const llm       = createLLM({ config });                           // src/llm.mjs
const knowledge = await createKnowledge({ config });               // src/knowledge.mjs
const projects  = createProjects({ config });                      // src/projects.mjs
const research  = createResearch({ config, store });               // src/research.mjs
const limiter   = createLimiter({ config });                       // src/ratelimit.mjs
const deps = { config, store, auth, usage, llm, knowledge, projects, research, limiter };
const router = createRouter({ config });
registerOpenAI(router, deps);   // src/openai-compat.mjs  export function register(router, deps)
registerChat(router, deps);     // src/chat.mjs           export function register(router, deps)
registerTagit(router, deps);    // src/tagit.mjs          export function register(router, deps)
registerAdmin(router, deps);    // src/admin.mjs          export function register(router, deps)
```
`server.mjs` also: applies `limiter.securityHeaders(res)` to every response, serves
`GET /health` (public) → `{ ok, version, llm: await llm.health() }`, serves static files
(`/` → index.html, `/admin` → admin.html), 404 JSON for unknown `/api` or `/v1` paths,
calls `llm.ensureModel(config.model)` in the background on boot when `autoPullModel`,
handles SIGTERM (flush store, close server). `export async function createApp(overrides = {})`
returns `{ server, deps, router, close() }` WITHOUT listening, where `overrides` may replace
any dep or config field (tests use this); the file listens only when run directly.

## Modules

### store — `createStore({ dataDir })`
- `get(name, fallback)` → live in-memory value of collection `name`, loaded once from `<dataDir>/<name>.json` (fallback if missing/corrupt).
- `set(name, value)` → replaces value, schedules a debounced atomic write (tmp file + rename).
- `appendLine(name, obj)` → appends one JSON line to `<dataDir>/<name>.jsonl` (sync, small).
- `readLines(name, { limit = 10000 } = {})` → array of parsed objects (last `limit`), skipping bad lines.
- `flush()` → Promise, writes all pending. Creates `dataDir` if missing. `name` must match `/^[a-z0-9-]+$/`.

### auth — `createAuth({ config, store })`
- Key format: `hub_` + 32 base64url chars. Stored only as sha256 hex in store collection `keys`
  (`[{ id, name, project, hash, createdAt, revoked }]`).
- `adminKey`: `config.adminKey` if set; else load/generate `<dataDir>/admin.key` (mode 600) and
  log once: `ADMIN KEY (save it): ...`.
- `verify(req)` → `{ ok:true, role:'admin'|'project', keyId, project, name }` or `{ ok:false }`.
  Reads `Authorization: Bearer <key>` or `x-api-key`. Constant-time compare. Admin has project `'*'`.
- `guard(ctx, role = 'project')` → identity, or sends 401 (`unauthorized`) / 403 (`forbidden`) and returns `null`.
  Admin passes every guard.
- `createKey({ name, project })` → `{ id, key, name, project, createdAt }` (plain key returned once).
- `listKeys()` → without hashes. `revokeKey(id)` → boolean.

### usage — `createUsage({ config, store })`
- `estimateTokens(text)` → integer (≈ chars/4 Latin, chars/2 Arabic script; min 1 for non-empty).
- `record({ keyId, project, kind /*'openai'|'chat'|'tagit'*/, model, promptTokens, completionTokens, ms, ok })`
  → appends to store lines `usage` with `ts` ISO.
- `summary({ days = 30 } = {})` → `{ days, reference: { inPerM, outPerM }, totals: { requests, errors,
  promptTokens, completionTokens, savedUSD }, byProject: [{ project, requests, promptTokens,
  completionTokens, savedUSD }], byDay: [{ day /*YYYY-MM-DD*/, requests, promptTokens, completionTokens, savedUSD }],
  byKind: [{ kind, requests }] }`. `savedUSD` = tokens × reference prices (an estimate, labelled as such).

### llm — `createLLM({ config, fetchImpl = fetch })`  (Ollama native API)
- `chat({ model, messages, temperature = 0.3, maxTokens = 1024, json = false, signal })`
  → `{ content, model, promptTokens, completionTokens, ms }`. Throws `LLMError` (`.code`: `'unreachable'|'timeout'|'model_missing'|'bad_response'`).
  Uses `POST /api/chat` with `stream:false`, `format:'json'` when `json`, `options:{ temperature, num_predict, num_ctx }`.
- `chatStream({ model, messages, temperature, maxTokens, signal })` → async generator yielding
  `{ delta }` chunks, then one final `{ done:true, model, promptTokens, completionTokens, ms }`.
- `models()` → `[{ id }]` from `GET /api/tags`.
- `health()` → `{ ok, defaultModel, defaultModelReady, models: [id], pulling: boolean, error? }` (never throws).
- `ensureModel(model)` → Promise<boolean>; pulls via `POST /api/pull` if absent; never throws; sets `pulling`.
- `model` defaults to `config.model` everywhere. `export class LLMError`.

### knowledge — `await createKnowledge({ config })`
- Loads `config.knowledgePath`: `{ builtAt, chunks: [{ id, project, source, title, text }] }`; missing file → empty index.
- `search(query, { project, k = 5 } = {})` → `[{ project, source, title, text, score }]`, BM25 over tokens
  (lowercase, Unicode letters/digits, Arabic normalisation: strip tashkeel, unify alef/ya/ta-marbuta).
  `project` filters to that project (plus chunks with project `'general'`).
- `stats()` → `{ chunks, builtAt, projects: { [id]: count } }`.

### projects — `createProjects({ config })`
- Loads `config.projectsPath` (`projects.json`): `[{ id, name, nameAr, description, descriptionAr, systemPrompt, systemPromptAr }]`.
  Always contains `general`. Ship entries for: `general`, `tagit`, `operon`, `marginos`, `myai`, `dont-chaos`
  (read the repo folders to describe them accurately; do not invent features).
- `list()` → without prompts. `get(id)` → full or `null`. `systemPrompt(id, lang /*'ar'|'en'*/)` → string (falls back to general).

### research — `createResearch({ config, store, fetchImpl = fetch })`
- `news(ticker, { limit = 5 } = {})` → `[{ title, publisher, date /*ISO*/, url }]` from free public RSS
  (Google News RSS search for `<TICKER> stock`, Yahoo Finance RSS as second source), deduped, newest first.
- `filings(ticker, { limit = 3 } = {})` → `[{ form, date, title, url }]` from SEC EDGAR free endpoints
  (must send a descriptive `User-Agent`); return `[]` if unavailable.
- Both: validate ticker `/^[A-Z.\-]{1,8}$/`, 8 s timeout, in-memory + store cache 15 min, never throw (return `[]`).

### limiter — `createLimiter({ config })`
- `check(id)` → `{ ok, retryAfterSec }` sliding window `config.rateLimitRpm` per id (key id or IP).
- `securityHeaders(res)` → sets `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, a CSP
  allowing only self scripts/styles/connect (UI uses no inline script and no CDN).
- `clientIp(req)` → honours first `X-Forwarded-For` hop (runs behind Traefik).

## HTTP API

All non-public routes: `identity = auth.guard(ctx)`; then `limiter.check(identity.keyId)` → 429 with `Retry-After`.

### OpenAI-compatible — `src/openai-compat.mjs`
- `GET /v1/models` → `{ object:'list', data:[{ id, object:'model', owned_by:'ai-hub' }] }`.
- `POST /v1/chat/completions` — accepts `model` (unknown or OpenAI names like `gpt-*` map to `config.model`),
  `messages`, `temperature`, `max_tokens`/`max_completion_tokens`, `stream`, `response_format:{type:'json_object'}`.
  Non-stream → standard `chat.completion` object with `usage`. Stream → `text/event-stream` of
  `chat.completion.chunk` objects ending with `data: [DONE]`. Errors in OpenAI error shape
  `{ error: { message, type, code } }`. Records usage with kind `'openai'`.

### Chat — `src/chat.mjs`
- `GET /api/me` → `{ role, project, name }`. `GET /api/projects` → `projects.list()` (project keys see their own + general).
- `POST /api/chat` body `{ project = 'general', messages:[{role:'user'|'assistant', content}], lang = 'ar', stream = true }`.
  Builds: system prompt (`projects.systemPrompt`) + top-k knowledge excerpts for the last user message + last 12 messages
  (trim to fit `numCtx`). Stream → SSE: `{ delta }` ..., then `{ done:true, sources:[{ project, source, title }], usage:{...} }`;
  on failure `{ error:{ code, message } }`. Non-stream → `{ content, sources, usage }`. Records usage kind `'chat'`.

### TAGit — `src/tagit.mjs`
- `POST /api/tagit/analyze` body `{ rows:[{ ticker, signalType, price, changePct, ... }], liveFeedUpdatedAtUTC, lang = 'ar' }` (max 8 rows).
  For each row (sequentially): `research.news` + `research.filings`, then one `llm.chat({ json:true })` call that must
  return one analysis object with the existing fields: `ticker, company, asOf, executiveSummary, shortTermSetup,
  liquidityRead, technicalRead, fundamentalGrowth, catalysts[], risks[], dilutionAndFinancing, latestNewsTake,
  confidence (0-100 int), verdict (WATCH|CONFIRMED_WITH_RISK|EXTENDED|AVOID|INSUFFICIENT_EVIDENCE), sources[{title,url,publisher,date}]`.
  Validate/repair strictly; `sources` may ONLY contain URLs that came from `research` (drop anything else).
  If the model fails or returns invalid JSON twice → that ticker gets verdict `INSUFFICIENT_EVIDENCE`, confidence 0,
  `executiveSummary` stating plainly that the self-hosted model did not produce an analysis (no rules-based substitute),
  and `aiStatus:'MODEL_FAILED'`. Per-ticker cache 20 min keyed by ticker + rounded price.
  Response: `{ schemaVersion:4, provider:'SELF_HOSTED_OLLAMA', model, status:'OK'|'PARTIAL'|'MODEL_UNAVAILABLE',
  updatedAtUTC, liveFeedUpdatedAtUTC, analysisCount, analyses:{ [ticker]: analysis }, note }`.
  The system prompt is research framing, not a buy/sell recommendation and no profit guarantee. Records usage kind `'tagit'`.

### Admin — `src/admin.mjs` (all `auth.guard(ctx, 'admin')`)
- `GET /api/admin/keys`, `POST /api/admin/keys { name, project }` → 201 with plain key, `DELETE /api/admin/keys/:id`.
- `GET /api/admin/usage?days=30` → `usage.summary`. `GET /api/admin/status` → `{ version, uptimeSec, llm: health, knowledge: stats, projects: count, config: { model, numCtx, rateLimitRpm } }` (no secrets).

## UI

- No inline `<script>`/`<style>` (CSP). No CDN, no external fonts — system font stack with good Arabic
  (`"Segoe UI", "Noto Sans Arabic", "Tahoma", system-ui, sans-serif`).
- Arabic first (`dir="rtl"`), language toggle to English. Key stored in `sessionStorage` (try/catch).
- Identity palette — **no green, no beige**. Tokens (define in each css file):
  `--ink:#0B1026; --panel:#141A3A; --panel-2:#1C2450; --line:#2A3470; --text:#EEF0FF; --muted:#9AA3D0;
   --violet:#7C5CFF; --violet-2:#A48BFF; --coral:#FF7A59; --amber:#FFB547; --danger:#FF5C7A;`
- `/` chat: key gate, project picker, streaming answer, sources list, model status pill (`/health`).
- `/admin`: admin key gate, status cards, usage totals + "estimated saved USD" (labelled estimate), per-project table,
  simple SVG bar chart by day (built with DOM, no library), create/revoke keys (show new key once with copy button).

## Addendum (v1.1)

- `src/anthropic-compat.mjs` — `export function register(router, deps)`: `POST /v1/messages` and
  `POST /v1/messages/count_tokens` in Anthropic Messages shape (text, `output_config.format` json_schema,
  one custom tool → `tool_use`). Refuses images, documents, server tools, multi-tool choice, `tool_result`
  turns and prompts beyond `numCtx` with a 400 `invalid_request_error`. Usage kind `'anthropic'`.
- `llm.chat` accepts an optional `schema` (JSON Schema object) passed to Ollama as `format`.
- `projects.json` also lists `demaia`, `iyan`, `manhaj`, `qayyim` with neutral one-line descriptions only:
  this repository is public and holds no documentation of those private products.
