// A compliance badge is shown only with a sourced, dated, current review.
import { elapsed } from './util.js';

const MAX_REVIEW_AGE_MS = 90 * 86_400_000;

export function shariaStatus(record, now = Date.now()) {
  const unknown = { status: 'UNKNOWN', icon: '؟', label: 'الامتثال الشرعي غير متحقق', source: null };
  if (!record || !['COMPLIANT', 'NON_COMPLIANT'].includes(record.status)) return unknown;
  if (!record.methodology || !record.source || !/^https:\/\//.test(record.source_url ?? '')) return unknown;
  const reviewAge = elapsed(record.reviewed_at, now);
  if (reviewAge < 0 || reviewAge > MAX_REVIEW_AGE_MS) return unknown;
  const validUntil = Date.parse(record.valid_until);
  if (!Number.isFinite(validUntil) || validUntil < now) return unknown;
  const compliant = record.status === 'COMPLIANT';
  return {
    ...record,
    icon: compliant ? '✓' : '×',
    label: compliant ? 'مطابق وفق الفحص الموثق' : 'غير مطابق وفق الفحص الموثق',
  };
}
