// Public entry point for the pure opportunity core (kept for tests and the deploy check).
export { finite, positive, elapsed, within, isSymbol } from './src/core/util.js';
export { marketDate, marketSession, mergeMarketRow } from './src/core/market.js';
export { RULES, assess, isExtended, splitPriority } from './src/core/checks.js';
export { sizePosition } from './src/core/sizing.js';
export { createWatchEvent, createSignalEvent, recordObservation, outcome, restoreJournal } from './src/core/journal.js';
export { updatePressure, pressureSummary } from './src/core/pressure.js';
export { shariaStatus } from './src/core/sharia.js';
