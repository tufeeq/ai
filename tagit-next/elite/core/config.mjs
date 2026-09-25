export const DEFAULTS = Object.freeze({
  version: 'elite-shadow-1', featureVersion: 'elite-features-1', mode: 'SHADOW',
  maxMarketCap: 100000000, exchanges: ['NASDAQ'], shariaRequired: true,
  maxMetadataAgeMs: 86400000, maxLatencyMs: 90000, stateContiguousBars: 3,
  confirmationBars: 2, pullbackATR: 1.25, failureATR: 2.5,
  minPullbackFraction: 0.15, maxEntryExtensionATR: 2.5, maxSpreadPct: 0.8,
  confirmationExpiryMinutes: 10, minNewWaveMinutes: 30,
  periods: {openingMinutes: 30, morningMinutes: 150, finalMinutes: 60},
  execution: {latencyMs: 1000, spreadBps: 40, slippageBps: 10, feeBps: 1,
    quantity: 100, maxParticipation: 0.01, ttlMinutes: 5, holdingMinutes: 30,
    maxAttempts: 2, entryCutoffMinutes: 10},
  validation: 'UNPROVEN', allowOrders: false
});
export function configuration(overrides = {}) {
  const c = {...DEFAULTS, ...overrides, periods: {...DEFAULTS.periods,...overrides.periods}, execution:{...DEFAULTS.execution,...overrides.execution}};
  if (!(c.maxMarketCap > 0) || !Number.isInteger(c.confirmationBars) || c.confirmationBars < 2 || !['SHADOW','REPLAY','SIMULATION'].includes(c.mode)) throw Error('INVALID_CONFIG');
  for (const k of ['latencyMs','spreadBps','slippageBps','feeBps','quantity','maxParticipation','ttlMinutes','holdingMinutes','maxAttempts','entryCutoffMinutes']) if (!Number.isFinite(c.execution[k]) || c.execution[k] < 0) throw Error('INVALID_EXECUTION_CONFIG');
  if (c.execution.quantity<=0 || c.execution.maxParticipation>1 || c.execution.maxAttempts<1) throw Error('INVALID_EXECUTION_CONFIG');
  c.allowOrders=false;c.validation='UNPROVEN';return c;
}
