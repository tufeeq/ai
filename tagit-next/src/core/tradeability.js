// Tradeability gate: can this stock be executed sensibly RIGHT NOW, given spread, liquidity,
// halts, data freshness and costs? A conservative execution verdict, never a probability of
// profit — no pattern in the published studies has shown an edge after costs.
import { finite, positive, within } from './util.js';
import { RULES, isExtended } from './checks.js';
import { marketSession } from './market.js';
import { spreadPct, costInR } from './costs.js';

export const GATE = Object.freeze({
  blockSpreadPct: 1.5,
  warnSpreadPct: RULES.maxSpreadPct, // 0.8
  blockMinuteDollars: 8_000, // ≈ $25K per 3 minutes
  warnMinuteDollars: 25_000,
  blockCostR: 0.5,
  warnCostR: 0.25,
  lowFloat: 5_000_000,
  microFloat: 1_000_000,
  subDollar: 1,
  ssrDropPct: -10,
});

export const VERDICTS = {
  NO: 'غير قابل للتداول الآن',
  CAUTION: 'قابل للتنفيذ بحذر',
  OK: 'التنفيذ ممكن وفق البيانات الحالية',
};

export const GATE_NOTE = 'الحكم عن إمكانية التنفيذ وتكلفته فقط، وليس احتمال ربح: لم يُثبت أي نمط في الدراسات المنشورة ميزة بعد التكاليف.';

const SESSION_MINUTES = 390;

/** Minutes since 09:30 New York for the regular session, else null. */
function regularMinutes(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const m = Number(parts.hour) * 60 + Number(parts.minute) - (9 * 60 + 30);
  return m > 0 && m <= SESSION_MINUTES ? m : null;
}

/**
 * Liquidity estimates for a row. The scanner's 3-minute dollars come from IEX (one exchange),
 * which understates small-cap volume; the consolidated day volume averaged per elapsed minute is
 * the other estimate. The larger one is used and its source is reported.
 */
export function liquidityOf(row, now) {
  const iexMinute = positive(row?.signal?.dollars_3m) ? row.signal.dollars_3m / 3 : null;
  const consVolume = row?.consolidated?.volume;
  const dayDollars = positive(consVolume) && positive(row?.price) ? consVolume * row.price
    : positive(row?.day_dollars) ? row.day_dollars : null;
  const elapsed = regularMinutes(now);
  const avgMinute = positive(dayDollars) && elapsed ? dayDollars / elapsed : null;
  const minuteDollars = Math.max(iexMinute ?? 0, avgMinute ?? 0) || null;
  const source = !minuteDollars ? 'NONE' : minuteDollars === iexMinute ? 'IEX_3M' : 'DAY_AVERAGE';
  return { minuteDollars, dayDollars, source };
}

/**
 * Short-sale restriction (Rule 201): triggered when the price falls 10% below the prior close and
 * kept through the next session. Without the intraday low or yesterday's state only a current
 * ≥10% drop is detectable, so the result is ACTIVE or UNKNOWN, never "inactive".
 */
export function ssrState(row) {
  const prev = row?.previous_close;
  if (positive(prev) && positive(row?.price) && (row.price / prev - 1) * 100 <= GATE.ssrDropPct) return 'ACTIVE';
  return 'UNKNOWN';
}

/**
 * Verdict for one row. `plan` is the plan levels shown to the user (live plan or the watch-only
 * breakout levels); `risk` is riskOf() output. Reasons carry a level: BLOCK, WARN or INFO.
 */
export function tradeability(row, { now = Date.now(), feed = 'iex', plan = null, risk = null, connected = true } = {}) {
  const reasons = [];
  const add = (level, text) => reasons.push({ level, text });
  const session = marketSession(now).key;

  if (row?.halt) add('BLOCK', 'التداول موقوف من البورصة');
  if (!connected) add('BLOCK', 'الاتصال بخدمة البيانات منقطع');
  if (feed === 'delayed_sip') add('BLOCK', 'مصدر الأسعار متأخر');
  if (session === 'CLOSED') add('BLOCK', 'السوق مغلق');

  const consolidatedTrade = row?.price_source === 'CONSOLIDATED';
  if (!positive(row?.price) || !within(row?.price_at, now, consolidatedTrade ? RULES.consolidatedTradeMaxAgeMs : RULES.tradeMaxAgeMs)) {
    add('BLOCK', 'آخر صفقة غير حديثة');
  }
  const spread = spreadPct(row?.bid, row?.ask);
  const consolidatedQuote = row?.quote_source === 'CONSOLIDATED';
  const quoteFresh = within(row?.quote_at, now, consolidatedQuote ? RULES.consolidatedQuoteMaxAgeMs : RULES.quoteMaxAgeMs);
  if (spread === null || !quoteFresh) add('BLOCK', 'لا عرض وطلب حديث لحساب التكلفة');
  else if (spread > GATE.blockSpreadPct) add('BLOCK', `فارق العرض والطلب ${spread.toFixed(2)}٪ (الحد ${GATE.blockSpreadPct}٪)`);
  else if (spread > GATE.warnSpreadPct) add('WARN', `فارق العرض والطلب واسع ${spread.toFixed(2)}٪`);

  const liq = liquidityOf(row, now);
  if (!liq.minuteDollars || liq.minuteDollars < GATE.blockMinuteDollars) add('BLOCK', 'سيولة الدقيقة أقل من ٨ آلاف دولار');
  else if (liq.minuteDollars < GATE.warnMinuteDollars) add('WARN', 'سيولة الدقيقة أقل من ٢٥ ألف دولار: الأمر الكبير يحرك السعر');

  const costR = plan && spread !== null ? costInR({ entry: plan.entry, stop: plan.stop, spread, minuteDollars: liq.minuteDollars }) : null;
  if (finite(costR)) {
    if (costR >= GATE.blockCostR) add('BLOCK', `التكلفة المقدرة ${costR.toFixed(2)}R تستهلك نصف المخاطرة أو أكثر`);
    else if (costR >= GATE.warnCostR) add('WARN', `التكلفة المقدرة ${costR.toFixed(2)}R من المخاطرة`);
  }

  if (session === 'PRE' || session === 'AFTER') add('WARN', 'خارج الجلسة النظامية: سيولة أقل وفجوات أوسع، والأوامر المحددة فقط');
  if (positive(row?.price) && row.price < GATE.subDollar) add('WARN', 'سعر دون دولار: فجوات سعرية وخطر الشطب');
  if (positive(row?.float_shares)) {
    if (row.float_shares < GATE.microFloat) add('WARN', 'تعويم أقل من مليون سهم: تقلب وفجوات حادة');
    else if (row.float_shares < GATE.lowFloat) add('WARN', 'تعويم منخفض (أقل من ٥ ملايين سهم)');
  }
  if (row && isExtended(row)) add('WARN', 'حركة ممتدة: الشراء بعد الامتداد خسر في كل الدراسات المنشورة');
  if (risk?.level === 'HIGH') {
    for (const i of risk.items.filter((x) => x.level === 'HIGH' && x.kind !== 'HALT')) add('WARN', i.label);
  }
  const ssr = ssrState(row);
  if (ssr === 'ACTIVE') add('INFO', 'قيد البيع على المكشوف (Rule 201) مفعّل: هبط السهم ١٠٪ عن إغلاق أمس');

  const verdict = reasons.some((r) => r.level === 'BLOCK') ? 'NO' : reasons.some((r) => r.level === 'WARN') ? 'CAUTION' : 'OK';
  return { verdict, label: VERDICTS[verdict], reasons, spread, liquidity: liq, costR, ssr };
}
