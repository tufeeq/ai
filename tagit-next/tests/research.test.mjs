import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run } from '../research/outcome-relabel.mjs';

const report = run(); // one full run (~8 s) shared by every test

test('relabel reproduces every frozen event and the frozen 84-signal mean before correcting', () => {
  assert.equal(report.reproduced.events, 322);
  assert.equal(report.reproduced.frozen_scorable, 84);
  assert.ok(Math.abs(report.reproduced.frozen_mean_return_after_cost_pct + 1.4258583700865177) < 1e-12);
});

test('corrected label leaves no unknown outcomes and never codes a missing entry as a return', () => {
  for (const summary of Object.values(report.corrected)) {
    assert.equal(summary.unknown, 0);
    assert.equal(summary.resolved + summary.no_entry, summary.signals);
  }
  for (const e of report.events) {
    if (e.status === 'NO_ENTRY') assert.equal(e.return_after_cost_pct, undefined);
    else assert.ok(Number.isFinite(e.return_after_cost_pct) && e.minutes_with_trades >= 1);
  }
});

test('published relabel file matches a fresh run', () => {
  const published = JSON.parse(readFileSync(new URL('../data/outcome-relabel.json', import.meta.url)));
  assert.deepEqual(published, JSON.parse(JSON.stringify(report)));
});
