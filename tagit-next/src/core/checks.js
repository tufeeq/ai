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
  // Consolidated (Nasdaq.com) trades carry minute resolution and quotes their fetch time.
  consolidatedTradeMaxAgeMs: 120_000,
  consolidatedQuoteMaxAgeMs: 30_000,
  maxSpreadPct: 0.8,
  maxDayChange: 25,
  maxReturn3m: 8,
  scanMaxAgeMs: 90_000,
  chaseTolerance: 1.01,
  // Real-time consolidated signals (discovery-1c, server pulse): the plan levels stay valid for 20
  // minutes after the expansion while price holds the zone; quotes up to a minute old; small-cap spreads.
  consolidatedSignalMaxAgeMs: 20 * 60_000,
  consolidatedPlanQuoteMaxAgeMs: 60_000,
  consolidatedMaxSpreadPct: 1.5,
  consolidatedChaseTolerance: 1.02,
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

/**
 * A row is extended when its day or 3-minute move is past the early-move limits, or when the symbol is
 * on the published fade-study-1 list (an extension event in the last five sessions). fade-study-1 is
 * the only rule that held on an untouched holdout, and it says "do not buy after an extended move";
 * sip-study-1 agrees intraday (3-minute burst > 8%: holdout −2.07% vs −0.83% for the rest, after cost).
 * `fade` is the fadeWarning() result for the symbol (or null); rows may also carry it as `row.fade`.
 */
export const isExtended = (row, fade = row?.fade) =>
  row.extended === true || row.day_change > RULES.maxDayChange || row.signal?.return_3m > RULES.maxReturn3m || Boolean(fade);

/**
 * Order for the opportunity lists: more checks passed first; among equals, extended rows last and then
 * the smallest 3-minute move first. The server `score` is deliberately NOT used: it adds points for a
 * bigger 3-minute move, a bigger volume ratio, more dollars and a breakout, and in sip-study-1 every one
 * of those larger buckets did worse after costs (holdout: ≥ $250K in 3 min −1.71% vs −0.67% for
 * $25–50K; ≥ 6× volume −1.10% vs −0.76% for 2–3×). Ranking by it put the most-chased names on top.
 * This order is a de-emphasis of chasing, not a claimed edge: every bucket was negative after costs.
 */
export function compareRows(x, ax, y, ay, fadeOf = (r) => r?.fade ?? null) {
  return ay.passed - ax.passed ||
    Number(ax.state === 'BLOCKED') - Number(ay.state === 'BLOCKED') ||
    Number(isExtended(x, fadeOf(x))) - Number(isExtended(y, fadeOf(y))) ||
    (x.signal?.return_3m ?? Infinity) - (y.signal?.return_3m ?? Infinity) ||
    (x.symbol < y.symbol ? -1 : x.symbol > y.symbol ? 1 : 0);
}

const isConsolidated = (s) => s?.source === 'CONSOLIDATED_NASDAQ';

function buildChecks(row, now, fade) {
  const s = row.signal;
  const barAge = elapsed(s?.bar_at, now);
  const cons = isConsolidated(s);
  const signalAge = cons ? elapsed(s.detected_at ?? s.evaluated_at ?? s.bar_at, now) : null;
  return [
    cons ? {
      key: 'history', group: 'freshness', name: 'إشارة مجمّعة خلال آخر ٢٠ دقيقة',
      pass: s.ready === true && signalAge >= 0 && signalAge <= RULES.consolidatedSignalMaxAgeMs,
      value: `${s.bars} دقيقة متاحة`,
    } : {
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
    // Consolidated real-time signals (discovery-1c) come from minute charts without trade counts;
    // the rule is not evaluated for them and says so, instead of failing on data the source lacks.
    s?.source === 'CONSOLIDATED_NASDAQ' && s.trades_3m === null
      ? { key: 'prints', group: 'liquidity', name: 'عدد الصفقات (غير متاح في المصدر المجمّع)', pass: true, value: null, na: true }
      : {
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
      key: 'trade', group: 'freshness', name: 'صفقة حديثة (IEX ‏١٥ ث · مجمّعة دقيقتان)',
      pass: within(row.price_at, now, row.price_source === 'CONSOLIDATED' ? RULES.consolidatedTradeMaxAgeMs : RULES.tradeMaxAgeMs),
      value: row.price_at, time: true,
    },
    {
      key: 'quote', group: 'freshness', name: 'عرض شراء وبيع حديث (IEX ‏١٠ ث · مجمّع ٣٠ ث)',
      pass: within(row.quote_at, now, cons ? RULES.consolidatedPlanQuoteMaxAgeMs : row.quote_source === 'CONSOLIDATED' ? RULES.consolidatedQuoteMaxAgeMs : RULES.quoteMaxAgeMs) &&
        positive(row.bid) && positive(row.ask) && row.bid <= row.ask,
      value: row.quote_at, time: true,
    },
    {
      key: 'spread', group: 'liquidity', name: 'فارق العرض والطلب ≤ ٠٫٨٪',
      pass: finite(row.spread_pct) && row.spread_pct >= 0 && row.spread_pct <= (cons ? RULES.consolidatedMaxSpreadPct : RULES.maxSpreadPct),
      value: row.spread_pct, unit: '%',
    },
    {
      key: 'extension', group: 'structure',
      name: fade ? 'لم تمتد الحركة بعيدًا عن البداية (امتداد يومي خلال آخر ٥ جلسات)' : 'لم تمتد الحركة بعيدًا عن البداية',
      pass: row.extended === false && !(row.day_change > RULES.maxDayChange) && !(s?.return_3m > RULES.maxReturn3m) && !fade,
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
export function assess(row, { now = Date.now(), serverTime, connected = true, feed = 'iex', fade = row?.fade ?? null } = {}) {
  const checks = buildChecks(row, now, fade);
  const plan = row.plan;
  const recentScan = connected && within(serverTime, now, RULES.scanMaxAgeMs);
  const planGood = validPlanShape(plan);
  const chasing = planGood && row.price > plan.entry * (isConsolidated(row.signal) ? RULES.consolidatedChaseTolerance : RULES.chaseTolerance);
  const halted = Boolean(row.halt);
  const livePlan = Boolean(
    !halted && recentScan && feed !== 'delayed_sip' && checks.every((c) => c.pass) && row.actionable === true &&
    planGood && row.price > plan.stop && !chasing,
  );
  const tradeFresh = checks.find((c) => c.key === 'trade').pass;

  let state = 'WATCH';
  if (halted) state = 'HALTED';
  else if (livePlan) state = 'READY';
  else if (isExtended(row, fade)) state = 'EXTENDED';
  else if (!recentScan || !tradeFresh) state = 'STALE';
  else if (row.signal?.expansion) state = 'CONFIRM';

  const blockers = checks.filter((c) => !c.pass).map((c) => c.name);
  if (!recentScan) blockers.unshift('الاتصال أو المسح غير حديث');
  if (feed === 'delayed_sip') blockers.unshift('المصدر متأخر');
  if (chasing) blockers.unshift('السعر تجاوز منطقة التفعيل');
  if (halted) blockers.unshift('التداول موقوف مؤقتًا');
  if (fade) blockers.unshift('امتداد يومي حديث: الشراء بعده كان أسوأ من غيره في الاختبار (تحذير، لا إشارة بيع)');

  const passed = checks.filter((c) => c.pass).length;
  return { state, checks, blockers, passed, total: checks.length, plan: livePlan ? plan : null };
}

/**
 * Split rows into the priority tier (≥ 8/12, current scan, fresh trade, real-time
 * feed and every liquidity/structure requirement) and the monitoring tier.
 */
export function splitPriority(rows, options) {
  const now = options.now ?? Date.now();
  const fadeOf = options.fadeOf ?? ((r) => r?.fade ?? null);
  const evaluate = options.assessment ?? ((row) => assess(row, { ...options, serverTime: row.scan_at ?? options.serverTime, fade: fadeOf(row) }));
  const ranked = rows
    .map((row) => ({ row, a: evaluate(row) }))
    .sort((x, y) => compareRows(x.row, x.a, y.row, y.a, fadeOf));

  const upper = [];
  const lower = [];
  for (const { row, a } of ranked) {
    const timely = a.checks.find((c) => c.key === 'trade').pass &&
      within(row.scan_at ?? options.serverTime, now, RULES.scanMaxAgeMs) && options.connected !== false;
    const required = a.checks.filter((c) => PRIORITY_REQUIRED.includes(c.key)).every((c) => c.pass);
    const priority = a.state !== 'HALTED' && a.state !== 'EXTENDED' && a.passed >= RULES.priorityMinPassed && timely && options.feed !== 'delayed_sip' && required;
    (priority ? upper : lower).push(row);
  }
  return { upper, lower };
}
