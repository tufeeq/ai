// Market Insights builder: writes tagit-next/data/insights.json (schema_version 1, see INSIGHTS-BRIEF.md).
//
// Sources (all free):
//   - tag/data/universe-broad.json (Finviz Elite snapshot, ~15 min, filter avg volume > 50K): breadth,
//     sector/industry aggregates, movers. Funds, ETFs and shell companies are excluded from stock stats.
//   - Render relay /api/lab/provider (Alpaca): 1Day SIP bars (≥16 min old) for index/sector/macro ETFs,
//     news for movers and the largest companies, the trading calendar. Paced ≥3.1 s, hard cap 40 requests.
//   - api.nasdaq.com (unofficial): earnings and economic calendars.
//
// Integrity: every number carries its source time; unknowns are null, never 0; no buy/sell language;
// a news item is linked to a move only by symbol match + time proximity, and says so.
//
// Usage: node insights.mjs --universe path/to/universe-broad.json [--out path] [--offline]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SERVICE = process.env.TAGIT_SERVICE || 'https://tagit-next-quotes.onrender.com';
const OUT_DEFAULT = fileURLToPath(new URL('../data/insights.json', import.meta.url));
const DAY = 86_400_000;

// ---- labels ------------------------------------------------------------------------------------

export const INDEX_ETFS = {
  SPY: 'مؤشر إس آند بي 500', QQQ: 'مؤشر ناسداك 100', IWM: 'مؤشر راسل 2000 للشركات الصغيرة', DIA: 'مؤشر داو جونز الصناعي',
  SMH: 'أشباه الموصلات', XBI: 'التكنولوجيا الحيوية', ARKK: 'أسهم الابتكار عالية النمو',
  TLT: 'سندات الخزانة الأمريكية طويلة الأجل', GLD: 'الذهب', USO: 'النفط الخام', UUP: 'الدولار الأمريكي', VIXY: 'عقود التقلب (VIX) قصيرة الأجل',
};
export const SECTORS = {
  Technology: ['التكنولوجيا', 'XLK'], Financial: ['القطاع المالي', 'XLF'], Healthcare: ['الرعاية الصحية', 'XLV'],
  Industrials: ['الصناعات', 'XLI'], 'Consumer Cyclical': ['السلع الاستهلاكية الكمالية', 'XLY'],
  'Consumer Defensive': ['السلع الاستهلاكية الأساسية', 'XLP'], Energy: ['الطاقة', 'XLE'], 'Basic Materials': ['المواد الأساسية', 'XLB'],
  'Communication Services': ['خدمات الاتصالات', 'XLC'], 'Real Estate': ['العقارات', 'XLRE'], Utilities: ['المرافق العامة', 'XLU'],
};
export const ETF_SYMBOLS = [...Object.keys(INDEX_ETFS), ...Object.values(SECTORS).map((s) => s[1])];

export const INDUSTRY_AR = {
  'Agricultural Inputs': 'مدخلات زراعية', Aluminum: 'الألمنيوم', 'Building Materials': 'مواد البناء', Chemicals: 'الكيماويات',
  'Coking Coal': 'فحم الكوك', Copper: 'النحاس', Gold: 'الذهب', 'Lumber & Wood Production': 'الأخشاب ومنتجاتها',
  'Other Industrial Metals & Mining': 'تعدين المعادن الصناعية الأخرى', 'Other Precious Metals & Mining': 'تعدين المعادن النفيسة الأخرى',
  'Paper & Paper Products': 'الورق ومنتجاته', Silver: 'الفضة', 'Specialty Chemicals': 'الكيماويات المتخصصة', Steel: 'الصلب',
  'Advertising Agencies': 'وكالات الإعلان', Broadcasting: 'البث الإذاعي والتلفزيوني', 'Electronic Gaming & Multimedia': 'الألعاب الإلكترونية والوسائط المتعددة',
  Entertainment: 'الترفيه', 'Internet Content & Information': 'محتوى ومعلومات الإنترنت', Publishing: 'النشر', 'Telecom Services': 'خدمات الاتصالات',
  'Apparel Manufacturing': 'صناعة الملابس', 'Apparel Retail': 'تجزئة الملابس', 'Auto & Truck Dealerships': 'وكلاء السيارات والشاحنات',
  'Auto Manufacturers': 'صناعة السيارات', 'Auto Parts': 'قطع غيار السيارات', 'Department Stores': 'المتاجر متعددة الأقسام',
  'Footwear & Accessories': 'الأحذية والإكسسوارات', 'Furnishings, Fixtures & Appliances': 'الأثاث والتجهيزات والأجهزة المنزلية', Gambling: 'المراهنات',
  'Home Improvement Retail': 'تجزئة مستلزمات تحسين المنازل', 'Internet Retail': 'التجارة الإلكترونية', Leisure: 'الترفيه والتسلية', Lodging: 'الفنادق والإقامة',
  'Luxury Goods': 'السلع الفاخرة', 'Packaging & Containers': 'التغليف والحاويات', 'Personal Services': 'الخدمات الشخصية',
  'Recreational Vehicles': 'المركبات الترفيهية', 'Residential Construction': 'البناء السكني', 'Resorts & Casinos': 'المنتجعات والكازينوهات',
  Restaurants: 'المطاعم', 'Specialty Retail': 'التجزئة المتخصصة', 'Textile Manufacturing': 'صناعة المنسوجات', 'Travel Services': 'خدمات السفر',
  'Beverages - Brewers': 'المشروبات - مصانع الجعة', 'Beverages - Non-Alcoholic': 'المشروبات غير الكحولية', 'Beverages - Wineries & Distilleries': 'المشروبات - معامل التقطير',
  Confectioners: 'الحلويات', 'Discount Stores': 'متاجر الخصم', 'Education & Training Services': 'خدمات التعليم والتدريب', 'Farm Products': 'المنتجات الزراعية',
  'Food Distribution': 'توزيع الأغذية', 'Grocery Stores': 'متاجر البقالة', 'Household & Personal Products': 'المنتجات المنزلية والشخصية',
  'Packaged Foods': 'الأغذية المعلبة', Tobacco: 'التبغ', 'Oil & Gas Drilling': 'حفر النفط والغاز', 'Oil & Gas E&P': 'استكشاف وإنتاج النفط والغاز',
  'Oil & Gas Equipment & Services': 'معدات وخدمات النفط والغاز', 'Oil & Gas Integrated': 'شركات النفط والغاز المتكاملة', 'Oil & Gas Midstream': 'نقل وتخزين النفط والغاز',
  'Oil & Gas Refining & Marketing': 'تكرير وتسويق النفط والغاز', 'Thermal Coal': 'الفحم الحراري', Uranium: 'اليورانيوم', 'Asset Management': 'إدارة الأصول',
  'Banks - Diversified': 'البنوك المتنوعة', 'Banks - Regional': 'البنوك الإقليمية', 'Capital Markets': 'أسواق المال', 'Credit Services': 'خدمات الائتمان',
  'Financial Conglomerates': 'التكتلات المالية', 'Financial Data & Stock Exchanges': 'البيانات المالية والبورصات', 'Insurance - Diversified': 'التأمين المتنوع',
  'Insurance - Life': 'التأمين على الحياة', 'Insurance - Property & Casualty': 'تأمين الممتلكات والحوادث', 'Insurance - Reinsurance': 'إعادة التأمين',
  'Insurance - Specialty': 'التأمين المتخصص', 'Insurance Brokers': 'وساطة التأمين', 'Mortgage Finance': 'التمويل العقاري', Biotechnology: 'التكنولوجيا الحيوية',
  'Diagnostics & Research': 'التشخيص والأبحاث', 'Drug Manufacturers - General': 'صناعة الأدوية الكبرى', 'Drug Manufacturers - Specialty & Generic': 'الأدوية المتخصصة والجنيسة',
  'Health Information Services': 'خدمات المعلومات الصحية', 'Healthcare Plans': 'خطط التأمين الصحي', 'Medical Care Facilities': 'مرافق الرعاية الطبية',
  'Medical Devices': 'الأجهزة الطبية', 'Medical Distribution': 'التوزيع الطبي', 'Medical Instruments & Supplies': 'الأدوات والمستلزمات الطبية',
  'Pharmaceutical Retailers': 'الصيدليات', 'Aerospace & Defense': 'الطيران والدفاع', Airlines: 'شركات الطيران', 'Airports & Air Services': 'المطارات والخدمات الجوية',
  'Building Products & Equipment': 'منتجات ومعدات البناء', 'Business Equipment & Supplies': 'المعدات واللوازم المكتبية', Conglomerates: 'التكتلات الصناعية',
  'Consulting Services': 'الخدمات الاستشارية', 'Electrical Equipment & Parts': 'المعدات والقطع الكهربائية', 'Engineering & Construction': 'الهندسة والإنشاءات',
  'Farm & Heavy Construction Machinery': 'الآلات الزراعية ومعدات البناء الثقيلة', 'Industrial Distribution': 'التوزيع الصناعي',
  'Infrastructure Operations': 'تشغيل البنية التحتية', 'Integrated Freight & Logistics': 'الشحن والخدمات اللوجستية', 'Marine Shipping': 'الشحن البحري',
  'Metal Fabrication': 'تشكيل المعادن', 'Pollution & Treatment Controls': 'مكافحة التلوث والمعالجة', Railroads: 'السكك الحديدية',
  'Rental & Leasing Services': 'خدمات التأجير', 'Security & Protection Services': 'خدمات الأمن والحماية', 'Specialty Business Services': 'خدمات الأعمال المتخصصة',
  'Specialty Industrial Machinery': 'الآلات الصناعية المتخصصة', 'Staffing & Employment Services': 'خدمات التوظيف', 'Tools & Accessories': 'الأدوات وملحقاتها',
  Trucking: 'النقل بالشاحنات', 'Waste Management': 'إدارة النفايات', 'REIT - Diversified': 'صناديق الاستثمار العقاري المتنوعة',
  'REIT - Healthcare Facilities': 'صناديق عقارية - مرافق صحية', 'REIT - Hotel & Motel': 'صناديق عقارية - فنادق', 'REIT - Industrial': 'صناديق عقارية - صناعية',
  'REIT - Mortgage': 'صناديق عقارية - رهون', 'REIT - Office': 'صناديق عقارية - مكاتب', 'REIT - Residential': 'صناديق عقارية - سكنية',
  'REIT - Retail': 'صناديق عقارية - تجزئة', 'REIT - Specialty': 'صناديق عقارية متخصصة', 'Real Estate - Development': 'التطوير العقاري',
  'Real Estate - Diversified': 'العقارات المتنوعة', 'Real Estate Services': 'الخدمات العقارية', 'Communication Equipment': 'معدات الاتصالات',
  'Computer Hardware': 'عتاد الحاسوب', 'Consumer Electronics': 'الإلكترونيات الاستهلاكية', 'Electronic Components': 'المكونات الإلكترونية',
  'Electronics & Computer Distribution': 'توزيع الإلكترونيات والحواسيب', 'Information Technology Services': 'خدمات تقنية المعلومات',
  'Scientific & Technical Instruments': 'الأجهزة العلمية والتقنية', 'Semiconductor Equipment & Materials': 'معدات ومواد أشباه الموصلات',
  Semiconductors: 'أشباه الموصلات', 'Software - Application': 'البرمجيات التطبيقية', 'Software - Infrastructure': 'برمجيات البنية التحتية', Solar: 'الطاقة الشمسية',
  'Utilities - Diversified': 'المرافق المتنوعة', 'Utilities - Independent Power Producers': 'منتجو الكهرباء المستقلون',
  'Utilities - Regulated Electric': 'مرافق الكهرباء المنظمة', 'Utilities - Regulated Gas': 'مرافق الغاز المنظمة', 'Utilities - Regulated Water': 'مرافق المياه المنظمة',
  'Utilities - Renewable': 'مرافق الطاقة المتجددة',
};

const EXCLUDED_INDUSTRY = /^(Exchange Traded Fund|Closed-End Fund|Shell Companies)/;
export const SMALL_CAP_M = 300;
export const UNUSUAL_RVOL = 3;
export const MIN_INDUSTRY = 5;

// ---- small helpers -----------------------------------------------------------------------------

const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const pct = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b > 0 ? (a / b - 1) * 100 : null);
const num = (s) => {
  const t = String(s ?? '').replace(/[%,$\s]/g, '');
  if (!t || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
export function median(xs) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
/** Arabic count agreement: 3–10 take the plural noun, everything else the singular. */
export const countAr = (n, one, many, two) => (n === 2 && two ? two : `${n} ${n >= 3 && n <= 10 ? many : one}`);
const signed = (x, d = 1) => (x == null ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(d)}%`);
const nyDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const nyClockFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const nyDate = (t) => nyDateFmt.format(new Date(t));
function nyMinutes(t) {
  const p = Object.fromEntries(nyClockFmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, minutes: (+p.hour % 24) * 60 + +p.minute };
}
/** Epoch ms of a New York wall time (YYYY-MM-DD, "HH:MM"). */
export function nyTime(day, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  for (const off of [4, 5]) {
    const t = Date.parse(`${day}T00:00:00Z`) + (h + off) * 3_600_000 + m * 60_000;
    if (nyDate(t) === day && nyMinutes(t).minutes === h * 60 + m) return t;
  }
  return null;
}

// ---- calendar / market state -------------------------------------------------------------------

/** Trading days from the relay calendar ([{date, open, close}]); weekdays as a fallback. */
export function tradingDays(calendar, now) {
  if (Array.isArray(calendar) && calendar.length) return calendar.map((d) => ({ date: d.date, open: d.open, close: d.close }));
  const out = [];
  for (let t = now - 15 * DAY; t <= now + 15 * DAY; t += DAY) {
    const d = nyDate(t);
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd && wd !== 6 && !out.some((x) => x.date === d)) out.push({ date: d, open: '09:30', close: '16:00' });
  }
  return out;
}

/** PRE 04:00–open, OPEN open–close, AFTER close–20:00 (exchange calendar aware), else CLOSED. */
export function marketState(now, days) {
  const today = nyDate(now), d = days.find((x) => x.date === today);
  if (!d) return 'CLOSED';
  const { minutes } = nyMinutes(now);
  const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  if (minutes >= 240 && minutes < toMin(d.open)) return 'PRE';
  if (minutes >= toMin(d.open) && minutes < toMin(d.close)) return 'OPEN';
  if (minutes >= toMin(d.close) && minutes < 1200) return 'AFTER';
  return 'CLOSED';
}

/** The session a snapshot's day change refers to: today once the bell has rung, else the last trading day. */
export function sessionOf(at, days) {
  const day = nyDate(at);
  const d = days.find((x) => x.date === day);
  if (d && at >= nyTime(day, d.open)) return d;
  return [...days].reverse().find((x) => x.date < day) ?? null;
}
export function previousDay(day, days) { return [...days].reverse().find((x) => x.date < day) ?? null; }
/** Calendar day for "earnings today": today before 20:00 ET on a trading day, else the next trading day. */
export function calendarDay(now, days) {
  const today = nyDate(now), d = days.find((x) => x.date === today);
  if (d && nyMinutes(now).minutes < 1200) return d.date;
  return days.find((x) => x.date > today)?.date ?? null;
}

// ---- universe ----------------------------------------------------------------------------------

/** Finviz rows → stock records (funds, ETFs, shells and rows without a change are dropped). */
export function parseUniverse(rows) {
  const out = [];
  for (const r of rows ?? []) {
    if (!r?.Ticker || EXCLUDED_INDUSTRY.test(r.Industry ?? '')) continue;
    const chg = num(r.Change), price = num(r.Price), vol = num(r.Volume), avg = num(r['Avg Volume']);
    if (chg == null || !(price > 0)) continue;
    out.push({
      symbol: r.Ticker, company: r.Company ?? null, sector: r.Sector || null, industry: r.Industry || null,
      price, chg, volume: vol, avg_volume: avg != null ? avg * 1000 : null, cap: num(r['Market Cap']),
      rvol: vol != null && avg > 0 ? vol / (avg * 1000) : null,
    });
  }
  return out;
}

export function breadth(stocks, scope) {
  const adv = stocks.filter((s) => s.chg > 0).length, dec = stocks.filter((s) => s.chg < 0).length;
  return {
    universe: stocks.length, scope, count: stocks.length, advancers: adv, decliners: dec, unchanged: stocks.length - adv - dec,
    adv_dec_ratio: dec ? r2(adv / dec) : null,
    pct_above_0: stocks.length ? r2((adv / stocks.length) * 100) : null,
    new_high_20d: null, // not in the Finviz snapshot; left null rather than estimated
    up_5pct: stocks.filter((s) => s.chg >= 5).length, down_5pct: stocks.filter((s) => s.chg <= -5).length,
    unusual_volume: stocks.filter((s) => s.rvol >= UNUSUAL_RVOL).length,
    median_chg_pct: r2(median(stocks.map((s) => s.chg))),
  };
}

/** Aggregates for a group: cap-weighted change, median change, % up, dollar-weighted relative volume. */
export function groupStats(list) {
  let cw = 0, cs = 0, dv = 0, da = 0;
  for (const s of list) {
    if (s.cap > 0) { cw += s.cap * s.chg; cs += s.cap; }
    if (s.volume != null && s.avg_volume > 0) { dv += s.volume * s.price; da += s.avg_volume * s.price; }
  }
  return {
    chg_1d_pct: cs ? r2(cw / cs) : null, median_chg_pct: r2(median(list.map((s) => s.chg))),
    breadth_pct_up: list.length ? r2((list.filter((s) => s.chg > 0).length / list.length) * 100) : null,
    rel_volume: da ? r2(dv / da) : null, count: list.length,
  };
}
const groupBy = (xs, key) => { const m = new Map(); for (const x of xs) if (x[key]) (m.get(x[key]) ?? m.set(x[key], []).get(x[key])).push(x); return m; };

export function sectorTable(stocks, etf) {
  return [...groupBy(stocks, 'sector')].filter(([s]) => SECTORS[s]).map(([sector, list]) => {
    const [name_ar, sym] = SECTORS[sector], e = etf[sym];
    return { sector, name_ar, ...groupStats(list), etf: sym, etf_chg_1d_pct: e?.chg_1d_pct ?? null, etf_chg_5d_pct: e?.chg_5d_pct ?? null, etf_chg_1m_pct: e?.chg_1m_pct ?? null, etf_above_50dma: e?.above_50dma ?? null };
  }).sort((a, b) => (b.chg_1d_pct ?? -1e9) - (a.chg_1d_pct ?? -1e9));
}

/** Industries with ≥ MIN_INDUSTRY stocks, ranked by median change (robust to one mega cap). */
export function industryTable(stocks, n = 10) {
  const rows = [...groupBy(stocks, 'industry')].filter(([, l]) => l.length >= MIN_INDUSTRY).map(([industry, list]) => ({
    industry, name_ar: INDUSTRY_AR[industry] ?? null, sector: list[0].sector, ...groupStats(list), _list: list,
  })).sort((a, b) => b.median_chg_pct - a.median_chg_pct || b.breadth_pct_up - a.breadth_pct_up);
  const lead = (row, dir) => ({ ...row, _list: undefined, leaders: [...row._list].sort((a, b) => dir * (b.chg - a.chg)).slice(0, 3).map((s) => ({ symbol: s.symbol, chg_pct: s.chg })) });
  return { top: rows.slice(0, n).map((r) => lead(r, 1)), bottom: rows.slice(-n).reverse().map((r) => lead(r, -1)), all: rows };
}

/** Movers among tradeable names: price ≥ $1, cap ≥ $50M, ≥ $1M traded today. */
export function movers(stocks, n = 15) {
  const ok = stocks.filter((s) => s.price >= 1 && s.cap >= 50 && s.volume * s.price >= 1e6);
  const row = (s) => ({ symbol: s.symbol, company: s.company, sector: s.sector, industry: s.industry, price: s.price, chg_pct: s.chg, rel_volume: r2(s.rvol), market_cap_m: s.cap, news_ids: [] });
  return {
    gainers: [...ok].filter((s) => s.chg > 0).sort((a, b) => b.chg - a.chg).slice(0, n).map(row),
    losers: [...ok].filter((s) => s.chg < 0).sort((a, b) => a.chg - b.chg).slice(0, n).map(row),
    unusual_volume: ok.filter((s) => s.rvol >= UNUSUAL_RVOL && s.volume >= 300_000).sort((a, b) => b.rvol - a.rvol).slice(0, n).map(row),
  };
}

// ---- ETF trend ---------------------------------------------------------------------------------

/** Daily bars ([{t, c}] ascending) → returns, MA position and a 30-close spark. */
export function etfStats(bars) {
  const b = (bars ?? []).filter((x) => x?.c > 0);
  if (b.length < 2) return null;
  const c = b.map((x) => x.c), last = c.at(-1), back = (k) => (c.length > k ? c.at(-1 - k) : null);
  const ma = (k) => (c.length >= k ? c.slice(-k).reduce((a, x) => a + x, 0) / k : null);
  const lastDay = nyDate(Date.parse(b.at(-1).t));
  const prevYear = [...b].reverse().find((x) => nyDate(Date.parse(x.t)).slice(0, 4) < lastDay.slice(0, 4));
  const ma50 = ma(50), ma200 = ma(200);
  return {
    last: r2(last), last_bar_date: lastDay,
    chg_1d_pct: r2(pct(last, back(1))), chg_5d_pct: r2(pct(last, back(5))), chg_1m_pct: r2(pct(last, back(21))),
    chg_3m_pct: r2(pct(last, back(63))), chg_ytd_pct: prevYear ? r2(pct(last, prevYear.c)) : null,
    chg_prev_5d_pct: r2(pct(back(5), back(10))),
    above_50dma: ma50 == null ? null : last > ma50, above_200dma: ma200 == null ? null : last > ma200,
    dist_50dma_pct: r2(pct(last, ma50)), crossed_50dma_3d: ma50 == null || c.length < 53 ? null : (() => {
      const then = c.at(-4), ma50then = c.slice(-53, -3).reduce((a, x) => a + x, 0) / 50;
      return (last > ma50) !== (then > ma50then) ? (last > ma50 ? 'UP' : 'DOWN') : null;
    })(),
    spark: c.slice(-30).map(r2),
  };
}

// ---- regime ------------------------------------------------------------------------------------

/**
 * Rule-based regime (regime-1). Score components, each +1 / −1 / 0:
 *   SPY above/below its 50-day MA; SPY above/below its 200-day MA; QQQ above/below 50-day; IWM above/below 50-day;
 *   all-stock breadth: advance/decline ratio ≥ 1.5 → +1, ≤ 0.67 → −1;
 *   VIXY 5-day change ≤ −5% → +1, ≥ +10% → −1 (volatility demand);
 *   flight to safety: TLT 5d ≥ +1% while SPY 5d ≤ −1% → −1.
 * Label: score ≥ 4 risk-on; 2..3 cautiously positive; −1..1 mixed; −3..−2 cautious/defensive; ≤ −4 risk-off.
 */
export function regime(etf, all) {
  const reasons = [], parts = [];
  const add = (v, text) => { if (v) { parts.push(v); reasons.push(text); } };
  const ma = (sym, key, label) => {
    const v = etf[sym]?.[key];
    if (v == null) return;
    add(v ? 1 : -1, `${INDEX_ETFS[sym]} (${sym}) ${v ? 'فوق' : 'تحت'} متوسط ${label} يومًا`);
  };
  ma('SPY', 'above_50dma', '50'); ma('SPY', 'above_200dma', '200'); ma('QQQ', 'above_50dma', '50'); ma('IWM', 'above_50dma', '50');
  const ad = all?.adv_dec_ratio;
  if (ad != null && ad >= 1.5) add(1, `اتساع السوق إيجابي: ${all.advancers} سهمًا صاعدًا مقابل ${all.decliners} هابطًا (نسبة ${ad})`);
  else if (ad != null && ad <= 0.67) add(-1, `اتساع السوق سلبي: ${all.decliners} سهمًا هابطًا مقابل ${all.advancers} صاعدًا (نسبة ${ad})`);
  const vx = etf.VIXY?.chg_5d_pct;
  if (vx != null && vx <= -5) add(1, `تراجع الطلب على التحوط من التقلب: VIXY ${signed(vx)} خلال 5 جلسات`);
  else if (vx != null && vx >= 10) add(-1, `ارتفاع الطلب على التحوط من التقلب: VIXY ${signed(vx)} خلال 5 جلسات`);
  const tlt = etf.TLT?.chg_5d_pct, spy = etf.SPY?.chg_5d_pct;
  if (tlt != null && spy != null && tlt >= 1 && spy <= -1) add(-1, `لجوء إلى الملاذات: السندات الطويلة ${signed(tlt)} مقابل ${signed(spy)} للمؤشر خلال 5 جلسات`);
  const score = parts.reduce((a, x) => a + x, 0);
  const [key, label_ar] = !parts.length ? ['UNKNOWN', 'غير محدد — بيانات غير كافية']
    : score >= 4 ? ['RISK_ON', 'شهية مخاطرة مرتفعة'] : score >= 2 ? ['LEAN_POSITIVE', 'ميل إيجابي حذر']
      : score >= -1 ? ['MIXED', 'إشارات مختلطة'] : score >= -3 ? ['DEFENSIVE', 'ميل دفاعي'] : ['RISK_OFF', 'عزوف عن المخاطرة'];
  return { key, label_ar, score, max_score: 7, reasons_ar: reasons, rules: 'regime-1: SPY 50/200DMA, QQQ 50DMA, IWM 50DMA, A/D ≥1.5|≤0.67, VIXY 5d ≤−5|≥+10, TLT↑/SPY↓' };
}

// ---- trends (rule-generated observations) -------------------------------------------------------

export function trends({ etf, sectors, industries, all, small }) {
  const out = [], add = (id, horizon, title_ar, detail_ar, evidence) => out.push({ id, title_ar, detail_ar, evidence, horizon });
  const spy = etf.SPY;
  const sect = sectors.filter((s) => s.etf_chg_5d_pct != null && spy?.chg_5d_pct != null);
  if (sect.length) {
    const best = [...sect].sort((a, b) => b.etf_chg_5d_pct - a.etf_chg_5d_pct)[0];
    const worst = [...sect].sort((a, b) => a.etf_chg_5d_pct - b.etf_chg_5d_pct)[0];
    for (const [s, up] of [[best, true], [worst, false]]) {
      const e = etf[s.etf], rel = s.etf_chg_5d_pct - spy.chg_5d_pct;
      const prevRel = e?.chg_prev_5d_pct != null && spy.chg_prev_5d_pct != null ? e.chg_prev_5d_pct - spy.chg_prev_5d_pct : null;
      const streak = prevRel != null && (up ? prevRel > 0 : prevRel < 0);
      add(`sector-5d-${up ? 'lead' : 'lag'}-${s.etf}`, '5D',
        `${s.name_ar} (${s.etf}) ${up ? 'في صدارة' : 'في ذيل'} القطاعات ${streak ? 'للأسبوع الثاني على التوالي' : 'هذا الأسبوع'}`,
        `صندوق ${s.etf} ${signed(s.etf_chg_5d_pct)} خلال 5 جلسات مقابل ${signed(spy.chg_5d_pct)} لـ SPY (فارق ${signed(rel)}).${streak ? ` وفي الأسبوع السابق كان الفارق ${signed(prevRel)}.` : ''}`,
        [{ metric: `${s.etf} 5D`, value: s.etf_chg_5d_pct }, { metric: 'SPY 5D', value: spy.chg_5d_pct }, { metric: `${s.etf} vs SPY prev 5D`, value: r2(prevRel) }]);
    }
  }
  if (etf.IWM?.chg_5d_pct != null && spy?.chg_5d_pct != null) {
    const d = etf.IWM.chg_5d_pct - spy.chg_5d_pct;
    if (Math.abs(d) >= 1) add('smallcaps-vs-large-5d', '5D', d > 0 ? 'الشركات الصغيرة تتفوق على الكبيرة هذا الأسبوع' : 'الشركات الصغيرة تتأخر عن الكبيرة هذا الأسبوع',
      `IWM ${signed(etf.IWM.chg_5d_pct)} مقابل SPY ${signed(spy.chg_5d_pct)} خلال 5 جلسات (فارق ${signed(d)}).`,
      [{ metric: 'IWM 5D', value: etf.IWM.chg_5d_pct }, { metric: 'SPY 5D', value: spy.chg_5d_pct }]);
  }
  const avg = (syms) => { const v = syms.map((s) => etf[s]?.chg_5d_pct).filter(Number.isFinite); return v.length === syms.length ? v.reduce((a, x) => a + x, 0) / v.length : null; };
  const growth = avg(['XLK', 'XLY', 'XLC']), defensive = avg(['XLP', 'XLU', 'XLV']);
  if (growth != null && defensive != null && Math.abs(growth - defensive) >= 1.5) {
    add('rotation-5d', '5D', growth > defensive ? 'تدفق نحو قطاعات النمو على حساب الدفاعية' : 'تدوير نحو القطاعات الدفاعية على حساب النمو',
      `متوسط XLK وXLY وXLC ${signed(growth)} مقابل ${signed(defensive)} لمتوسط XLP وXLU وXLV خلال 5 جلسات.`,
      [{ metric: 'Growth avg 5D (XLK,XLY,XLC)', value: r2(growth) }, { metric: 'Defensive avg 5D (XLP,XLU,XLV)', value: r2(defensive) }]);
  }
  for (const sym of ['SPY', 'QQQ', 'IWM']) {
    const x = etf[sym]?.crossed_50dma_3d;
    if (x) add(`cross50-${sym}`, '5D', `${INDEX_ETFS[sym]} ${x === 'UP' ? 'يعود فوق' : 'يكسر نزولًا'} متوسط 50 يومًا`,
      `${sym} عبر متوسطه المتحرك لـ50 يومًا خلال آخر 3 جلسات؛ البعد الحالي عن المتوسط ${signed(etf[sym].dist_50dma_pct)}.`,
      [{ metric: `${sym} dist 50DMA`, value: etf[sym].dist_50dma_pct }]);
  }
  if (spy?.chg_1d_pct != null && all?.adv_dec_ratio != null) {
    if (spy.chg_1d_pct > 0.3 && all.adv_dec_ratio < 0.9) add('narrow-rally-1d', '1D', 'صعود ضيق: المؤشر يرتفع وأغلب الأسهم تتراجع',
      `SPY ${signed(spy.chg_1d_pct)} بينما الصاعدة ${all.advancers} مقابل ${all.decliners} هابطة؛ الارتفاع تقوده أسهم قليلة كبيرة.`,
      [{ metric: 'SPY 1D', value: spy.chg_1d_pct }, { metric: 'A/D ratio', value: all.adv_dec_ratio }]);
    if (spy.chg_1d_pct < -0.3 && all.adv_dec_ratio > 1.1) add('hidden-strength-1d', '1D', 'المؤشر يتراجع بينما أغلب الأسهم تصعد',
      `SPY ${signed(spy.chg_1d_pct)} مع ${all.advancers} سهمًا صاعدًا مقابل ${all.decliners} هابطًا؛ الضغط مركّز في الأسهم الكبرى.`,
      [{ metric: 'SPY 1D', value: spy.chg_1d_pct }, { metric: 'A/D ratio', value: all.adv_dec_ratio }]);
  }
  if (small?.median_chg_pct != null && all?.median_chg_pct != null && Math.abs(small.median_chg_pct - all.median_chg_pct) >= 1) {
    add('microcaps-1d', '1D', small.median_chg_pct > all.median_chg_pct ? 'نشاط لافت في الأسهم الصغيرة جدًا اليوم' : 'ضغط بيعي أوضح على الأسهم الصغيرة جدًا اليوم',
      `وسيط تغير الأسهم دون 300 مليون دولار ${signed(small.median_chg_pct, 2)} مقابل ${signed(all.median_chg_pct, 2)} لكل الأسهم.`,
      [{ metric: 'Median chg <$300M', value: small.median_chg_pct }, { metric: 'Median chg all', value: all.median_chg_pct }]);
  }
  for (const [list, up] of [[industries.top, true], [industries.bottom, false]]) {
    const i = list[0];
    if (i && (up ? i.median_chg_pct >= 2 && i.breadth_pct_up >= 70 : i.median_chg_pct <= -2 && i.breadth_pct_up <= 30)) {
      add(`industry-${up ? 'surge' : 'selloff'}-${i.industry}`, '1D', `${up ? 'صعود جماعي' : 'هبوط جماعي'} في صناعة ${i.name_ar ?? i.industry}`,
        `وسيط التغير ${signed(i.median_chg_pct)}، و${up ? 'صعدت' : 'لم يصعد سوى'} ${Math.round((i.breadth_pct_up * i.count) / 100)} من أصل ${i.count} شركة؛ الحجم النسبي ${i.rel_volume ?? '—'}×. أبرزها: ${i.leaders.map((l) => `${l.symbol} ${signed(l.chg_pct)}`).join('، ')}.`,
        [{ metric: 'Median chg', value: i.median_chg_pct }, { metric: '% up', value: i.breadth_pct_up }, { metric: 'Count', value: i.count }]);
    }
  }
  const byInd = industries.all.map((i) => ({ i, n: i._list.filter((s) => s.rvol >= UNUSUAL_RVOL).length })).sort((a, b) => b.n - a.n)[0];
  if (byInd && byInd.n >= 3) add(`volume-cluster-${byInd.i.industry}`, '1D', `تركّز الأحجام غير الاعتيادية في ${byInd.i.name_ar ?? byInd.i.industry}`,
    `${countAr(byInd.n, 'شركة', 'شركات')} في هذه الصناعة تتداول بأكثر من ${UNUSUAL_RVOL} أضعاف متوسط حجمها؛ الحجم النسبي للصناعة ${byInd.i.rel_volume ?? '—'}×.`,
    [{ metric: `Stocks with RVOL ≥ ${UNUSUAL_RVOL}`, value: byInd.n }, { metric: 'Industry RVOL', value: byInd.i.rel_volume }]);
  const macro = [['GLD', 'الذهب'], ['USO', 'النفط'], ['UUP', 'الدولار'], ['TLT', 'السندات الطويلة']];
  for (const [sym, name] of macro) {
    const m = etf[sym]?.chg_1m_pct;
    if (m != null && Math.abs(m) >= (sym === 'UUP' ? 2 : 5)) add(`macro-1m-${sym}`, '1M', `${name} ${m > 0 ? 'في اتجاه صاعد' : 'في اتجاه هابط'} خلال شهر`,
      `${sym} ${signed(m)} خلال 21 جلسة و${signed(etf[sym].chg_5d_pct)} خلال 5 جلسات؛ ${etf[sym].above_50dma ? 'فوق' : 'تحت'} متوسط 50 يومًا.`,
      [{ metric: `${sym} 1M`, value: m }, { metric: `${sym} 5D`, value: etf[sym].chg_5d_pct }]);
  }
  return out;
}

// ---- news --------------------------------------------------------------------------------------

/**
 * Alpaca news → contract rows. Linking (news-link-1): a news item's symbols are matched to the universe;
 * move_pct is the day change of the most-moved matched symbol ONLY when the item was published inside the
 * session window (previous close → session close) and names ≤ 4 companies. Nothing more is inferred.
 */
export function linkNews(raw, bySymbol, win) {
  const seen = new Set(), out = [];
  for (const n of raw ?? []) {
    const key = n?.id ?? n?.url ?? n?.headline;
    if (!n?.headline || seen.has(key)) continue;
    seen.add(key);
    const t = Date.parse(n.created_at ?? n.updated_at);
    if (!Number.isFinite(t)) continue;
    const syms = (n.symbols ?? []).filter((s) => bySymbol.has(s));
    const industries = [...new Set(syms.map((s) => bySymbol.get(s).industry).filter(Boolean))];
    const sectors = [...new Set(syms.map((s) => bySymbol.get(s).sector).filter(Boolean))];
    const top = [...syms].sort((a, b) => Math.abs(bySymbol.get(b).chg) - Math.abs(bySymbol.get(a).chg))[0];
    const phase = !win ? null : t < win.prevClose ? 'BEFORE' : t < win.open ? 'PRE' : t < win.close ? 'SESSION' : 'AFTER';
    const broad = (n.symbols ?? []).length > 4;
    let move = null, note;
    if (!syms.length) note = 'لا يطابق رمزًا في عيّنة الأسهم المتابَعة؛ خبر عام.';
    else if (broad) note = `يذكر ${countAr(n.symbols.length, 'شركة', 'شركات')}؛ لا يُربط بحركة سهم بعينه.`;
    else if (phase === 'PRE' || phase === 'SESSION') {
      move = bySymbol.get(top).chg;
      note = `نُشر ${phase === 'PRE' ? 'قبل افتتاح' : 'خلال'} جلسة ${win.day}، وتغيّر ${top} ${signed(move, 2)} في الجلسة نفسها. الربط مبني على تطابق الرمز والتوقيت فقط ولا يثبت أن الخبر سبب الحركة.`;
    } else if (phase === 'AFTER') note = `نُشر بعد إغلاق جلسة ${win.day}، فلا يفسّر حركتها؛ قد يظهر أثره في الجلسة التالية.`;
    else if (phase === 'BEFORE') note = `نُشر قبل جلسة ${win.day}؛ للاطلاع فقط دون ربط بحركة اليوم.`;
    else note = 'توقيت الجلسة غير معروف؛ لا ربط بالحركة.';
    out.push({
      id: String(n.id ?? out.length), time: new Date(t).toISOString(), headline: n.headline, summary: n.summary || null,
      source: n.source ?? null, url: /^https?:\/\//i.test(n.url ?? '') ? n.url : null, symbols: n.symbols ?? [], industries, sectors,
      move_pct: move, linked_symbol: move != null ? top : null, impact_note_ar: note,
    });
  }
  return out.sort((a, b) => b.time.localeCompare(a.time));
}

/** Keep ~limit items: every item linked to a mover first, then the most recent others. */
export function selectNews(items, moverSymbols, limit = 40) {
  // Company-specific items (≤ 4 symbols) about movers first, then other company-specific items, then roundups.
  const specific = (n) => n.symbols.length > 0 && n.symbols.length <= 4, isMover = (n) => n.symbols.some((s) => moverSymbols.has(s));
  const pick = [...items.filter((n) => specific(n) && isMover(n)), ...items.filter((n) => specific(n) && !isMover(n)), ...items.filter((n) => n.symbols.length > 4)].slice(0, limit);
  return pick.sort((a, b) => b.time.localeCompare(a.time));
}

/** News clusters: ≥2 company-specific items (≤ 4 symbols; roundups excluded) naming ≥2 distinct companies in one industry. */
export function themes(news, bySymbol) {
  const m = new Map();
  for (const n of news) if (n.symbols.length <= 4) for (const s of n.symbols) {
    const row = bySymbol.get(s);
    if (!row?.industry) continue;
    const g = m.get(row.industry) ?? m.set(row.industry, { ids: new Set(), syms: new Set(), sector: row.sector }).get(row.industry);
    g.ids.add(n.id); g.syms.add(s);
  }
  return [...m].filter(([, g]) => g.ids.size >= 2 && g.syms.size >= 2).map(([industry, g]) => {
    const syms = [...g.syms], moves = syms.map((s) => bySymbol.get(s).chg);
    const avg = r2(moves.reduce((a, x) => a + x, 0) / moves.length), name = INDUSTRY_AR[industry] ?? industry;
    return { industry, title_ar: `${name}: ${countAr(g.ids.size, 'خبرًا', 'أخبار', 'خبران')} عن ${countAr(syms.length, 'شركة', 'شركات', 'شركتين')}، ومتوسط تغيّرها ${signed(avg)}`, news_ids: [...g.ids], symbols: syms, avg_move_pct: avg };
  }).sort((a, b) => b.news_ids.length - a.news_ids.length || Math.abs(b.avg_move_pct) - Math.abs(a.avg_move_pct)).slice(0, 12);
}

// ---- Nasdaq calendars --------------------------------------------------------------------------

export function parseEarnings(body, limit = 40) {
  const rows = body?.data?.rows ?? [];
  const money = (s) => { const t = String(s ?? '').trim(); if (!t || t === 'N/A') return null; const neg = /^\(.*\)$/.test(t); const v = num(t.replace(/[()]/g, '')); return v == null ? null : neg ? -v : v; };
  const time = (s) => (s === 'time-pre-market' ? 'pre-market' : s === 'time-after-hours' ? 'after-hours' : null);
  return rows.filter((r) => r?.symbol).map((r) => ({ symbol: r.symbol, company: r.name ?? null, time: time(r.time), eps_forecast: money(r.epsForecast), market_cap_m: money(r.marketCap) != null ? r2(money(r.marketCap) / 1e6) : null }))
    .sort((a, b) => (b.market_cap_m ?? -1) - (a.market_cap_m ?? -1)).slice(0, limit);
}

export function parseEconomic(body, day) {
  const rows = body?.data?.rows ?? [];
  const clean = (s) => { const t = String(s ?? '').replace(/&nbsp;/g, ' ').trim(); return t && t !== '-' ? t : null; };
  return rows.filter((r) => /United States/i.test(r?.country ?? '') && r.eventName).map((r) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(r.gmt ?? '').trim());
    return { time: m ? new Date(Date.parse(`${day}T00:00:00Z`) + (+m[1] * 60 + +m[2]) * 60_000).toISOString() : null, event: clean(r.eventName), actual: clean(r.actual), forecast: clean(r.consensus), previous: clean(r.previous) };
  }).sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

// ---- assemble ----------------------------------------------------------------------------------

export function buildInsights({ universe, bars = {}, barsAsOf = null, newsRaw = [], newsOk = true, calendar = null, earnings = null, economic = null, calDay = null, now = Date.now() }) {
  const days = tradingDays(calendar, now);
  const snapAt = Date.parse(universe?.updatedAt);
  const stocks = parseUniverse(universe?.rows);
  const bySymbol = new Map(stocks.map((s) => [s.symbol, s]));
  const etf = Object.fromEntries(ETF_SYMBOLS.map((s) => [s, etfStats(bars[s])]).filter(([, v]) => v));
  const sess = Number.isFinite(snapAt) ? sessionOf(snapAt, days) : null;
  const prev = sess ? previousDay(sess.date, days) : null;
  const win = sess && prev ? { day: sess.date, prevClose: nyTime(prev.date, prev.close), open: nyTime(sess.date, sess.open), close: nyTime(sess.date, sess.close) } : null;
  const all = breadth(stocks, 'all'), small = breadth(stocks.filter((s) => s.cap > 0 && s.cap < SMALL_CAP_M), 'small_caps_under_300m');
  const sectors = sectorTable(stocks, etf);
  const ind = industryTable(stocks);
  const mv = movers(stocks);
  const moverSet = new Set([...mv.gainers, ...mv.losers, ...mv.unusual_volume].map((r) => r.symbol));
  const news = newsOk ? selectNews(linkNews(newsRaw, bySymbol, win), moverSet) : [];
  for (const list of Object.values(mv)) for (const r of list) r.news_ids = news.filter((n) => n.symbols.includes(r.symbol)).map((n) => n.id);
  const snapIso = Number.isFinite(snapAt) ? new Date(snapAt).toISOString() : null;
  const indices = Object.keys(INDEX_ETFS).filter((s) => etf[s]).map((s) => ({
    symbol: s, name_ar: INDEX_ETFS[s], last: etf[s].last, last_bar_date: etf[s].last_bar_date,
    chg_1d_pct: etf[s].chg_1d_pct, chg_5d_pct: etf[s].chg_5d_pct, chg_1m_pct: etf[s].chg_1m_pct, chg_3m_pct: etf[s].chg_3m_pct, chg_ytd_pct: etf[s].chg_ytd_pct,
    above_50dma: etf[s].above_50dma, above_200dma: etf[s].above_200dma, dist_50dma_pct: etf[s].dist_50dma_pct, spark: etf[s].spark,
  }));
  const notes = [
    'بيانات الأسهم من لقطة Finviz (تتأخر حتى 15 دقيقة تقريبًا) وتشمل الأسهم التي يتجاوز متوسط تداولها 50 ألف سهم؛ الصناديق والشركات الفارغة مستبعدة.',
    'بيانات الصناديق والمؤشرات من أشرطة SIP اليومية بتأخير لا يقل عن 16 دقيقة.',
    'الحجم النسبي أثناء الجلسة يقارن حجم اليوم الجزئي بمتوسط يوم كامل، لذا يبدو منخفضًا في أول الجلسة.',
    'ربط الخبر بالحركة يعتمد على تطابق الرمز والتوقيت فقط ولا يثبت السببية. هذه المعلومات وصفية وليست توصية بالشراء أو البيع.',
  ];
  const state = marketState(now, days);
  if (sess && state === 'PRE') notes.push(`قبل الافتتاح: التغيرات اليومية تخص جلسة ${sess.date} السابقة.`);
  if (state === 'CLOSED' && sess) notes.push(`السوق مغلق: الأرقام تخص آخر جلسة (${sess.date}).`);
  if (!newsOk) notes.push('تعذّر جلب الأخبار في هذا التحديث.');
  if (!indices.length) notes.push('تعذّر جلب بيانات الصناديق والمؤشرات في هذا التحديث.');
  if (!calendar) notes.push('تقويم التداول غير متاح؛ استُخدمت أيام العمل دون احتساب العطل الرسمية.');
  return {
    schema_version: 1, generated_at: new Date(now).toISOString(), session: sess?.date ?? null, market_state: state,
    sources: [
      { name: 'Finviz Elite broad universe (tag/data/universe-broad.json)', as_of: snapIso, delay_note: 'لقطة كل 15 دقيقة تقريبًا في أيام التداول' },
      { name: 'Alpaca SIP daily bars via relay', as_of: barsAsOf, delay_note: 'تأخير 16 دقيقة على الأقل' },
      { name: 'Alpaca news via relay (Benzinga)', as_of: newsOk ? barsAsOf : null, delay_note: 'تأخير 16 دقيقة على الأقل؛ عناوين فقط' },
      { name: 'Nasdaq.com calendars (unofficial)', as_of: earnings || economic ? new Date(now).toISOString() : null, delay_note: 'مصدر غير رسمي؛ قد تتغير المواعيد' },
    ],
    pulse: { as_of: snapIso, bars_as_of: barsAsOf, indices, breadth: { ...all, as_of: snapIso }, small_caps: { ...small, as_of: snapIso }, regime: regime(etf, all) },
    sectors, sectors_as_of: snapIso, trends_as_of: snapIso, news_as_of: newsOk ? barsAsOf : null, themes_as_of: newsOk ? barsAsOf : null,
    industries: { as_of: snapIso, min_stocks: MIN_INDUSTRY, rank_by: 'median_chg_pct', top: ind.top, bottom: ind.bottom },
    movers: { as_of: snapIso, ...mv },
    trends: trends({ etf, sectors, industries: ind, all, small }),
    news, news_window: win ? { session: win.day, from: new Date(win.prevClose).toISOString(), to: new Date(win.close).toISOString() } : null,
    themes: themes(news, bySymbol),
    calendar: { as_of: earnings || economic ? new Date(now).toISOString() : null, date: calDay, earnings_today: earnings, economic },
    notes_ar: notes,
  };
}

// ---- IO ----------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PACE_MS = Math.max(3100, Number(process.env.RELAY_PACE_MS ?? 3100));
const MAX_REQUESTS = 40;
let lastCall = 0, requests = 0;
async function relay(params) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (requests >= MAX_REQUESTS) throw new Error('RELAY_BUDGET_EXHAUSTED');
    const wait = lastCall + PACE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now(); requests++;
    try {
      const r = await fetch(`${SERVICE}/api/lab/provider?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(60_000) });
      const body = await r.json().catch(() => null);
      if (r.ok) return body;
      if (r.status === 429 || r.status === 503) { await sleep(15_000 * (attempt + 1)); continue; }
      throw new Error(`${r.status} ${JSON.stringify(body)?.slice(0, 200)}`);
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(5_000 * (attempt + 1));
    }
  }
  throw new Error('RELAY_RETRIES_EXHAUSTED');
}
async function relayPages(params, maxPages) {
  const out = [];
  let token = null;
  for (let p = 0; p < maxPages; p++) {
    const body = await relay(token ? { ...params, page_token: token } : params);
    out.push(body);
    token = body?.next_page_token;
    if (!token) break;
  }
  return out;
}
async function nasdaq(url) {
  const { HEADERS } = await import('./nasdaq.mjs');
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`nasdaq ${r.status}`);
  return r.json();
}
const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
const diagnostics = [];
const log = (...a) => { diagnostics.push(a.join(' ').slice(0, 400)); console.error('[insights]', ...a); };

async function main() {
  const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
  const offline = process.argv.includes('--offline');
  const universe = JSON.parse(readFileSync(arg('--universe') ?? fileURLToPath(new URL('../../tag/data/universe-broad.json', import.meta.url)), 'utf8'));
  const now = Date.now();
  let calendar = null, bars = {}, barsAsOf = null, newsRaw = [], newsOk = false, earnings = null, economic = null;
  if (!offline) {
    try {
      calendar = await relay({ resource: 'calendar', start: nyDate(now - 20 * DAY), end: nyDate(now + 20 * DAY) });
      if (!Array.isArray(calendar)) calendar = null;
    } catch (e) { log('calendar failed', e.message); }
    try {
      const end = now - 17 * 60_000;
      barsAsOf = new Date(end).toISOString();
      for (const body of await relayPages({ resource: 'bars', symbols: [...ETF_SYMBOLS].sort().join(','), timeframe: '1Day', start: iso(end - 420 * DAY), end: iso(end), feed: 'sip', adjustment: 'split', limit: '10000', sort: 'asc' }, 4)) {
        for (const [s, list] of Object.entries(body?.bars ?? {})) (bars[s] ??= []).push(...list);
      }
      for (const list of Object.values(bars)) list.sort((a, b) => a.t.localeCompare(b.t));
    } catch (e) { log('bars failed', e.message); barsAsOf = null; }
  }
  // First pass without news to find movers; the news query targets movers + the 100 largest companies.
  const pre = buildInsights({ universe, bars, barsAsOf, calendar, now });
  if (!offline) {
    try {
      const movers = [...new Set([...pre.movers.gainers, ...pre.movers.losers, ...pre.movers.unusual_volume].map((r) => r.symbol))].slice(0, 100);
      const large = parseUniverse(universe.rows).filter((s) => s.cap > 0).sort((a, b) => b.cap - a.cap).map((s) => s.symbol).filter((s) => !movers.includes(s)).slice(0, 100);
      const days = tradingDays(calendar, now);
      const sess = sessionOf(Date.parse(universe.updatedAt), days), prev = sess && previousDay(sess.date, days);
      const start = prev ? nyTime(prev.date, prev.close) - 12 * 3_600_000 : now - 2 * DAY;
      for (const group of [movers, large]) {
        if (!group.length) continue;
        for (const body of await relayPages({ resource: 'news', symbols: group.sort().join(','), start: iso(start), end: iso(now), limit: '50', sort: 'desc' }, 3)) newsRaw.push(...(body?.news ?? []));
      }
      newsOk = true;
    } catch (e) { log('news failed', e.message); }
  }
  const calDay = calendarDay(now, tradingDays(calendar, now));
  if (!offline && calDay) {
    try { earnings = parseEarnings(await nasdaq(`https://api.nasdaq.com/api/calendar/earnings?date=${calDay}`)); } catch (e) { log('earnings failed', e.message); }
    try {
      const body = await nasdaq(`https://api.nasdaq.com/api/calendar/economicevents?date=${calDay}`);
      log('economic rows', body?.data?.rows?.length ?? 'none', JSON.stringify(body?.data?.rows?.[0] ?? body?.status ?? null).slice(0, 300));
      economic = parseEconomic(body, calDay);
    } catch (e) { log('economic failed', e.message); }
  }
  const out = buildInsights({ universe, bars, barsAsOf, newsRaw, newsOk, calendar, earnings, economic, calDay, now });
  out.run = { relay_requests: requests, diagnostics };
  writeFileSync(arg('--out') ?? OUT_DEFAULT, JSON.stringify(out, null, 1) + '\n');
  console.log(summary(out));
}

export function summary(o) {
  const p = o.pulse, b = p.breadth;
  const lines = [
    `insights ${o.generated_at} session=${o.session} state=${o.market_state} relay_requests=${o.run?.relay_requests ?? '-'}`,
    `regime: ${p.regime.key} (${p.regime.score}) ${p.regime.label_ar}`,
    `indices: ${p.indices.map((i) => `${i.symbol} ${i.last} 1d ${i.chg_1d_pct} 5d ${i.chg_5d_pct} 50dma ${i.above_50dma}`).join(' | ') || 'none'}`,
    `breadth: ${b.advancers}/${b.decliners} of ${b.count} ad=${b.adv_dec_ratio} unusual=${b.unusual_volume}; small caps ${p.small_caps.advancers}/${p.small_caps.decliners}`,
    `sectors: ${o.sectors.slice(0, 11).map((s) => `${s.etf} ${s.chg_1d_pct}/${s.median_chg_pct} etf5d ${s.etf_chg_5d_pct}`).join(' | ')}`,
    `industries top: ${o.industries.top.slice(0, 3).map((i) => `${i.industry} ${i.median_chg_pct}`).join(' | ')}; bottom: ${o.industries.bottom.slice(0, 3).map((i) => `${i.industry} ${i.median_chg_pct}`).join(' | ')}`,
    `movers: +${o.movers.gainers.slice(0, 3).map((m) => `${m.symbol} ${m.chg_pct}`).join(' ')} / ${o.movers.losers.slice(0, 3).map((m) => `${m.symbol} ${m.chg_pct}`).join(' ')} / uv ${o.movers.unusual_volume.length}`,
    `trends: ${o.trends.length} (${o.trends.map((t) => t.id).join(', ')})`,
    `news: ${o.news.length} (linked ${o.news.filter((n) => n.move_pct != null).length}); themes: ${o.themes.length}`,
    `calendar ${o.calendar.date}: earnings ${o.calendar.earnings_today?.length ?? 'n/a'}, economic ${o.calendar.economic?.length ?? 'n/a'}`,
  ];
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e); process.exit(1); });
