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

test('plan label: a gap through the stop exits at the gap open, and R after cost is below gross R', () => {
  const plans = report.events.map((e) => e.plan).filter((p) => p && ['STOP', 'TARGET_2R', 'TIME'].includes(p.status));
  const gaps = plans.filter((p) => p.gap);
  assert.ok(gaps.length > 0);
  for (const p of gaps) assert.ok(p.r < -1 + 1e-12, `gap stop must lose at least 1R, got ${p.r}`);
  for (const p of plans.filter((x) => x.status === 'STOP' && !x.gap)) assert.ok(Math.abs(p.r + 1) < 1e-9);
  for (const p of plans) assert.ok(p.r_after_cost < p.r);
  assert.equal(report.corrected['2m'].plan.stop_gaps, gaps.length);
});
