// Retry pacing for the polling loops and a per-run circuit breaker for the shared relay.
// Pure (clock injected) so it is testable in Node.

/** Delay before the next attempt after `failures` consecutive failures: base, 2×, 4× … capped. */
export function backoffDelay(failures, baseMs, maxMs) {
  if (!(failures > 0)) return baseMs;
  return Math.min(maxMs, baseMs * 2 ** Math.min(failures, 16));
}

/**
 * One gate per polling loop. `ready(now)` says whether a scheduled tick may run; `fail(now)` and
 * `ok()` update the pacing. A manual action or a reconnect calls `reset()`.
 */
export function createGate(baseMs, maxMs) {
  const gate = {
    failures: 0,
    nextAt: 0,
    ready: (now) => now >= gate.nextAt,
    fail(now) {
      gate.failures += 1;
      gate.nextAt = now + backoffDelay(gate.failures, baseMs, maxMs);
      return gate.nextAt;
    },
    ok() { gate.failures = 0; gate.nextAt = 0; },
    reset() { gate.ok(); },
  };
  return gate;
}

/** Errors that mean the service itself is unreachable or overloaded, not one bad batch. */
const FATAL = new Set(['NETWORK', 'TIMEOUT', 'PROVIDER_UNAVAILABLE', 'RATE_LIMITED', 'INVALID_RESPONSE']);

/**
 * Wrap a relay `getJson` for one scan run: after the first service-level failure the remaining
 * batches fail immediately instead of each hitting a dead or rate-limited server.
 */
export function breaker(getJson) {
  let open = null;
  return async (url) => {
    if (open) throw open;
    try {
      return await getJson(url);
    } catch (e) {
      if (FATAL.has(e?.code) || !e?.code) open = e;
      throw e;
    }
  };
}
