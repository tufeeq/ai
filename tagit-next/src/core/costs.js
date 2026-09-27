// Execution cost model and cost-aware position sizing. Pure functions shared by the page and the
// forward paper ledger (pipeline/paper_ledger.mjs), so the calculator and the ledger charge the
// same costs. Costs are estimates of what a marketable order pays, not measured fills:
//   spread   — a marketable buy pays the ask, a marketable sell the bid: one full quoted spread
//              per round trip (half on each side of the mid);
//   impact   — per side, IMPACT_COEF × √(order $ / average one-minute $ volume): taking 1% of a
//              minute's dollar volume costs ~0.1%, 10% ~0.32%, 100% ~1% (square-root law);
//   stop     — a stop becomes a market order in a falling tape: one extra spread on top;
//   fees     — SEC Section 31 fee on sell notional and FINRA TAF per sold share; commission is
//              whatever the user enters (0 at most retail brokers).
// A floor of 0.5 percentage points per round trip applies (the research protocol's minimum for
// small caps), so the model never reports less than the studies assumed.
import { finite, positive } from './util.js';

export const COSTS = Object.freeze({
  minRoundTripPct: 0.5,
  impactCoefPct: 1.0,
  stopExtraSpreads: 1,
  secFeeRate: 0.0000278, // $27.80 per $1M sold
  tafPerShare: 0.000166,
  tafMax: 8.3,
  fallbackSpreadPct: 1.0, // assumed when no usable quote exists (conservative)
  maxMinuteParticipation: 0.1, // order ≤ 10% of an average minute's dollar volume
  maxDayParticipation: 0.01, // and ≤ 1% of the session's dollar volume so far
});

/** Quoted spread in percent of the mid; null for a missing, crossed or zero quote. */
export function spreadPct(bid, ask) {
  if (!positive(bid) || !positive(ask) || bid > ask) return null;
  return ((ask - bid) / ((ask + bid) / 2)) * 100;
}

/** Impact in percent for one side of an order of `notional` dollars. */
export function impactPct(notional, minuteDollars) {
  if (!positive(notional)) return 0;
  if (!positive(minuteDollars)) return COSTS.impactCoefPct; // no volume known: charge a full-minute impact
  return COSTS.impactCoefPct * Math.sqrt(notional / minuteDollars);
}

/**
 * Round-trip cost of buying and later selling `shares` at about `price`.
 * Returns percentages of the entry notional, dollars and per-share values.
 */
export function roundTripCost({ price, shares, spread = null, minuteDollars = null, commission = 0, exitPrice = price }) {
  if (!positive(price) || !(shares >= 0)) return null;
  const knownSpread = finite(spread) && spread >= 0;
  const s = knownSpread ? spread : COSTS.fallbackSpreadPct;
  const notional = shares * price;
  const impact = impactPct(notional, minuteDollars);
  const feesUsd = shares > 0
    ? COSTS.secFeeRate * shares * exitPrice + Math.min(COSTS.tafPerShare * shares, COSTS.tafMax) + 2 * (positive(commission) ? commission : 0)
    : 0;
  const feesPct = notional > 0 ? (feesUsd / notional) * 100 : 0;
  const modelPct = s + 2 * impact + feesPct;
  const totalPct = Math.max(modelPct, COSTS.minRoundTripPct);
  return {
    spreadPct: s,
    spreadSource: knownSpread ? 'QUOTE' : 'ASSUMED',
    impactPctPerSide: impact,
    feesUsd,
    modelPct,
    totalPct,
    floored: modelPct < COSTS.minRoundTripPct,
    totalUsd: (notional * totalPct) / 100,
    perShare: (price * totalPct) / 100,
    // Extra cost when the exit is a stop (market order into a falling tape).
    stopExtraPerShare: (price * s * COSTS.stopExtraSpreads) / 100,
  };
}

/** Largest notional the liquidity caps allow; Infinity when no volume is known. */
export function liquidityCap({ minuteDollars = null, dayDollars = null } = {}) {
  const caps = [];
  if (positive(minuteDollars)) caps.push(minuteDollars * COSTS.maxMinuteParticipation);
  if (positive(dayDollars)) caps.push(dayDollars * COSTS.maxDayParticipation);
  return caps.length ? Math.min(...caps) : Infinity;
}

/**
 * Integer position size so that the loss at the stop, INCLUDING round-trip costs and stop
 * slippage, stays within `riskBudget`; also bounded by capital and the liquidity caps.
 * Returns null for an invalid plan or inputs.
 */
export function sizeWithCosts(plan, { riskBudget, capital, spread = null, minuteDollars = null, dayDollars = null, commission = 0 } = {}) {
  if (!positive(plan?.entry) || !positive(plan?.stop) || plan.stop >= plan.entry) return null;
  if (!positive(riskBudget) || !positive(capital)) return null;
  const entry = plan.entry;
  const perShare = entry - plan.stop;
  const liqNotional = liquidityCap({ minuteDollars, dayDollars });
  const eps = 1 + 1e-9; // absorbs binary rounding such as 2.02 - 1.98
  const capitalShares = Math.floor((capital / entry) * eps);
  const liquidityShares = Number.isFinite(liqNotional) ? Math.floor((liqNotional / entry) * eps) : Infinity;
  const costAt = (n) => roundTripCost({ price: entry, shares: n, spread, minuteDollars, commission, exitPrice: plan.stop });
  const lossAt = (n) => { const c = costAt(n); return n * (perShare + c.stopExtraPerShare) + c.totalUsd; };

  let shares = Math.min(capitalShares, liquidityShares, Math.floor((riskBudget / perShare) * eps));
  // Costs grow with size (impact), so step down until the all-in loss fits the budget.
  for (let i = 0; i < 60 && shares > 0 && lossAt(shares) > riskBudget * eps; i++) {
    const c = costAt(shares);
    const next = Math.floor(riskBudget / (perShare + c.stopExtraPerShare + c.perShare));
    shares = next < shares ? next : shares - 1;
  }
  shares = Math.max(0, shares);
  const cost = costAt(shares);
  const plannedRisk = shares * perShare;
  const limitedBy = shares === capitalShares ? 'CAPITAL' : shares === liquidityShares ? 'LIQUIDITY' : 'RISK';
  const targets = Array.isArray(plan.targets) ? plan.targets.filter(positive) : [];
  const r = (usd) => (plannedRisk > 0 ? usd / plannedRisk : null);
  const targetCost = (t) => roundTripCost({ price: entry, shares, spread, minuteDollars, commission, exitPrice: t }).totalUsd;
  return {
    shares,
    perShare,
    notional: shares * entry,
    plannedRisk,
    limitedBy,
    liquidityNotional: Number.isFinite(liqNotional) ? liqNotional : null,
    cost,
    costUsd: cost.totalUsd,
    costR: r(cost.totalUsd),
    lossAtStopUsd: shares > 0 ? lossAt(shares) : 0,
    lossAtStopR: r(shares > 0 ? lossAt(shares) : 0),
    // Gross reward at each target and the same after costs (targets are limit exits: no stop slippage).
    rewards: targets.map((t) => shares * (t - entry)),
    netRewards: targets.map((t) => shares * (t - entry) - targetCost(t)),
    netRewardsR: targets.map((t) => r(shares * (t - entry) - targetCost(t))),
    breakEvenPct: cost.totalPct,
  };
}

/** Cost of a round trip in R for one share, independent of size except through impact. */
export function costInR({ entry, stop, spread = null, minuteDollars = null, shares = 1 }) {
  if (!positive(entry) || !positive(stop) || stop >= entry) return null;
  const c = roundTripCost({ price: entry, shares, spread, minuteDollars });
  return c.perShare / (entry - stop);
}
