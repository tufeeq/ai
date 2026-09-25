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
