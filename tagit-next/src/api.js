// Live data service client: config, scanner and quotes, with shape validation.
import { positive, isSymbol } from './core/util.js';

export const ERROR_MESSAGES = {
  CONFIG_UNAVAILABLE: 'تعذر تحميل إعدادات الاتصال.',
  INVALID_ENDPOINT: 'عنوان خدمة البيانات غير صالح.',
  CURRENT_UNIVERSE_REQUIRED: 'مرجع الشركات يحتاج تحديثًا لدى الخادم.',
  RUNTIME_CREDENTIALS_NOT_CONFIGURED: 'لم تُضبط مفاتيح مزود الأسعار في الخادم.',
  PROVIDER_AUTH_FAILED: 'رفض مزود الأسعار الاتصال.',
  FEED_NOT_ENTITLED: 'الحساب لا يملك صلاحية مصدر الأسعار.',
  RATE_LIMITED: 'بلغ مزود الأسعار حد الطلبات.',
  PROVIDER_UNAVAILABLE: 'مزود الأسعار غير متاح حاليًا.',
  INVALID_RESPONSE: 'وصلت استجابة غير متوافقة؛ لم تُعرض.',
  TIMEOUT: 'انتهت مهلة الطلب؛ قد يكون الخادم المجاني في طور التشغيل.',
  NETWORK: 'تعذر الوصول إلى خدمة البيانات.',
};
export const errorMessage = (code) => ERROR_MESSAGES[code] ?? 'لم تصل بيانات جديدة.';

export class ApiError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** Read live-config.json and return the https origin of the data service. */
export async function loadEndpoint(fetcher = fetch) {
  let config;
  try {
    const r = await fetcher('live-config.json', { cache: 'no-store' });
    if (!r.ok) throw new Error();
    config = await r.json();
  } catch {
    throw new ApiError('CONFIG_UNAVAILABLE');
  }
  try {
    const url = new URL(config.endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    throw new ApiError('INVALID_ENDPOINT');
  }
}

async function getJson(fetcher, url, timeoutMs) {
  let response;
  try {
    response = await fetcher(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new ApiError(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK');
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(response.ok ? 'INVALID_RESPONSE' : 'PROVIDER_UNAVAILABLE');
  }
  return { ok: response.ok, body };
}

/** Validate a scanner payload; rows with malformed symbols are dropped. */
export function validateScanner(p) {
  if (p?.schema_version !== 1 || !Array.isArray(p.rows) || !p.coverage || typeof p.coverage !== 'object') return null;
  if (!Number.isFinite(Date.parse(p.server_time))) return null;
  return {
    ...p,
    rows: p.rows.filter((r) => isSymbol(r?.symbol)),
    alerts: Array.isArray(p.alerts) ? p.alerts : [],
    gainers: Array.isArray(p.gainers) ? p.gainers.filter(isSymbol) : null,
  };
}

/** Map a quote-service row onto the market-row fields used by mergeMarketRow. */
export function normalizeQuote(r) {
  if (!isSymbol(r?.symbol)) return null;
  return {
    symbol: r.symbol,
    name: typeof r.name === 'string' ? r.name : undefined,
    market_cap: positive(r.market_cap) ? r.market_cap : undefined,
    metadata_at: r.metadata_at,
    price: r.trade?.price,
    price_at: r.trade?.timestamp,
    bid: r.quote?.bid,
    ask: r.quote?.ask,
    quote_at: r.quote?.timestamp,
  };
}

export function createClient(endpoint, fetcher = fetch) {
  return {
    async scanner(timeoutMs = 90_000) {
      const { ok, body } = await getJson(fetcher, `${endpoint}/api/scanner`, timeoutMs);
      if (!ok) throw new ApiError(body?.status ?? 'PROVIDER_UNAVAILABLE');
      const valid = validateScanner(body);
      if (!valid) throw new ApiError('INVALID_RESPONSE');
      return valid;
    },
    async quotes(symbols, timeoutMs = 12_000) {
      const query = encodeURIComponent(symbols.join(','));
      const { ok, body } = await getJson(fetcher, `${endpoint}/api/quotes?symbols=${query}`, timeoutMs);
      // Every requested symbol outside the eligible universe: not a connection failure.
      if (body?.status === 'INELIGIBLE_SYMBOLS') return { rows: [], rejected: body.rejected ?? symbols };
      if (!ok) throw new ApiError(body?.status ?? 'PROVIDER_UNAVAILABLE');
      if (!Array.isArray(body?.rows)) throw new ApiError('INVALID_RESPONSE');
      return {
        rows: body.rows.map(normalizeQuote).filter(Boolean),
        rejected: Array.isArray(body.rejected) ? body.rejected.filter(isSymbol) : [],
        feed: body.feed,
      };
    },
  };
}
