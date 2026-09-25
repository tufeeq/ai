// Opportunity assessment: twelve explicit checks instead of an opaque score.
// Passing checks is a detection condition, never a probability of profit.
import { finite, positive, elapsed, within } from './util.js';

export const RULES = Object.freeze({
  barMinAgeMs: 60_000,
  barMaxAgeMs: 150_000,
  momentum3m: 0.7,
  volumeRatio: 2,
  dollars3m: 25_000,
  trades3m: 30,
  maxConcentration: 0.7,
  tradeMaxAgeMs: 15_000,
  quoteMaxAgeMs: 10_000,
  maxSpreadPct: 0.8,
  maxDayChange: 25,
  maxReturn3m: 8,
  scanMaxAgeMs: 90_000,
  chaseTolerance: 1.01,
  priorityMinPassed: 8,
});

// Checks that must pass for the priority tier, however many others pass.
export const PRIORITY_REQUIRED = ['history', 'extension', 'dollars', 'prints', 'balance'];

export const CHECK_GROUPS = {
  momentum: 'الزخم',
  liquidity: 'السيولة',
  freshness: 'حداثة البيانات',
  structure: 'البنية',
};

export const isExtended = (row) =>
  row.extended === true || row.day_change > RULES.maxDayChange || row.signal?.return_3m > RULES.maxReturn3m;

function buildChecks(row, now) {
  const s = row.signal;
  const barAge = elapsed(s?.bar_at, now);
  return [
    {
      key: 'history', group: 'freshness', name: 'دقائق حديثة مكتملة',
      pass: s?.ready === true && barAge >= RULES.barMinAgeMs && barAge <= RULES.barMaxAgeMs,
      value: s ? `${s.bars} دقيقة متاحة` : null,
    },
    {
      key: 'momentum', group: 'momentum', name: 'صعود ٣ دقائق ≥ ٠٫٧٪',
      pass: finite(s?.return_3m) && s.return_3m >= RULES.momentum3m, value: s?.return_3m, unit: '%',
    },
    {
      key: 'volume', group: 'momentum', name: 'تسارع الحجم ≥ ضعفين',
      pass: finite(s?.volume_ratio) && s.volume_ratio >= RULES.volumeRatio, value: s?.volume_ratio, unit: '×',
    },
    {
      key: 'dollars', group: 'liquidity', name: 'قيمة تداول ٣ دقائق ≥ ٢٥ ألف دولار',
      pass: finite(s?.dollars_3m) && s.dollars_3m >= RULES.dollars3m, value: s?.dollars_3m, unit: '$',
    },
    {
      key: 'prints', group: 'liquidity', name: '٣٠ صفقة على الأقل',
      pass: finite(s?.trades_3m) && s.trades_3m >= RULES.trades3m, value: s?.trades_3m,
    },
    {
      key: 'balance', group: 'liquidity', name: 'لا تتركز أكثر من ٧٠٪ في دقيقة',
      pass: finite(s?.volume_concentration) && s.volume_concentration <= RULES.maxConcentration,
      value: finite(s?.volume_concentration) ? s.volume_concentration * 100 : null, unit: '%',
    },
    {
      key: 'vwap', group: 'structure', name: 'السعر فوق متوسط النافذة المرجّح',
      pass: positive(s?.vwap_window) && row.price >= s.vwap_window, value: s?.vwap_window, unit: '$',
    },
    {
      key: 'trade', group: 'freshness', name: 'آخر صفقة خلال ١٥ ثانية',
      pass: within(row.price_at, now, RULES.tradeMaxAgeMs), value: row.price_at, time: true,
    },
    {
      key: 'quote', group: 'freshness', name: 'عرض شراء وبيع خلال ١٠ ثوانٍ',
      pass: within(row.quote_at, now, RULES.quoteMaxAgeMs) && positive(row.bid) && positive(row.ask) && row.bid <= row.ask,
      value: row.quote_at, time: true,
    },
    {
      key: 'spread', group: 'liquidity', name: 'فارق العرض والطلب ≤ ٠٫٨٪',
      pass: finite(row.spread_pct) && row.spread_pct >= 0 && row.spread_pct <= RULES.maxSpreadPct,
      value: row.spread_pct, unit: '%',
    },
    {
      key: 'extension', group: 'structure', name: 'لم تمتد الحركة بعيدًا عن البداية',
      pass: row.extended === false && !(row.day_change > RULES.maxDayChange) && !(s?.return_3m > RULES.maxReturn3m),
      value: row.day_change, unit: '%',
    },
    {
      key: 'structure', group: 'structure', name: 'إبطال قريب ومحدد',
      pass: s?.plan_valid === true,
      value: positive(s?.trigger) && positive(s?.stop) ? (s.trigger / s.stop - 1) * 100 : null, unit: '%',
    },
  ];
}

const validPlanShape = (p) =>
  positive(p?.entry) && positive(p?.stop) && p.entry > p.stop &&
  Array.isArray(p.targets) && p.targets.length === 2 && p.targets.every((t) => positive(t) && t > p.entry);

/**
 * Assess one market row. A plan is only returned when the scan is recent, the
 * feed is real-time, every check passes, the server marked the row actionable
 * and the live price has not run past the entry zone.
 */
export function assess(row, { now = Date.now(), serverTime, connected = true, feed = 'iex' } = {}) {
  const checks = buildChecks(row, now);
  const plan = row.plan;
  const recentScan = connected && within(serverTime, now, RULES.scanMaxAgeMs);
  const planGood = validPlanShape(plan);
  const chasing = planGood && row.price > plan.entry * RULES.chaseTolerance;
  const livePlan = Boolean(
    recentScan && feed !== 'delayed_sip' && checks.every((c) => c.pass) && row.actionable === true &&
    planGood && row.price > plan.stop && !chasing,
  );
  const tradeFresh = checks.find((c) => c.key === 'trade').pass;

  let state = 'WATCH';
  if (livePlan) state = 'READY';
  else if (isExtended(row)) state = 'EXTENDED';
  else if (!recentScan || !tradeFresh) state = 'STALE';
  else if (row.signal?.expansion) state = 'CONFIRM';

  const blockers = checks.filter((c) => !c.pass).map((c) => c.name);
  if (!recentScan) blockers.unshift('الاتصال أو المسح غير حديث');
  if (feed === 'delayed_sip') blockers.unshift('المصدر متأخر');
  if (chasing) blockers.unshift('السعر تجاوز منطقة التفعيل');

  const passed = checks.filter((c) => c.pass).length;
  return { state, checks, blockers, passed, total: checks.length, plan: livePlan ? plan : null };
}

/**
 * Split rows into the priority tier (≥ 8/12, current scan, fresh trade, real-time
 * feed and every liquidity/structure requirement) and the monitoring tier.
 */
export function splitPriority(rows, options) {
  const now = options.now ?? Date.now();
  const evaluate = options.assessment ?? ((row) => assess(row, { ...options, serverTime: row.scan_at ?? options.serverTime }));
  const ranked = rows
    .map((row) => ({ row, a: evaluate(row) }))
    .sort((x, y) => y.a.passed - x.a.passed || (y.row.score ?? 0) - (x.row.score ?? 0));

  const upper = [];
  const lower = [];
  for (const { row, a } of ranked) {
    const timely = a.checks.find((c) => c.key === 'trade').pass &&
      within(row.scan_at ?? options.serverTime, now, RULES.scanMaxAgeMs) && options.connected !== false;
    const required = a.checks.filter((c) => PRIORITY_REQUIRED.includes(c.key)).every((c) => c.pass);
    const priority = a.passed >= RULES.priorityMinPassed && timely && options.feed !== 'delayed_sip' && required;
    (priority ? upper : lower).push(row);
  }
  return { upper, lower };
}
