// Usage accounting for AI Hub.
//
// Every request served by the hub (OpenAI gateway, chat, TAGit) appends one line
// to the store's `usage` JSONL log. `summary()` aggregates the recent window for
// the admin dashboard.
//
// About `savedUSD`: the hub runs a self-hosted model, so nothing is actually billed.
// `savedUSD` is an ESTIMATE of what the same number of tokens would have cost at the
// configured reference prices (`config.refPriceInPerM` / `config.refPriceOutPerM`,
// USD per 1M input / output tokens). It is not a measured saving, and token counts
// themselves may be estimates (see `estimateTokens`). The prices used are returned
// alongside as `reference: { inPerM, outPerM }` so the UI can label the figure.

const LINES = 'usage';
const MAX_LINES = 200000;
const DAY_MS = 86400000;
const MAX_DAYS = 366;

// Arabic script: Arabic, Arabic Supplement, Arabic Extended-B/A, Presentation Forms A and B.
const ARABIC_RE = /[؀-ۿݐ-ݿࡰ-ࣿﭐ-﷿ﹰ-﻿]/gu;

/** Rough token estimate: ~4 chars per token for Latin text, ~2 for Arabic script. */
export function estimateTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  let total = 0;
  for (const _ of text) total += 1; // count code points, not UTF-16 units
  const arabic = (text.match(ARABIC_RE) || []).length;
  const other = total - arabic;
  return Math.max(1, Math.ceil(arabic / 2 + other / 4));
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function toPrice(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function toLabel(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const s = String(value).trim();
  return s ? s.slice(0, 120) : fallback;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function dayOf(ms) {
  return new Date(ms).toISOString().slice(0, 10); // UTC day
}

export function createUsage({ config = {}, store, now = () => Date.now() } = {}) {
  const inPerM = toPrice(config.refPriceInPerM, 2.5);
  const outPerM = toPrice(config.refPriceOutPerM, 10);

  // Estimated cost of these tokens at the reference prices (see file header).
  const estimateUSD = (promptTokens, completionTokens) =>
    round4((promptTokens / 1e6) * inPerM + (completionTokens / 1e6) * outPerM);

  /** Append one usage line. Never throws; returns the stored entry or null. */
  function record(entry) {
    try {
      const e = entry && typeof entry === 'object' ? entry : {};
      const line = {
        ts: new Date(now()).toISOString(),
        keyId: toLabel(e.keyId, null),
        project: toLabel(e.project, 'unknown'),
        kind: toLabel(e.kind, 'unknown'),
        model: toLabel(e.model, toLabel(config.model, '')),
        promptTokens: toCount(e.promptTokens),
        completionTokens: toCount(e.completionTokens),
        ms: toCount(e.ms),
        ok: e.ok === undefined ? true : Boolean(e.ok),
      };
      store.appendLine(LINES, line);
      return line;
    } catch {
      return null; // accounting must never break a request
    }
  }

  /** Aggregate the last `days` UTC days (today included). Never throws. */
  function summary({ days = 30 } = {}) {
    const requested = Math.floor(Number(days));
    const span = Number.isFinite(requested) ? Math.min(MAX_DAYS, Math.max(1, requested)) : 30;

    const today = Date.parse(`${dayOf(now())}T00:00:00.000Z`);
    const dayMap = new Map();
    for (let i = span - 1; i >= 0; i -= 1) {
      dayMap.set(dayOf(today - i * DAY_MS), { requests: 0, promptTokens: 0, completionTokens: 0 });
    }

    let lines = [];
    try {
      const read = store.readLines(LINES, { limit: MAX_LINES });
      if (Array.isArray(read)) lines = read;
    } catch {
      lines = [];
    }

    const totals = { requests: 0, errors: 0, promptTokens: 0, completionTokens: 0 };
    const projectMap = new Map();
    const kindMap = new Map();

    for (const line of lines) {
      if (!line || typeof line !== 'object') continue;
      const t = Date.parse(line.ts);
      if (!Number.isFinite(t)) continue;
      const bucket = dayMap.get(dayOf(t));
      if (!bucket) continue; // outside the window

      const promptTokens = toCount(line.promptTokens);
      const completionTokens = toCount(line.completionTokens);

      totals.requests += 1;
      if (line.ok === false) totals.errors += 1;
      totals.promptTokens += promptTokens;
      totals.completionTokens += completionTokens;

      bucket.requests += 1;
      bucket.promptTokens += promptTokens;
      bucket.completionTokens += completionTokens;

      const project = toLabel(line.project, 'unknown');
      let p = projectMap.get(project);
      if (!p) {
        p = { requests: 0, promptTokens: 0, completionTokens: 0 };
        projectMap.set(project, p);
      }
      p.requests += 1;
      p.promptTokens += promptTokens;
      p.completionTokens += completionTokens;

      const kind = toLabel(line.kind, 'unknown');
      kindMap.set(kind, (kindMap.get(kind) || 0) + 1);
    }

    const withEstimate = (row) => ({
      ...row,
      savedUSD: estimateUSD(row.promptTokens, row.completionTokens),
    });

    return {
      days: span,
      reference: { inPerM, outPerM },
      totals: withEstimate(totals),
      byProject: [...projectMap]
        .map(([project, row]) => withEstimate({ project, ...row }))
        .sort((a, b) => b.requests - a.requests || a.project.localeCompare(b.project)),
      byDay: [...dayMap].map(([day, row]) => withEstimate({ day, ...row })),
      byKind: [...kindMap]
        .map(([kind, requests]) => ({ kind, requests }))
        .sort((a, b) => b.requests - a.requests || a.kind.localeCompare(b.kind)),
    };
  }

  return { estimateTokens, record, summary };
}
