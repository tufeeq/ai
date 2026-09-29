// Integer position sizing bounded by both capital and the chosen maximum loss.
// Excludes fees, slippage and fillability; it never simulates an execution.
import { positive } from './util.js';

export function sizePosition(plan, riskBudget, capital) {
  if (!positive(plan?.entry) || !positive(plan?.stop) || plan.stop >= plan.entry) return null;
  if (!positive(riskBudget) || !positive(capital)) return null;
  const perShare = plan.entry - plan.stop;
  // Tolerance absorbs binary rounding (2.02 - 1.98 = 0.04000000000000004)
  // without exceeding either limit materially.
  const shares = Math.floor(Math.min(riskBudget / perShare, capital / plan.entry) * (1 + 1e-9));
  const targets = Array.isArray(plan.targets) ? plan.targets.filter(positive) : [];
  return {
    shares,
    perShare,
    notional: shares * plan.entry,
    plannedRisk: shares * perShare,
    rewards: targets.map((t) => shares * (t - plan.entry)),
    limitedBy: riskBudget / perShare <= capital / plan.entry ? 'RISK' : 'CAPITAL',
  };
}

/**
 * Clean a typed calculator amount. Arabic keyboards type Arabic-Indic digits (٠-٩, ۰-۹) and the
 * Arabic decimal separator (٫); they are converted instead of silently dropped (which turned
 * "٥٠٠٠" into an empty capital). Thousands separators and other characters are removed, and only
 * the first decimal point is kept.
 */
export function cleanAmount(text) {
  const latin = String(text ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/٫/g, '.')
    .replace(/[^\d.]/g, '');
  const dot = latin.indexOf('.');
  return dot < 0 ? latin : latin.slice(0, dot + 1) + latin.slice(dot + 1).replace(/\./g, '');
}
