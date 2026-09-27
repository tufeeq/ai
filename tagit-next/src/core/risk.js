// Structural risk from official disclosures and listing status. These are warnings shown next to
// the checks, not gates: they describe what was filed or reported, not a validated price effect.
// A live trading halt is the exception and blocks plans in checks.js.
import { positive, finite } from './util.js';

export const ENRICHMENT_STALE_MS = 36 * 3600_000;

const LISTING = {
  DEFICIENT: 'لا تستوفي شروط الإدراج (Deficient)',
  DELINQUENT: 'متأخرة في الإفصاح (Delinquent)',
  BANKRUPT: 'في إجراءات إفلاس',
  DEFICIENT_BANKRUPT: 'عجز إدراج وإفلاس',
  DEFICIENT_DELINQUENT: 'عجز إدراج وتأخر إفصاح',
  DELINQUENT_BANKRUPT: 'تأخر إفصاح وإفلاس',
  DEFICIENT_DELINQUENT_BANKRUPT: 'عجز وتأخر وإفلاس',
};

const FLAGS = {
  OFFERING: { label: 'تسجيل أو تسعير طرح أسهم', hint: 'نشرة S-1/S-3/424B: زيادة محتملة في عدد الأسهم' },
  LISTING_NOTICE: { label: 'إشعار بعدم استيفاء شروط الإدراج', hint: 'نموذج 8-K بند 3.01' },
  BANKRUPTCY: { label: 'إفصاح إفلاس أو حراسة', hint: 'نموذج 8-K بند 1.03' },
  LATE_FILING: { label: 'إشعار تأخر تقرير دوري', hint: 'نموذج NT 10-K/10-Q' },
  CHARTER_AMENDMENT: { label: 'تعديل النظام الأساسي', hint: 'نموذج 8-K بند 5.03؛ قد يشمل تجزئة عكسية' },
};
// Dilution risk from enrich.py (definition of catalyst-study-1 hypothesis P6).
const DILUTION_REASONS = {
  SHELF_LOW_CASH: 'نشرة تسجيل أسهم خلال ١٢ شهرًا والنقد المعلن أقل من ١٠ ملايين دولار',
  SHELF: 'نشرة تسجيل أسهم (S-1/S-3/F-1/F-3) خلال ١٢ شهرًا',
  REPEATED_OFFERINGS: 'طرحان مسعّران أو أكثر (424B) خلال ١٢ شهرًا',
  SHARE_GROWTH: 'الأسهم القائمة زادت ٥٠٪ أو أكثر خلال سنة',
};
const millions = (v) => `$${(v / 1e6).toFixed(1)}M`;

/** Dilution-risk item for one symbol, or null when none is flagged or no data exists. */
export function dilutionOf(entry) {
  const d = entry?.dilution;
  if (!d || !['HIGH', 'WATCH'].includes(d.level)) return null;
  const parts = (d.reasons ?? []).map((r) => DILUTION_REASONS[r]).filter(Boolean);
  if (finite(d.cash?.value)) parts.push(`النقد ${millions(d.cash.value)} بتاريخ ${d.cash.as_of}${d.cash_stale ? ' (قديم)' : ''}`);
  if (finite(d.shares_change_1y_pct)) parts.push(`تغير الأسهم خلال سنة ${d.shares_change_1y_pct > 0 ? '+' : ''}${d.shares_change_1y_pct}%`);
  return {
    level: d.level,
    kind: 'DILUTION',
    label: d.level === 'HIGH' ? 'خطر تخفيف مرتفع: تمويل متوقع' : 'احتمال تخفيف (طرح أسهم)',
    detail: parts.join(' · '),
    date: d.registration?.date ?? d.last_priced_offering ?? null,
  };
}

const HIGH_WHEN_RECENT = new Set(['OFFERING', 'LISTING_NOTICE', 'BANKRUPTCY', 'LATE_FILING']);

/**
 * Risk items for one symbol. `level` is HIGH, WATCH, NONE, or UNKNOWN when no disclosure
 * data exists for the symbol (never read as "no risk").
 */
export function riskOf(entry, row, now = Date.now(), generatedAt = null) {
  const items = [];
  if (row?.halt) {
    items.push({ level: 'HIGH', kind: 'HALT', label: 'التداول موقوف الآن', detail: `رمز السبب ${row.halt.reason_code ?? 'غير معروف'}`, date: row.halt.halted_at });
  }
  if (!entry) {
    return { level: items.length ? 'HIGH' : 'UNKNOWN', items, stale: false };
  }
  const status = entry.listing?.status;
  if (status && status !== 'NORMAL' && LISTING[status]) {
    items.push({ level: 'HIGH', kind: 'LISTING', label: LISTING[status], detail: 'دليل رموز ناسداك' });
  }
  for (const flag of entry.flags ?? []) {
    const meta = FLAGS[flag.kind];
    if (!meta) continue;
    const filing = (entry.filings ?? []).find((f) => f.form === flag.form && f.date === flag.date);
    items.push({
      level: flag.recent && HIGH_WHEN_RECENT.has(flag.kind) ? 'HIGH' : 'WATCH',
      kind: flag.kind,
      label: meta.label,
      detail: `${flag.form} · ${meta.hint}`,
      date: flag.date,
      url: filing?.url ?? null,
    });
  }
  const dilution = dilutionOf(entry);
  if (dilution) items.push(dilution);
  const level = items.some((i) => i.level === 'HIGH') ? 'HIGH' : items.length ? 'WATCH' : 'NONE';
  const stale = Boolean(generatedAt) && now - Date.parse(generatedAt) > ENRICHMENT_STALE_MS;
  return { level, items, stale };
}

/** Company facts derived from SEC share counts and FINRA short interest. */
export function companyFacts(entry, row) {
  const shares = entry?.shares_outstanding;
  const si = entry?.short_interest;
  const secCap = positive(shares?.value) && positive(row?.price) ? shares.value * row.price : null;
  const shortOfFloat = positive(si?.shares_short) && positive(row?.float_shares) ? (si.shares_short / row.float_shares) * 100 : null;
  return {
    sharesOutstanding: positive(shares?.value) ? shares.value : null,
    sharesAsOf: shares?.as_of ?? null,
    secMarketCap: secCap,
    shortShares: finite(si?.shares_short) ? si.shares_short : null,
    shortOfFloat,
    daysToCover: finite(si?.days_to_cover) ? si.days_to_cover : null,
    shortSettlement: si?.settlement_date ?? null,
    lastPeriodic: entry?.latest_periodic ?? null,
    cash: finite(entry?.dilution?.cash?.value) ? entry.dilution.cash.value : null,
    cashAsOf: entry?.dilution?.cash?.as_of ?? null,
    sharesChange1y: finite(entry?.dilution?.shares_change_1y_pct) ? entry.dilution.shares_change_1y_pct : null,
    filings: entry?.filings ?? [],
  };
}
