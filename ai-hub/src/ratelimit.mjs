// Rate limiting, security headers and client IP resolution for AI Hub.
// Zero dependencies; all state is in memory and bounded.

const WINDOW_MS = 60_000; // sliding window for check()
const MAX_IDS = 10_000; // hard cap on tracked ids (per table)
const CLEANUP_EVERY_MS = 60_000;

const AUTH_FAIL_LIMIT = 20; // failed attempts ...
const AUTH_FAIL_WINDOW_MS = 10 * 60_000; // ... within this window ...
const AUTH_BLOCK_MS = 10 * 60_000; // ... block the IP for this long

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const SECURITY_HEADERS = Object.freeze([
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Referrer-Policy', 'no-referrer'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  ['Content-Security-Policy', CSP],
]);

function toLimit(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : 60;
}

function toId(id) {
  const s = id === undefined || id === null ? '' : String(id);
  return s === '' ? 'anonymous' : s.slice(0, 200);
}

// Drop timestamps that fell out of the window (arrays are kept in ascending order).
function prune(stamps, cutoff) {
  let i = 0;
  while (i < stamps.length && stamps[i] <= cutoff) i++;
  if (i > 0) stamps.splice(0, i);
}

// Insert while keeping the Map bounded: least recently used entries go first.
function boundedSet(map, key, value) {
  map.delete(key);
  while (map.size >= MAX_IDS) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
  map.set(key, value);
}

export function createLimiter({ config, now = Date.now } = {}) {
  const limit = toLimit(config?.rateLimitRpm);

  const hits = new Map(); // id -> ascending request timestamps inside the window
  const failures = new Map(); // ip -> ascending failed-auth timestamps
  const blocks = new Map(); // ip -> blockedUntil (ms)

  function cleanup() {
    const t = now();
    for (const [id, stamps] of hits) {
      prune(stamps, t - WINDOW_MS);
      if (stamps.length === 0) hits.delete(id);
    }
    for (const [ip, stamps] of failures) {
      prune(stamps, t - AUTH_FAIL_WINDOW_MS);
      if (stamps.length === 0) failures.delete(ip);
    }
    for (const [ip, until] of blocks) {
      if (until <= t) blocks.delete(ip);
    }
  }

  const timer = setInterval(cleanup, CLEANUP_EVERY_MS);
  if (typeof timer.unref === 'function') timer.unref();

  function check(id) {
    const key = toId(id);
    const t = now();
    let stamps = hits.get(key);
    if (stamps) {
      prune(stamps, t - WINDOW_MS);
    } else {
      if (hits.size >= MAX_IDS) cleanup();
      stamps = [];
    }

    if (stamps.length >= limit) {
      // The oldest request leaving the window frees one slot.
      const waitMs = stamps[0] + WINDOW_MS - t;
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil(waitMs / 1000)) };
    }

    stamps.push(t);
    boundedSet(hits, key, stamps); // also refreshes recency
    return { ok: true, retryAfterSec: 0 };
  }

  function blockRemainingSec(ip) {
    const key = toId(ip);
    const until = blocks.get(key);
    if (until === undefined) return 0;
    const t = now();
    if (until <= t) {
      blocks.delete(key);
      return 0;
    }
    return Math.max(1, Math.ceil((until - t) / 1000));
  }

  function isBlocked(ip) {
    return blockRemainingSec(ip) > 0;
  }

  // Record one failed authentication attempt. Returns the resulting block state.
  function failedAuth(ip) {
    const key = toId(ip);
    const remaining = blockRemainingSec(key);
    if (remaining > 0) return { blocked: true, retryAfterSec: remaining };

    const t = now();
    let stamps = failures.get(key);
    if (stamps) {
      prune(stamps, t - AUTH_FAIL_WINDOW_MS);
    } else {
      if (failures.size >= MAX_IDS) cleanup();
      stamps = [];
    }
    stamps.push(t);

    if (stamps.length >= AUTH_FAIL_LIMIT) {
      failures.delete(key);
      if (blocks.size >= MAX_IDS) cleanup();
      boundedSet(blocks, key, t + AUTH_BLOCK_MS);
      return { blocked: true, retryAfterSec: Math.ceil(AUTH_BLOCK_MS / 1000) };
    }

    boundedSet(failures, key, stamps);
    return { blocked: false, retryAfterSec: 0 };
  }

  function securityHeaders(res) {
    if (!res || res.headersSent || typeof res.setHeader !== 'function') return;
    try {
      for (const [name, value] of SECURITY_HEADERS) res.setHeader(name, value);
    } catch {
      // Headers already flushed or response destroyed: nothing useful to do.
    }
  }

  // The hub runs behind Traefik, which sets X-Forwarded-For; the first hop is the client.
  // Do not expose the app port directly, otherwise this header is client-controlled.
  function clientIp(req) {
    const raw = req?.headers?.['x-forwarded-for'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    let ip = typeof header === 'string' ? header.split(',')[0].trim() : '';
    if (!ip) ip = String(req?.socket?.remoteAddress || '').trim();
    if (!ip) return 'unknown';
    if (ip.toLowerCase().startsWith('::ffff:') && ip.includes('.')) ip = ip.slice(7);
    return ip.slice(0, 64);
  }

  // Stops the cleanup timer (the timer is unref'd, so calling this is optional).
  function close() {
    clearInterval(timer);
  }

  return {
    check,
    securityHeaders,
    clientIp,
    failedAuth,
    isBlocked,
    cleanup,
    close,
    size: () => hits.size,
  };
}
