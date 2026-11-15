import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResearch, parseRss, decodeEntities } from '../src/research.mjs';

// ---------- helpers ----------

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);
const rfc822 = (ms) => new Date(ms).toUTCString();
const iso = (ms) => new Date(ms).toISOString();

function fakeStore() {
  const data = {};
  return {
    data,
    sets: 0,
    get(name, fallback) { return name in data ? data[name] : fallback; },
    set(name, value) { this.sets += 1; data[name] = value; },
  };
}

// routes: [[substring, body | Error | (url, init) => body]]
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    for (const [needle, reply] of routes) {
      if (!String(url).includes(needle)) continue;
      const value = typeof reply === 'function' ? await reply(String(url), init) : reply;
      if (value instanceof Error) throw value;
      if (value && typeof value === 'object') return { ok: false, status: value.status, text: async () => '' };
      return { ok: true, status: 200, text: async () => value };
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  impl.calls = calls;
  impl.count = (needle) => calls.filter((c) => c.url.includes(needle)).length;
  return impl;
}

function rss(items) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>feed</title>
<link>https://example.com</link>${items.join('\n')}</channel></rss>`;
}

const googleRss = (now = NOW) => rss([
  `<item><title>Apple &amp; partners unveil new chip - Reuters</title>
     <link>https://news.google.com/rss/articles/AAA?oc=5</link>
     <guid isPermaLink="false">AAA</guid>
     <pubDate>${rfc822(now - 2 * DAY)}</pubDate>
     <description>&lt;a href="https://x"&gt;Apple&lt;/a&gt;</description>
     <source url="https://www.reuters.com">Reuters</source></item>`,
  `<item><title><![CDATA[Apple's stock hits record high - Bloomberg]]></title>
     <link>https://news.google.com/rss/articles/BBB?oc=5</link>
     <pubDate>${rfc822(now - 1 * DAY)}</pubDate>
     <source url="https://www.bloomberg.com">Bloomberg</source></item>`,
  `<item><title>Very old Apple story - CNBC</title>
     <link>https://news.google.com/rss/articles/OLD</link>
     <pubDate>${rfc822(now - 45 * DAY)}</pubDate>
     <source url="https://www.cnbc.com">CNBC</source></item>`,
  `<item><title>Undated Apple story - CNBC</title>
     <link>https://news.google.com/rss/articles/NODATE</link>
     <pubDate>not a date</pubDate>
     <source url="https://www.cnbc.com">CNBC</source></item>`,
  `<item><title>Bad link story - CNBC</title><link>javascript:alert(1)</link>
     <pubDate>${rfc822(now - 1 * DAY)}</pubDate><source url="https://www.cnbc.com">CNBC</source></item>`,
]);

const yahooRss = (now = NOW) => rss([
  `<item><description>dup</description><guid isPermaLink="false">g1</guid>
     <link>https://finance.yahoo.com/news/apple-record-1.html?.tsrc=rss</link>
     <pubDate>${rfc822(now - 3 * DAY)}</pubDate>
     <title>Apple&#39;s Stock Hits Record High</title></item>`,
  `<item><link>https://finance.yahoo.com/news/apple-supplier-2.html</link>
     <pubDate>${rfc822(now - 3 * 60 * 60 * 1000)}</pubDate>
     <title>Apple supplier lifts &quot;outlook&quot; &#x2014; shares jump</title></item>`,
]);

const TICKERS_JSON = JSON.stringify({
  0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  1: { cik_str: 789019, ticker: 'MSFT', title: 'MICROSOFT CORP' },
  2: { cik_str: 1067983, ticker: 'BRK-B', title: 'BERKSHIRE HATHAWAY INC' },
});

const SUBMISSIONS_JSON = JSON.stringify({
  cik: '320193',
  name: 'Apple Inc.',
  tickers: ['AAPL'],
  filings: {
    recent: {
      accessionNumber: ['0000320193-26-000101', '0000320193-26-000099', '0000320193-26-000090', 'garbage', '0000320193-26-000080', '0000320193-26-000070'],
      filingDate: ['2026-11-10', '2026-11-06', '2026-10-30', '2026-10-29', '2026-10-01', '2026-08-01'],
      form: ['4', '8-K', '10-K', '8-K', 'S-3', '10-Q'],
      primaryDocument: ['x.xml', 'aapl-8k.htm', 'aapl-10k.htm', 'y.htm', 's3.htm', 'q.htm'],
      primaryDocDescription: ['FORM 4', '8-K', 'Annual report', '8-K', 'Shelf registration', '10-Q'],
    },
    files: [],
  },
});

const newsRoutes = () => [
  ['news.google.com', googleRss()],
  ['feeds.finance.yahoo.com', yahooRss()],
];
const secRoutes = () => [
  ['company_tickers.json', TICKERS_JSON],
  ['data.sec.gov/submissions', SUBMISSIONS_JSON],
];
const make = (routes, extra = {}) => {
  const fetchImpl = fakeFetch(routes);
  const store = extra.store ?? fakeStore();
  const research = createResearch({ config: {}, store, fetchImpl, now: () => NOW, ...extra });
  return { research, fetchImpl, store };
};

// ---------- parser ----------

test('parseRss handles CDATA, entities, source and missing fields', () => {
  const items = parseRss(googleRss());
  assert.equal(items.length, 5);
  assert.equal(items[0].title, 'Apple & partners unveil new chip - Reuters');
  assert.equal(items[0].source, 'Reuters');
  assert.equal(items[0].sourceUrl, 'https://www.reuters.com');
  assert.equal(items[0].link, 'https://news.google.com/rss/articles/AAA?oc=5');
  assert.equal(items[1].title, "Apple's stock hits record high - Bloomberg");
  assert.equal(items[4].link, '', 'non-http link rejected');
  assert.deepEqual(parseRss(''), []);
  assert.deepEqual(parseRss(null), []);
  assert.deepEqual(parseRss('<html><body>blocked</body></html>'), []);
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &#39;d&#x27; &unknown; &#99999999;'), "a & b <c> 'd' &unknown; &#99999999;");
});

// ---------- news ----------

test('news: parses both sources, dedupes, sorts newest first, drops old/undated', async () => {
  const { research, fetchImpl } = make(newsRoutes());
  const out = await research.news('aapl', { limit: 10 });

  assert.deepEqual(out.map((n) => n.title), [
    'Apple supplier lifts "outlook" — shares jump',
    "Apple's stock hits record high",
    'Apple & partners unveil new chip',
  ]);
  assert.deepEqual(out.map((n) => n.publisher), ['Yahoo Finance', 'Bloomberg', 'Reuters']);
  assert.equal(out[1].date, iso(NOW - 1 * DAY));
  assert.equal(out[1].url, 'https://news.google.com/rss/articles/BBB?oc=5');
  for (const n of out) {
    assert.deepEqual(Object.keys(n).sort(), ['date', 'publisher', 'title', 'url']);
    assert.equal(new Date(n.date).toISOString(), n.date);
    assert.match(n.url, /^https:\/\//);
  }

  const urls = fetchImpl.calls.map((c) => c.url);
  assert.ok(urls.includes('https://news.google.com/rss/search?q=AAPL+stock&hl=en-US&gl=US&ceid=US:en'));
  assert.ok(urls.includes('https://feeds.finance.yahoo.com/rss/2.0/headline?s=AAPL&region=US&lang=en-US'));
  assert.ok(fetchImpl.calls.every((c) => c.init.signal instanceof AbortSignal));
});

test('news: limit (default 5) and cache hit avoids a second fetch', async () => {
  const many = rss(Array.from({ length: 9 }, (_, i) => `<item><title>Story number ${i} - Wire</title>
    <link>https://news.google.com/rss/articles/${i}</link><pubDate>${rfc822(NOW - i * 3600_000)}</pubDate>
    <source url="https://wire.example">Wire</source></item>`));
  const { research, fetchImpl, store } = make([['news.google.com', many], ['feeds.finance.yahoo.com', rss([])]]);

  const five = await research.news('MSFT');
  assert.equal(five.length, 5);
  assert.equal(five[0].title, 'Story number 0');
  assert.equal(fetchImpl.calls.length, 2);

  assert.equal((await research.news('MSFT', { limit: 2 })).length, 2);
  assert.equal((await research.news('msft', { limit: 100 })).length, 9);
  assert.equal(fetchImpl.calls.length, 2, 'served from cache');

  // Callers cannot corrupt the cache by mutating results.
  five[0].title = 'tampered';
  assert.equal((await research.news('MSFT'))[0].title, 'Story number 0');

  assert.ok(store.data['research-cache']['news:MSFT'], 'mirrored into the store');
});

test('news: concurrent calls share one fetch per source', async () => {
  const { research, fetchImpl } = make(newsRoutes());
  const [a, b] = await Promise.all([research.news('AAPL'), research.news('AAPL')]);
  assert.deepEqual(a, b);
  assert.equal(fetchImpl.calls.length, 2);
});

test('news: a second instance reads the store mirror; cache expires after 15 minutes', async () => {
  const store = fakeStore();
  let t = NOW;
  const first = fakeFetch(newsRoutes());
  await createResearch({ store, fetchImpl: first, now: () => t }).news('AAPL');
  assert.equal(first.calls.length, 2);

  const second = fakeFetch(newsRoutes());
  const research = createResearch({ store, fetchImpl: second, now: () => t });
  assert.equal((await research.news('AAPL')).length, 3);
  assert.equal(second.calls.length, 0, 'store cache hit');

  t = NOW + 14 * 60 * 1000;
  await research.news('AAPL');
  assert.equal(second.calls.length, 0);

  t = NOW + 16 * 60 * 1000;
  await research.news('AAPL');
  assert.equal(second.calls.length, 2, 'refetched after expiry');
});

test('news: one source failing does not lose the other', async () => {
  const a = make([['news.google.com', new Error('ECONNRESET')], ['feeds.finance.yahoo.com', yahooRss()]]);
  const fromYahoo = await a.research.news('AAPL');
  assert.equal(fromYahoo.length, 2);
  assert.ok(fromYahoo.every((n) => n.publisher === 'Yahoo Finance'));

  const b = make([['news.google.com', googleRss()], ['feeds.finance.yahoo.com', { status: 503 }]]);
  assert.deepEqual((await b.research.news('AAPL')).map((n) => n.publisher), ['Bloomberg', 'Reuters']);
});

test('news: total failure returns [] and is not persisted', async () => {
  let t = NOW;
  const store = fakeStore();
  const fetchImpl = fakeFetch([['news.google.com', new Error('down')], ['feeds.finance.yahoo.com', { status: 500 }]]);
  const research = createResearch({ store, fetchImpl, now: () => t });
  assert.deepEqual(await research.news('AAPL'), []);
  assert.equal(store.data['research-cache'], undefined);

  t = NOW + 2 * 60 * 1000; // short negative cache has lapsed -> tries again
  assert.deepEqual(await research.news('AAPL'), []);
  assert.equal(fetchImpl.calls.length, 4);
});

test('news: garbage bodies and a synchronously throwing fetch return []', async () => {
  const a = make([['news.google.com', '<html>captcha</html>'], ['feeds.finance.yahoo.com', '{"not":"xml"}']]);
  assert.deepEqual(await a.research.news('AAPL'), []);

  const research = createResearch({ store: fakeStore(), fetchImpl: () => { throw new Error('boom'); } });
  assert.deepEqual(await research.news('AAPL'), []);
  assert.deepEqual(await research.filings('AAPL'), []);
});

test('bad tickers return [] without any network call', async () => {
  const { research, fetchImpl } = make([...newsRoutes(), ...secRoutes()]);
  const bad = ['', '   ', 'TOOLONGXX', 'AA PL', 'AAPL1', '$AAPL', 'A/B', '../etc', 'AAPL&x=1', null, undefined, 42, {}, ['AAPL']];
  for (const ticker of bad) {
    assert.deepEqual(await research.news(ticker), [], `news ${String(ticker)}`);
    assert.deepEqual(await research.filings(ticker), [], `filings ${String(ticker)}`);
  }
  assert.equal(fetchImpl.calls.length, 0);
  assert.deepEqual(await research.news('AAPL', null), await research.news(' aapl '));
});

test('timeout: a hanging request resolves to [] and is aborted', async () => {
  let aborted = 0;
  const hanging = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => { aborted += 1; reject(new Error('aborted')); });
  });
  const research = createResearch({ store: fakeStore(), fetchImpl: hanging, timeoutMs: 20 });
  const started = Date.now();
  assert.deepEqual(await research.news('AAPL'), []);
  assert.deepEqual(await research.filings('MSFT'), []);
  assert.ok(Date.now() - started < 2000);
  assert.equal(aborted, 3);
});

// ---------- SEC filings ----------

test('filings: ticker -> CIK -> submissions, with descriptive User-Agent', async () => {
  const { research, fetchImpl } = make(secRoutes());
  const out = await research.filings('aapl');

  assert.deepEqual(out, [
    { form: '8-K', date: '2026-11-06', title: 'Apple Inc. 8-K', url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000099/0000320193-26-000099-index.htm' },
    { form: '10-K', date: '2026-10-30', title: 'Apple Inc. 10-K — Annual report', url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000090/0000320193-26-000090-index.htm' },
    { form: 'S-3', date: '2026-10-01', title: 'Apple Inc. S-3 — Shelf registration', url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000080/0000320193-26-000080-index.htm' },
  ]);

  assert.deepEqual(fetchImpl.calls.map((c) => c.url), [
    'https://www.sec.gov/files/company_tickers.json',
    'https://data.sec.gov/submissions/CIK0000320193.json',
  ]);
  for (const call of fetchImpl.calls) {
    assert.equal(call.init.headers['User-Agent'], 'AI-Hub research (self-hosted; contact: admin@localhost)');
  }

  assert.equal((await research.filings('AAPL', { limit: 1 })).length, 1);
  assert.equal((await research.filings('AAPL', { limit: 10 })).length, 4, 'insider form 4 and malformed row excluded');
  assert.equal(fetchImpl.calls.length, 2, 'cached');
});

test('filings: SEC_USER_AGENT env override; ticker list fetched once for several tickers', async () => {
  const previous = process.env.SEC_USER_AGENT;
  process.env.SEC_USER_AGENT = 'My Hub ops@example.org\r\nX-Injected: 1';
  try {
    const { research, fetchImpl } = make(secRoutes());
    await research.filings('AAPL');
    await research.filings('MSFT');
    await research.filings('BRK.B');
    assert.equal(fetchImpl.count('company_tickers.json'), 1);
    assert.ok(fetchImpl.calls.some((c) => c.url.endsWith('/CIK0000789019.json')));
    assert.ok(fetchImpl.calls.some((c) => c.url.endsWith('/CIK0001067983.json')), 'BRK.B resolves via BRK-B');
    const ua = fetchImpl.calls[0].init.headers['User-Agent'];
    assert.equal(ua, 'My Hub ops@example.org X-Injected: 1');
    assert.ok(!/[\r\n]/.test(ua));
  } finally {
    if (previous === undefined) delete process.env.SEC_USER_AGENT;
    else process.env.SEC_USER_AGENT = previous;
  }
});

test('filings: only insider forms available -> still returned', async () => {
  const body = JSON.stringify({ name: 'Apple Inc.', filings: { recent: {
    accessionNumber: ['0000320193-26-000001', '0000320193-26-000002'],
    filingDate: ['2026-11-01', '2026-11-02'], form: ['4', '4/A'], primaryDocDescription: ['', ''],
  } } });
  const { research } = make([['company_tickers.json', TICKERS_JSON], ['data.sec.gov', body]]);
  const out = await research.filings('AAPL');
  assert.deepEqual(out.map((f) => [f.form, f.date]), [['4/A', '2026-11-02'], ['4', '2026-11-01']]);
});

test('filings: unknown ticker, SEC errors and malformed JSON all return []', async () => {
  const unknown = make(secRoutes());
  assert.deepEqual(await unknown.research.filings('ZZZZ'), []);
  assert.equal(unknown.fetchImpl.count('data.sec.gov'), 0);

  const blocked = make([['company_tickers.json', { status: 403 }], ['data.sec.gov', SUBMISSIONS_JSON]]);
  assert.deepEqual(await blocked.research.filings('AAPL'), []);

  const html = make([['company_tickers.json', '<html>Undeclared Automated Tool</html>']]);
  assert.deepEqual(await html.research.filings('AAPL'), []);

  const noSubs = make([['company_tickers.json', TICKERS_JSON], ['data.sec.gov', new Error('timeout')]]);
  assert.deepEqual(await noSubs.research.filings('AAPL'), []);

  const odd = make([['company_tickers.json', TICKERS_JSON], ['data.sec.gov', '{"filings":{"recent":{"form":"nope"}}}']]);
  assert.deepEqual(await odd.research.filings('AAPL'), []);

  const nullBody = make([['company_tickers.json', 'null']]);
  assert.deepEqual(await nullBody.research.filings('AAPL'), []);
});

// ---------- store mirror ----------

test('store mirror is bounded to 300 entries and a broken or missing store is harmless', async () => {
  const store = fakeStore();
  const seeded = {};
  for (let i = 0; i < 320; i += 1) seeded[`news:SEED${i}`] = { at: NOW - 1000 + i, exp: NOW + 600_000, data: [] };
  seeded['news:STALE'] = { at: NOW - 3600_000, exp: NOW - 1, data: [] };
  store.data['research-cache'] = seeded;

  const { research } = make(newsRoutes(), { store });
  await research.news('AAPL');
  const mirror = store.data['research-cache'];
  assert.equal(Object.keys(mirror).length, 300);
  assert.ok(mirror['news:AAPL']);
  assert.equal(mirror['news:STALE'], undefined);
  assert.equal(mirror['news:SEED0'], undefined, 'oldest evicted first');
  assert.ok(mirror['news:SEED319']);

  const broken = { get() { throw new Error('disk'); }, set() { throw new Error('disk'); } };
  assert.equal((await make(newsRoutes(), { store: broken }).research.news('AAPL')).length, 3);
  assert.equal((await make(newsRoutes(), { store: undefined }).research.news('AAPL')).length, 3);
  const corrupt = fakeStore();
  corrupt.data['research-cache'] = 'not an object';
  assert.equal((await make(newsRoutes(), { store: corrupt }).research.news('AAPL')).length, 3);
  assert.equal(typeof corrupt.data['research-cache'], 'object');
});
