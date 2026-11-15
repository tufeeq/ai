import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register, extractJsonObject, validateBody } from '../src/tagit.mjs';

// ---------- fakes ----------

const NEWS = [
  { title: 'ACME wins supply contract', publisher: 'Newswire', date: '2026-11-14T12:00:00Z', url: 'https://news.example.com/acme-contract' },
  { title: 'ACME prices public offering', publisher: 'Daily Markets', date: '2026-11-13T09:00:00Z', url: 'https://news.example.com/acme-offering' },
];
const FILINGS = [
  { form: '8-K', date: '2026-11-13', title: 'Current report', url: 'https://www.sec.gov/Archives/acme-8k.htm' },
];

const GOOD = {
  ticker: 'WRONG',
  company: 'Acme Corp',
  asOf: '1999-01-01',
  executiveSummary: 'ملخص بحثي مبني على البيانات المرسلة فقط.',
  shortTermSetup: 'زخم قصير يحتاج تأكيدًا.',
  liquidityRead: 'حجم نسبي مرتفع.',
  technicalRead: 'RSI محايد.',
  fundamentalGrowth: 'غير متوفر في البيانات المرسلة.',
  catalysts: ['عقد توريد'],
  risks: ['طرح عام قد يسبب تخفيفًا'],
  dilutionAndFinancing: 'عنوان يشير إلى طرح عام.',
  latestNewsTake: 'عنوانان حديثان.',
  confidence: 62,
  verdict: 'WATCH',
  sources: [{ title: 'Invented', url: 'https://evil.example.com/fake', publisher: 'Fake', date: '2026-01-01' }],
};

class FakeLLMError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function setup({ replies = [JSON.stringify(GOOD)], identity, news = NEWS, filings = FILINGS, limiterOk = true } = {}) {
  const routes = [];
  const router = { add: (method, pattern, handler) => routes.push({ method, pattern, handler }) };
  const calls = { llm: [], usage: [], news: [], filings: [] };
  let clock = Date.parse('2026-11-15T10:00:00Z');
  const queue = [...replies];
  const deps = {
    config: { model: 'qwen2.5:3b' },
    now: () => clock,
    auth: {
      guard(ctx) {
        if (identity === null) {
          ctx.res.writeHead(401, {});
          ctx.res.end(JSON.stringify({ error: { code: 'unauthorized', message: 'no' } }));
          return null;
        }
        return identity || { ok: true, role: 'project', keyId: 'key_1', project: 'tagit', name: 'tagit' };
      },
    },
    limiter: { check: () => (limiterOk ? { ok: true, retryAfterSec: 0 } : { ok: false, retryAfterSec: 7 }) },
    llm: {
      async chat(opts) {
        calls.llm.push(opts);
        // The last scripted reply repeats forever.
        const next = queue.length > 1 ? queue.shift() : queue[0];
        if (next instanceof Error) throw next;
        return { content: next, model: 'qwen2.5:3b', promptTokens: 400, completionTokens: 200, ms: 1234 };
      },
    },
    usage: { estimateTokens: (s) => Math.ceil(String(s).length / 4), record: (e) => calls.usage.push(e) },
    research: {
      async news(ticker, opts) {
        calls.news.push({ ticker, opts });
        return typeof news === 'function' ? news(ticker) : news;
      },
      async filings(ticker, opts) {
        calls.filings.push({ ticker, opts });
        return typeof filings === 'function' ? filings(ticker) : filings;
      },
    },
  };
  register(router, deps);
  const route = routes.find((r) => r.method === 'POST' && r.pattern === '/api/tagit/analyze');

  async function post(body) {
    const res = {
      statusCode: 0, headers: {}, body: '', headersSent: false, writableEnded: false,
      writeHead(status, headers = {}) { this.statusCode = status; this.headers = headers; this.headersSent = true; },
      end(chunk = '') { this.body += chunk; this.writableEnded = true; },
      on() {}, off() {},
    };
    const ctx = {
      req: { headers: {} }, res, url: new URL('http://hub.local/api/tagit/analyze'), params: {}, query: {},
      config: deps.config, json: async () => body,
    };
    await route.handler(ctx);
    return { status: res.statusCode, headers: res.headers, json: res.body ? JSON.parse(res.body) : null };
  }

  return { route, post, calls, advance: (ms) => { clock += ms; } };
}

const row = (ticker = 'ACME', extra = {}) => ({
  ticker, signalType: 'EMERGING', price: 2.314, changePct: '12.5', sessionVolume: 1500000, rsi14: 61.2, ...extra,
});

// ---------- tests ----------

test('registers POST /api/tagit/analyze', () => {
  const { route } = setup();
  assert.ok(route);
  assert.equal(typeof route.handler, 'function');
});

test('happy path returns the schema-4 document', async () => {
  const { post, calls } = setup();
  const r = await post({ rows: [row('acme', { secretField: 'ignore me', timestampET: '2026-11-15 05:00' })], liveFeedUpdatedAtUTC: '2026-11-15T09:59:00Z' });
  assert.equal(r.status, 200);
  const doc = r.json;
  assert.deepEqual(Object.keys(doc), ['schemaVersion', 'provider', 'model', 'status', 'updatedAtUTC', 'liveFeedUpdatedAtUTC', 'analysisCount', 'analyses', 'note']);
  assert.equal(doc.schemaVersion, 4);
  assert.equal(doc.provider, 'SELF_HOSTED_OLLAMA');
  assert.equal(doc.model, 'qwen2.5:3b');
  assert.equal(doc.status, 'OK');
  assert.equal(doc.updatedAtUTC, '2026-11-15T10:00:00.000Z');
  assert.equal(doc.liveFeedUpdatedAtUTC, '2026-11-15T09:59:00Z');
  assert.equal(doc.analysisCount, 1);
  assert.match(doc.note, /self-hosted open-source model/);
  assert.match(doc.note, /without live web browsing/);

  const a = doc.analyses.ACME;
  assert.equal(a.ticker, 'ACME'); // forced to the requested ticker
  assert.equal(a.asOf, '2026-11-15T10:00:00.000Z'); // not the model's date
  assert.equal(a.aiStatus, 'OK');
  assert.equal(a.verdict, 'WATCH');
  assert.equal(a.confidence, 62);
  assert.deepEqual(a.catalysts, ['عقد توريد']);
  for (const f of ['company', 'executiveSummary', 'shortTermSetup', 'liquidityRead', 'technicalRead', 'fundamentalGrowth', 'dilutionAndFinancing', 'latestNewsTake']) {
    assert.equal(typeof a[f], 'string', f);
  }
  // live-v6.js compatibility aliases
  assert.equal(a.summary, a.executiveSummary);
  assert.equal(a.opportunity, a.shortTermSetup);
  assert.equal(a.growthView, a.fundamentalGrowth);
  assert.equal(a.news[0].link, NEWS[0].url);

  // research + llm call contract
  assert.deepEqual(calls.news[0], { ticker: 'ACME', opts: { limit: 5 } });
  assert.deepEqual(calls.filings[0], { ticker: 'ACME', opts: { limit: 3 } });
  assert.equal(calls.llm.length, 1);
  const opts = calls.llm[0];
  assert.equal(opts.json, true);
  assert.equal(opts.temperature, 0.2);
  assert.equal(opts.maxTokens, 900);
  assert.equal(opts.messages[0].role, 'system');
  assert.match(opts.messages[0].content, /لا تملك تصفح الويب/);
  const user = opts.messages[1].content;
  assert.match(user, /ACME wins supply contract/);
  assert.match(user, /2026-11-14/);
  assert.match(user, /8-K/);
  assert.match(user, /"changePct":12.5/); // numeric coercion
  assert.match(user, /"quoteTime"/);
  assert.doesNotMatch(user, /secretField|ignore me/); // unknown fields ignored
  assert.ok(user.length < 2500, 'prompt stays compact');

  // usage
  assert.equal(calls.usage.length, 1);
  assert.deepEqual(
    { ...calls.usage[0] },
    { keyId: 'key_1', project: 'tagit', kind: 'tagit', model: 'qwen2.5:3b', promptTokens: 400, completionTokens: 200, ms: 1234, ok: true },
  );
});

test("lang 'en' switches prompt language", async () => {
  const { post, calls } = setup();
  const r = await post({ rows: [row()], lang: 'en' });
  assert.equal(r.json.status, 'OK');
  assert.match(calls.llm[0].messages[0].content, /NO web browsing/);
  assert.match(calls.llm[0].messages[0].content, /not a buy\/sell recommendation/);
});

test('JSON wrapped in prose / code fences is extracted', async () => {
  const wrapped = 'Sure! Here is the analysis {not json}:\n```json\n' + JSON.stringify(GOOD, null, 2) + '\n```\nHope it helps.';
  const { post, calls } = setup({ replies: [wrapped] });
  const r = await post({ rows: [row()] });
  assert.equal(r.json.status, 'OK');
  assert.equal(r.json.analyses.ACME.executiveSummary, GOOD.executiveSummary);
  assert.equal(calls.llm.length, 1);
  assert.deepEqual(extractJsonObject('x {"a":"}"} y'), { a: '}' });
  assert.equal(extractJsonObject('no json here'), null);
  assert.equal(extractJsonObject('{"a": 1'), null);
});

test('invalid verdict, confidence and oversized fields are repaired', async () => {
  const messy = {
    ...GOOD,
    verdict: 'STRONG BUY',
    confidence: '250%',
    executiveSummary: 'س'.repeat(2000),
    catalysts: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 42, { x: 1 }],
    risks: 'خطر أول؛ خطر ثان',
    technicalRead: 12345,
    liquidityRead: { nested: true },
  };
  const { post } = setup({ replies: [JSON.stringify(messy)] });
  const a = (await post({ rows: [row()] })).json.analyses.ACME;
  assert.equal(a.verdict, 'INSUFFICIENT_EVIDENCE');
  assert.equal(a.confidence, 100);
  assert.ok(a.executiveSummary.length <= 700);
  assert.equal(a.catalysts.length, 6);
  assert.deepEqual(a.risks, ['خطر أول', 'خطر ثان']);
  assert.equal(a.technicalRead, '12345');
  assert.equal(a.liquidityRead, '');

  const low = setup({ replies: [JSON.stringify({ ...GOOD, verdict: 'confirmed with risk', confidence: -5 })] });
  const b = (await low.post({ rows: [row()] })).json.analyses.ACME;
  assert.equal(b.verdict, 'CONFIRMED_WITH_RISK');
  assert.equal(b.confidence, 0);
});

test('sources come only from research items, max 6', async () => {
  const manyNews = Array.from({ length: 5 }, (_, i) => ({
    title: `Headline ${i}`, publisher: 'Pub', date: '2026-11-10T00:00:00Z', url: `https://news.example.com/${i}`,
  }));
  manyNews.push({ title: 'bad scheme', publisher: 'x', date: '', url: 'javascript:alert(1)' });
  const manyFilings = Array.from({ length: 3 }, (_, i) => ({
    form: '8-K', date: '2026-11-0' + (i + 1), title: `Filing ${i}`, url: `https://www.sec.gov/f${i}`,
  }));
  const { post } = setup({ news: manyNews, filings: manyFilings });
  const a = (await post({ rows: [row()] })).json.analyses.ACME;
  assert.equal(a.sources.length, 6);
  const allowed = new Set([...manyNews, ...manyFilings].map((x) => x.url));
  for (const s of a.sources) {
    assert.ok(allowed.has(s.url), s.url);
    assert.deepEqual(Object.keys(s), ['title', 'url', 'publisher', 'date']);
    assert.doesNotMatch(s.url, /evil|javascript/);
  }
  assert.ok(a.sources.some((s) => s.publisher === 'SEC EDGAR'));
  assert.equal(a.sources[0].date, '2026-11-10');
});

test('no research items: confidence capped at 35 and a plain note is appended', async () => {
  const { post } = setup({ news: [], filings: [], replies: [JSON.stringify({ ...GOOD, confidence: 90 })] });
  const a = (await post({ rows: [row()] })).json.analyses.ACME;
  assert.equal(a.confidence, 35);
  assert.deepEqual(a.sources, []);
  assert.match(a.latestNewsTake, /لم تُسترجع أخبار حديثة/);
  assert.ok(a.latestNewsTake.startsWith(GOOD.latestNewsTake));
});

test('retries once on invalid JSON, then succeeds', async () => {
  const { post, calls } = setup({ replies: ['I cannot answer in JSON, sorry.', JSON.stringify(GOOD)] });
  const r = await post({ rows: [row()] });
  assert.equal(r.json.status, 'OK');
  assert.equal(calls.llm.length, 2);
  assert.equal(calls.llm[1].messages.length, 3); // retry reminder appended
  assert.deepEqual(calls.usage.map((u) => u.ok), [false, true]);
});

test('retry then fail: MODEL_FAILED with a plain statement, no substitute text', async () => {
  const { post, calls } = setup({
    replies: ['not json', '{"executiveSummary": ""}', JSON.stringify(GOOD)],
  });
  const r = await post({ rows: [row('ACME'), row('BETA', { price: 5 })] });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'PARTIAL');
  assert.equal(r.json.analysisCount, 2);
  const a = r.json.analyses.ACME;
  assert.equal(a.aiStatus, 'MODEL_FAILED');
  assert.equal(a.verdict, 'INSUFFICIENT_EVIDENCE');
  assert.equal(a.confidence, 0);
  assert.match(a.executiveSummary, /لم يُنتج النموذج المستضاف ذاتيًا تحليلًا/);
  assert.equal(a.summary, a.executiveSummary);
  assert.equal(a.shortTermSetup, '');
  assert.deepEqual(a.risks, []);
  assert.equal(a.sources.length, 3); // real research items are still listed
  assert.equal(r.json.analyses.BETA.aiStatus, 'OK');
  assert.equal(calls.llm.length, 3);

  const en = setup({ replies: [new FakeLLMError('bad_response')] });
  const e = await en.post({ rows: [row()], lang: 'en' });
  assert.equal(en.calls.llm.length, 2);
  assert.equal(e.json.status, 'PARTIAL');
  assert.match(e.json.analyses.ACME.executiveSummary, /self-hosted model did not produce an analysis for ACME/);
  assert.deepEqual(en.calls.usage.map((u) => u.ok), [false, false]);
});

test('MODEL_UNAVAILABLE: stops early on unreachable / model_missing', async () => {
  for (const code of ['unreachable', 'model_missing']) {
    const { post, calls } = setup({ replies: [new FakeLLMError(code)] });
    const r = await post({ rows: [row('ACME'), row('BETA'), row('GAMA')] });
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'MODEL_UNAVAILABLE');
    assert.equal(r.json.provider, 'SELF_HOSTED_OLLAMA');
    assert.equal(r.json.analysisCount, 3);
    assert.equal(calls.llm.length, 1, 'no retry and no further tickers');
    assert.equal(calls.news.length, 1, 'no research for skipped tickers');
    for (const t of ['ACME', 'BETA', 'GAMA']) {
      const a = r.json.analyses[t];
      assert.equal(a.ticker, t);
      assert.equal(a.aiStatus, 'MODEL_FAILED');
      assert.equal(a.verdict, 'INSUFFICIENT_EVIDENCE');
      assert.equal(a.confidence, 0);
      assert.match(a.executiveSummary, new RegExp(t));
    }
  }
});

test('cache hit within 20 minutes keyed by ticker + rounded price + lang', async () => {
  const { post, calls, advance } = setup();
  await post({ rows: [row('ACME', { price: 2.314 })] });
  assert.equal(calls.llm.length, 1);

  advance(5 * 60 * 1000);
  const hit = await post({ rows: [row('ACME', { price: 2.33 })] }); // same 2 significant digits
  assert.equal(calls.llm.length, 1);
  assert.equal(calls.news.length, 1);
  assert.equal(hit.json.status, 'OK');
  assert.equal(hit.json.analyses.ACME.aiStatus, 'OK');

  await post({ rows: [row('ACME', { price: 2.6 })] }); // price moved
  assert.equal(calls.llm.length, 2);
  await post({ rows: [row('ACME', { price: 2.314 })], lang: 'en' }); // other language
  assert.equal(calls.llm.length, 3);

  advance(21 * 60 * 1000);
  await post({ rows: [row('ACME', { price: 2.314 })] }); // expired
  assert.equal(calls.llm.length, 4);
});

test('failed analyses are not cached', async () => {
  const { post, calls } = setup({ replies: ['nope', 'nope', JSON.stringify(GOOD)] });
  await post({ rows: [row()] });
  const again = await post({ rows: [row()] });
  assert.equal(calls.llm.length, 3);
  assert.equal(again.json.analyses.ACME.aiStatus, 'OK');
});

test('validation errors return 400 without touching research or the model', async () => {
  const { post, calls } = setup();
  const bad = [
    null,
    {},
    { rows: [] },
    { rows: 'ACME' },
    { rows: Array.from({ length: 9 }, (_, i) => row('T' + 'ABCDEFGHI'[i])) },
    { rows: [{ ticker: 'TOOLONGTICKER' }] },
    { rows: [{ ticker: 'AC ME' }] },
    { rows: [{ ticker: 'AB1' }] },
    { rows: [{ price: 1 }] },
    { rows: ['ACME'] },
    { rows: [row()], lang: 'fr' },
  ];
  for (const body of bad) {
    const r = await post(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.error.code, 'invalid_request');
    assert.equal(typeof r.json.error.message, 'string');
  }
  assert.equal(calls.llm.length, 0);
  assert.equal(calls.news.length, 0);

  const v = validateBody({ rows: [{ ticker: ' brk.b ', price: '1,234.5', rsi14: 'abc', technicalBias: 'BULL<script>' }, { ticker: 'BRK.B' }] });
  assert.equal(v.rows.length, 1); // duplicates collapsed
  assert.equal(v.rows[0].ticker, 'BRK.B');
  assert.equal(v.rows[0].price, 1234.5);
  assert.equal(v.rows[0].rsi14, null);
  assert.equal(v.rows[0].technicalBias, 'BULL script');
  assert.equal(v.lang, 'ar');
});

test('body parse errors keep their HTTP status', async () => {
  const { route } = setup();
  const res = {
    statusCode: 0, body: '', headersSent: false,
    writeHead(s) { this.statusCode = s; this.headersSent = true; },
    end(c = '') { this.body += c; },
  };
  const err = Object.assign(new Error('Body too large'), { status: 413, code: 'payload_too_large' });
  await route.handler({ req: { headers: {} }, res, json: async () => { throw err; } });
  assert.equal(res.statusCode, 413);
  assert.equal(JSON.parse(res.body).error.code, 'payload_too_large');
});

test('scope: other-project keys get 403, admin is allowed, unauthenticated stops', async () => {
  const other = setup({ identity: { ok: true, role: 'project', keyId: 'key_2', project: 'operon', name: 'x' } });
  const r = await other.post({ rows: [row()] });
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, 'forbidden');
  assert.equal(other.calls.llm.length, 0);

  const admin = setup({ identity: { ok: true, role: 'admin', keyId: 'admin', project: '*', name: 'admin' } });
  const ok = await admin.post({ rows: [row()] });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.status, 'OK');
  assert.equal(admin.calls.usage[0].project, 'tagit');

  const anon = setup({ identity: null });
  const u = await anon.post({ rows: [row()] });
  assert.equal(u.status, 401);
  assert.equal(anon.calls.llm.length, 0);
});

test('rate limit returns 429 with Retry-After', async () => {
  const { post, calls } = setup({ limiterOk: false });
  const r = await post({ rows: [row()] });
  assert.equal(r.status, 429);
  assert.equal(r.headers['Retry-After'], '7');
  assert.equal(r.json.error.code, 'rate_limited');
  assert.equal(calls.llm.length, 0);
});
