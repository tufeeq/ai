// research — free, key-less public sources for US stock tickers.
//
//   news(ticker)    Google News RSS search + Yahoo Finance headline RSS
//   filings(ticker) SEC EDGAR (company_tickers.json -> submissions/CIK##########.json)
//
// Contract (SPEC "research"): validate ticker, 8 s timeout per request, 15 min cache
// (memory + store collection `research-cache`), never throw — any failure returns [].
// Nothing here is ever invented: an item is returned only if it was parsed from a response.

const TICKER_RE = /^[A-Z.\-]{1,8}$/;
const CACHE_COLLECTION = 'research-cache';
const CACHE_TTL_MS = 15 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 1000; // total failure: remembered briefly, in memory only
const CIK_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 300;
const NEWS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_CHARS = 8 * 1024 * 1024;
const MAX_RSS_ITEMS = 200;
const MAX_KEPT = 50; // items kept per cache entry / maximum `limit`
const DEFAULT_SEC_UA = 'AI-Hub research (self-hosted; contact: admin@localhost)';
const RSS_UA = 'Mozilla/5.0 (compatible; AI-Hub-research/1.0)';

// Insider-ownership paperwork; it would otherwise crowd out the filings that matter.
const NOISE_FORMS = /^(3|4|5|144)(\/A)?$/;

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', hellip: '…',
};

export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try { return String.fromCodePoint(code); } catch { return whole; }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

// Raw element content -> plain single-line text (CDATA unwrapped, entities decoded, markup removed).
function cleanText(raw) {
  if (raw == null) return '';
  let out = String(raw).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  out = decodeEntities(out);
  out = out.replace(/<\/?[a-z][^>]*>/gi, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

function tagContent(block, name) {
  const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}\\s*>`, 'i').exec(block);
  return match ? match[1] : '';
}

function safeHttpUrl(raw) {
  const text = cleanText(raw);
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

/**
 * Small tolerant RSS 2.0 parser. Returns raw-ish items:
 * `[{ title, link, pubDate, source, sourceUrl }]` (strings, '' when absent).
 */
export function parseRss(xml) {
  const items = [];
  if (typeof xml !== 'string' || !xml) return items;
  const re = /<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi;
  let match;
  while ((match = re.exec(xml)) !== null && items.length < MAX_RSS_ITEMS) {
    const block = match[1];
    const sourceMatch = /<source\b([^>]*)>([\s\S]*?)<\/source\s*>/i.exec(block);
    const urlAttr = sourceMatch ? /\burl\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(sourceMatch[1]) : null;
    let link = safeHttpUrl(tagContent(block, 'link'));
    if (!link) {
      const guid = /<guid\b([^>]*)>([\s\S]*?)<\/guid\s*>/i.exec(block);
      if (guid && !/isPermaLink\s*=\s*["']false["']/i.test(guid[1])) link = safeHttpUrl(guid[2]);
    }
    items.push({
      title: cleanText(tagContent(block, 'title')),
      link,
      pubDate: cleanText(tagContent(block, 'pubDate')) || cleanText(tagContent(block, 'dc:date')),
      source: sourceMatch ? cleanText(sourceMatch[2]) : '',
      sourceUrl: urlAttr ? decodeEntities(urlAttr[1] ?? urlAttr[2] ?? '').trim() : '',
    });
  }
  return items;
}

function normaliseTitle(title) {
  return String(title).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
}

function clampLimit(limit, fallback) {
  const n = Math.floor(Number(limit));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 0), MAX_KEPT);
}

function normaliseTicker(ticker) {
  if (typeof ticker !== 'string') return null;
  const upper = ticker.trim().toUpperCase();
  return TICKER_RE.test(upper) ? upper : null;
}

function secUserAgent() {
  const fromEnv = typeof process !== 'undefined' && process.env ? process.env.SEC_USER_AGENT : '';
  const cleaned = String(fromEnv || '').replace(/[^\x20-\x7E]+/g, ' ').trim();
  return cleaned || DEFAULT_SEC_UA;
}

// Extra options (`now`, `timeoutMs`) exist for tests; production wiring passes only { config, store }.
export function createResearch({ config, store, fetchImpl = fetch, now = Date.now, timeoutMs = 8000 } = {}) {
  void config;
  const memory = new Map(); // key -> { at, exp, data }
  const inflight = new Map(); // key -> Promise<data>
  let tickerMap = null; // { exp, map: Map<TICKER, { cik, name }> }
  let tickerMapPending = null;

  // ---------- cache ----------

  function readStoreEntry(key) {
    try {
      if (!store || typeof store.get !== 'function') return null;
      const all = store.get(CACHE_COLLECTION, {});
      const entry = all && typeof all === 'object' ? all[key] : null;
      if (!entry || typeof entry !== 'object' || typeof entry.exp !== 'number') return null;
      return entry;
    } catch {
      return null;
    }
  }

  function writeStoreEntry(key, entry) {
    try {
      if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') return;
      const current = store.get(CACHE_COLLECTION, {});
      const t = now();
      const next = {};
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        for (const [k, v] of Object.entries(current)) {
          if (v && typeof v === 'object' && typeof v.exp === 'number' && v.exp > t) next[k] = v;
        }
      }
      next[key] = entry;
      const keys = Object.keys(next);
      if (keys.length > MAX_CACHE_ENTRIES) {
        keys.sort((a, b) => (next[a].at || 0) - (next[b].at || 0));
        for (const k of keys.slice(0, keys.length - MAX_CACHE_ENTRIES)) delete next[k];
      }
      store.set(CACHE_COLLECTION, next);
    } catch {
      // The cache mirror is best effort; research must keep working without it.
    }
  }

  function cacheGet(key) {
    const t = now();
    const hit = memory.get(key);
    if (hit) {
      if (hit.exp > t) return hit.data;
      memory.delete(key);
    }
    const stored = readStoreEntry(key);
    if (stored && stored.exp > t && stored.data !== undefined) {
      memory.set(key, stored);
      return stored.data;
    }
    return undefined;
  }

  function cacheSet(key, data, ttlMs, { persist = true } = {}) {
    const t = now();
    const entry = { at: t, exp: t + ttlMs, data };
    memory.delete(key);
    memory.set(key, entry);
    if (memory.size > MAX_CACHE_ENTRIES) {
      for (const [k, v] of memory) if (v.exp <= t) memory.delete(k);
      while (memory.size > MAX_CACHE_ENTRIES) memory.delete(memory.keys().next().value);
    }
    if (persist) writeStoreEntry(key, entry);
  }

  // ---------- http ----------

  async function fetchText(url, headers) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        try { controller.abort(); } catch { /* ignore */ }
        reject(new Error('research: request timed out'));
      }, timeoutMs);
    });
    const work = (async () => {
      const res = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal, redirect: 'follow' });
      if (!res || !res.ok) throw new Error(`research: HTTP ${res ? res.status : 'no response'}`);
      const text = await res.text();
      if (typeof text !== 'string') throw new Error('research: non-text body');
      if (text.length > MAX_BODY_CHARS) throw new Error('research: body too large');
      return text;
    })();
    work.catch(() => {}); // a late rejection after the timeout must not go unhandled
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- news ----------

  function toNewsItems(xml, defaultPublisher) {
    const t = now();
    const out = [];
    for (const item of parseRss(xml)) {
      if (!item.link || !item.title) continue;
      const ms = Date.parse(item.pubDate);
      if (!Number.isFinite(ms)) continue; // undated items cannot be shown as recent news
      if (ms < t - NEWS_MAX_AGE_MS || ms > t + FUTURE_SKEW_MS) continue;
      let title = item.title;
      let publisher = item.source;
      if (publisher) {
        // Google News titles read "Headline - Publisher".
        const suffix = ` - ${publisher}`;
        if (title.length > suffix.length && title.toLowerCase().endsWith(suffix.toLowerCase())) {
          title = title.slice(0, -suffix.length).trim();
        }
      } else if (!defaultPublisher) {
        const cut = title.lastIndexOf(' - ');
        if (cut > 0 && title.length - cut - 3 <= 60) {
          publisher = title.slice(cut + 3).trim();
          title = title.slice(0, cut).trim();
        }
      }
      if (!publisher) publisher = defaultPublisher || '';
      if (!publisher) {
        try { publisher = new URL(item.link).hostname.replace(/^www\./, ''); } catch { publisher = ''; }
      }
      if (!title) continue;
      out.push({
        title: title.slice(0, 300),
        publisher: publisher.slice(0, 120),
        date: new Date(ms).toISOString(),
        url: item.link,
      });
    }
    return out;
  }

  async function loadNews(ticker) {
    const symbol = ticker.replace(/\./g, '-'); // Yahoo writes share classes as BRK-B
    const googleUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(ticker)}+stock&hl=en-US&gl=US&ceid=US:en`;
    const yahooUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
    const headers = { 'User-Agent': RSS_UA, Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5' };

    const [google, yahoo] = await Promise.allSettled([fetchText(googleUrl, headers), fetchText(yahooUrl, headers)]);
    if (google.status !== 'fulfilled' && yahoo.status !== 'fulfilled') return { ok: false, data: [] };

    let merged = [];
    try { if (google.status === 'fulfilled') merged = merged.concat(toNewsItems(google.value, '')); } catch { /* keep the other source */ }
    try { if (yahoo.status === 'fulfilled') merged = merged.concat(toNewsItems(yahoo.value, 'Yahoo Finance')); } catch { /* keep the other source */ }

    merged.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const seenTitles = new Set();
    const seenUrls = new Set();
    const data = [];
    for (const item of merged) {
      const key = normaliseTitle(item.title);
      if (!key || seenTitles.has(key) || seenUrls.has(item.url)) continue;
      seenTitles.add(key);
      seenUrls.add(item.url);
      data.push(item);
      if (data.length >= MAX_KEPT) break;
    }
    return { ok: true, data };
  }

  // ---------- SEC EDGAR ----------

  function secHeaders() {
    return { 'User-Agent': secUserAgent(), Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate' };
  }

  async function loadTickerMap() {
    if (tickerMap && tickerMap.exp > now()) return tickerMap.map;
    if (!tickerMapPending) {
      tickerMapPending = (async () => {
        const json = JSON.parse(await fetchText('https://www.sec.gov/files/company_tickers.json', secHeaders()));
        const rows = Array.isArray(json) ? json : Object.values(json && typeof json === 'object' ? json : {});
        const map = new Map();
        for (const row of rows) {
          if (!row || typeof row !== 'object') continue;
          const symbol = String(row.ticker ?? '').trim().toUpperCase().replace(/\./g, '-');
          const cik = Number(row.cik_str ?? row.cik);
          if (!symbol || !Number.isInteger(cik) || cik <= 0 || cik > 9999999999) continue;
          if (!map.has(symbol)) map.set(symbol, { cik, name: cleanText(row.title ?? '') });
        }
        if (map.size === 0) throw new Error('research: empty SEC ticker list');
        tickerMap = { exp: now() + CIK_TTL_MS, map };
        return map;
      })().finally(() => { tickerMapPending = null; });
    }
    return tickerMapPending;
  }

  // -> { cik, name } | null (ticker unknown to the SEC). Throws when the list is unreachable.
  async function resolveCik(ticker) {
    const key = `cik:${ticker}`;
    const cached = cacheGet(key);
    if (cached && Number.isInteger(cached.cik)) return cached;
    const map = await loadTickerMap();
    const dashed = ticker.replace(/\./g, '-');
    const found = map.get(dashed) || map.get(dashed.replace(/-/g, '')) || null;
    if (found) cacheSet(key, found, CIK_TTL_MS);
    return found;
  }

  async function loadFilings(ticker) {
    let company;
    try {
      company = await resolveCik(ticker);
    } catch {
      return { ok: false, data: [] };
    }
    if (!company) return { ok: true, data: [] };

    let json;
    try {
      const padded = String(company.cik).padStart(10, '0');
      json = JSON.parse(await fetchText(`https://data.sec.gov/submissions/CIK${padded}.json`, secHeaders()));
    } catch {
      return { ok: false, data: [] };
    }

    const recent = json && json.filings && json.filings.recent;
    if (!recent || !Array.isArray(recent.accessionNumber)) return { ok: true, data: [] };
    const name = cleanText(json.name ?? '') || company.name || ticker;
    const column = (field, i) => (Array.isArray(recent[field]) ? recent[field][i] : undefined);

    const all = [];
    for (let i = 0; i < recent.accessionNumber.length; i += 1) {
      const accession = String(recent.accessionNumber[i] ?? '').trim();
      const form = cleanText(column('form', i) ?? '');
      const date = String(column('filingDate', i) ?? '').trim();
      if (!/^\d{10}-\d{2}-\d{6}$/.test(accession) || !form || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const description = cleanText(column('primaryDocDescription', i) ?? '');
      const title = description && description.toLowerCase() !== form.toLowerCase()
        ? `${name} ${form} — ${description}`
        : `${name} ${form}`;
      all.push({
        form: form.slice(0, 40),
        date,
        title: title.slice(0, 300),
        url: `https://www.sec.gov/Archives/edgar/data/${company.cik}/${accession.replace(/-/g, '')}/${accession}-index.htm`,
      });
    }
    all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // stable: keeps EDGAR order within a day
    const material = all.filter((f) => !NOISE_FORMS.test(f.form));
    return { ok: true, data: (material.length ? material : all).slice(0, MAX_KEPT) };
  }

  // ---------- shared entry point ----------

  async function cached(kind, ticker, limit, fallbackLimit, loader) {
    try {
      const symbol = normaliseTicker(ticker);
      if (!symbol) return [];
      const count = clampLimit(limit, fallbackLimit);
      const key = `${kind}:${symbol}`;

      let data = cacheGet(key);
      if (!Array.isArray(data)) {
        let pending = inflight.get(key);
        if (!pending) {
          pending = (async () => {
            const result = await loader(symbol);
            if (result.ok) cacheSet(key, result.data, CACHE_TTL_MS);
            else cacheSet(key, [], NEGATIVE_TTL_MS, { persist: false });
            return result.data;
          })().finally(() => inflight.delete(key));
          inflight.set(key, pending);
        }
        data = await pending;
      }
      return Array.isArray(data) ? data.slice(0, count).map((item) => ({ ...item })) : [];
    } catch {
      return [];
    }
  }

  return {
    // Options are read defensively (not destructured) so a null argument cannot throw.
    news(ticker, options) {
      return cached('news', ticker, options?.limit ?? 5, 5, loadNews);
    },
    filings(ticker, options) {
      return cached('filings', ticker, options?.limit ?? 3, 3, loadFilings);
    },
  };
}
