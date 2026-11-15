import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsage, estimateTokens } from '../src/usage.mjs';

const DAY_MS = 86400000;
const NOW = Date.parse('2026-03-10T12:00:00.000Z');

function fakeStore() {
  const lines = {};
  return {
    lines,
    appendLine(name, obj) {
      (lines[name] ||= []).push(JSON.parse(JSON.stringify(obj)));
    },
    readLines(name, { limit = 10000 } = {}) {
      this.lastLimit = limit;
      return (lines[name] || []).slice(-limit);
    },
  };
}

function setup({ config = { model: 'qwen2.5:3b', refPriceInPerM: 2.5, refPriceOutPerM: 10 } } = {}) {
  const store = fakeStore();
  const clock = { t: NOW };
  const usage = createUsage({ config, store, now: () => clock.t });
  return { store, clock, usage };
}

test('estimateTokens: empty and non-string input is 0', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens(null), 0);
  assert.equal(estimateTokens(undefined), 0);
  assert.equal(estimateTokens(42), 0);
  assert.equal(estimateTokens({}), 0);
});

test('estimateTokens: English is about chars/4 with a minimum of 1', () => {
  assert.equal(estimateTokens('a'), 1);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('a'.repeat(400)), 100);
  assert.equal(estimateTokens('hello world!'), 3); // 12 chars
});

test('estimateTokens: Arabic script is about chars/2', () => {
  assert.equal(estimateTokens('م'), 1);
  assert.equal(estimateTokens('م'.repeat(100)), 50);
  assert.equal(estimateTokens('مرحبا'), 3); // 5 Arabic chars -> ceil(2.5)
  // Mixed: 4 Arabic (2) + 8 Latin/space chars (2) = 4
  assert.equal(estimateTokens('سلام hi there'.slice(0, 12)), 4);
  const text = 'تحليل السهم';
  assert.ok(estimateTokens(text) > estimateTokens('x'.repeat([...text].length)));
});

test('createUsage exposes estimateTokens', () => {
  const { usage } = setup();
  assert.equal(usage.estimateTokens('abcdefgh'), 2);
});

test('record appends a normalised line with an ISO timestamp', () => {
  const { store, usage } = setup();
  usage.record({
    keyId: 'k1', project: 'tagit', kind: 'tagit', model: 'm1',
    promptTokens: '120', completionTokens: 30.4, ms: 950, ok: true,
  });
  assert.equal(store.lines.usage.length, 1);
  assert.deepEqual(store.lines.usage[0], {
    ts: '2026-03-10T12:00:00.000Z',
    keyId: 'k1', project: 'tagit', kind: 'tagit', model: 'm1',
    promptTokens: 120, completionTokens: 30, ms: 950, ok: true,
  });
});

test('record coerces bad numbers and never throws', () => {
  const { store, usage } = setup();
  usage.record({ project: 'p', kind: 'chat', promptTokens: 'abc', completionTokens: -5, ms: NaN, ok: false });
  const line = store.lines.usage[0];
  assert.equal(line.promptTokens, 0);
  assert.equal(line.completionTokens, 0);
  assert.equal(line.ms, 0);
  assert.equal(line.ok, false);
  assert.equal(line.model, 'qwen2.5:3b'); // falls back to config.model

  assert.doesNotThrow(() => usage.record());
  assert.doesNotThrow(() => usage.record(null));

  const broken = createUsage({
    config: {},
    store: { appendLine() { throw new Error('disk full'); }, readLines() { throw new Error('nope'); } },
  });
  assert.doesNotThrow(() => broken.record({ project: 'p' }));
  assert.equal(broken.summary().totals.requests, 0);
});

test('summary aggregates totals, projects, kinds and the estimated cost', () => {
  const { usage } = setup();
  usage.record({ keyId: 'a', project: 'tagit', kind: 'tagit', promptTokens: 1_000_000, completionTokens: 500_000, ms: 10, ok: true });
  usage.record({ keyId: 'b', project: 'operon', kind: 'openai', promptTokens: 2000, completionTokens: 1000, ms: 10, ok: true });
  usage.record({ keyId: 'b', project: 'operon', kind: 'openai', promptTokens: 3000, completionTokens: 0, ms: 10, ok: false });
  usage.record({ keyId: 'b', project: 'operon', kind: 'chat', promptTokens: 0, completionTokens: 111, ms: 10, ok: true });

  const s = usage.summary();
  assert.equal(s.days, 30);
  assert.deepEqual(s.reference, { inPerM: 2.5, outPerM: 10 });
  assert.deepEqual(s.totals, {
    requests: 4, errors: 1, promptTokens: 1_005_000, completionTokens: 501_111,
    savedUSD: 7.5236, // 2.5125 + 5.01111 = 7.52361
  });

  assert.deepEqual(s.byProject, [
    { project: 'operon', requests: 3, promptTokens: 5000, completionTokens: 1111, savedUSD: 0.0236 },
    { project: 'tagit', requests: 1, promptTokens: 1_000_000, completionTokens: 500_000, savedUSD: 7.5 },
  ]);
  assert.deepEqual(s.byKind, [
    { kind: 'openai', requests: 2 },
    { kind: 'chat', requests: 1 },
    { kind: 'tagit', requests: 1 },
  ]);
});

test('summary uses the configured reference prices', () => {
  const { usage } = setup({ config: { refPriceInPerM: 1, refPriceOutPerM: 4 } });
  usage.record({ project: 'p', kind: 'chat', promptTokens: 500_000, completionTokens: 250_000 });
  const s = usage.summary({ days: 1 });
  assert.deepEqual(s.reference, { inPerM: 1, outPerM: 4 });
  assert.equal(s.totals.savedUSD, 1.5);
});

test('summary filters to the day window', () => {
  const { clock, usage } = setup();
  clock.t = NOW - 10 * DAY_MS;
  usage.record({ project: 'old', kind: 'chat', promptTokens: 100, completionTokens: 100 });
  clock.t = NOW - 6 * DAY_MS; // first day inside a 7-day window
  usage.record({ project: 'edge', kind: 'chat', promptTokens: 10, completionTokens: 10 });
  clock.t = NOW - 7 * DAY_MS; // just outside
  usage.record({ project: 'out', kind: 'chat', promptTokens: 1, completionTokens: 1 });
  clock.t = NOW;
  usage.record({ project: 'today', kind: 'openai', promptTokens: 5, completionTokens: 5 });

  const week = usage.summary({ days: 7 });
  assert.equal(week.days, 7);
  assert.equal(week.totals.requests, 2);
  assert.equal(week.totals.promptTokens, 15);
  assert.deepEqual(week.byProject.map((p) => p.project), ['edge', 'today']);

  const month = usage.summary({ days: 30 });
  assert.equal(month.totals.requests, 4);

  const one = usage.summary({ days: 1 });
  assert.equal(one.totals.requests, 1);
  assert.deepEqual(one.byDay.map((d) => d.day), ['2026-03-10']);
});

test('byDay contains every day in the window, ascending and zero-filled', () => {
  const { clock, usage } = setup();
  clock.t = NOW - 2 * DAY_MS;
  usage.record({ project: 'p', kind: 'chat', promptTokens: 1_000_000, completionTokens: 0 });
  usage.record({ project: 'p', kind: 'chat', promptTokens: 0, completionTokens: 1_000_000 });
  clock.t = NOW;

  const s = usage.summary({ days: 5 });
  assert.deepEqual(s.byDay.map((d) => d.day), [
    '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10',
  ]);
  assert.deepEqual(s.byDay[2], {
    day: '2026-03-08', requests: 2, promptTokens: 1_000_000, completionTokens: 1_000_000, savedUSD: 12.5,
  });
  for (const i of [0, 1, 3, 4]) {
    assert.deepEqual(s.byDay[i], {
      day: s.byDay[i].day, requests: 0, promptTokens: 0, completionTokens: 0, savedUSD: 0,
    });
  }

  const empty = setup().usage.summary({ days: 30 });
  assert.equal(empty.byDay.length, 30);
  assert.equal(empty.byDay.at(-1).day, '2026-03-10');
  assert.deepEqual(empty.byProject, []);
  assert.deepEqual(empty.byKind, []);
  assert.deepEqual(empty.totals, { requests: 0, errors: 0, promptTokens: 0, completionTokens: 0, savedUSD: 0 });
});

test('summary tolerates bad input and malformed lines', () => {
  const { store, usage } = setup();
  store.lines.usage = [
    null,
    'garbage',
    { ts: 'not-a-date', project: 'x', promptTokens: 5 },
    { ts: '2026-03-10T01:00:00.000Z', promptTokens: '7', completionTokens: 'oops' },
  ];
  const s = usage.summary({ days: 'abc' });
  assert.equal(s.days, 30);
  assert.equal(s.totals.requests, 1);
  assert.equal(s.totals.promptTokens, 7);
  assert.equal(s.totals.completionTokens, 0);
  assert.deepEqual(s.byProject.map((p) => p.project), ['unknown']);
  assert.equal(store.lastLimit, 200000);

  assert.equal(usage.summary({ days: 0 }).days, 1);
  assert.equal(usage.summary({ days: -3 }).days, 1);
  assert.equal(usage.summary({ days: 100000 }).days, 366);
});
