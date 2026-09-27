import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fadeCard, renderEvidence } from '../src/views/evidence.js';

const s = (mean, lo, hi) => ({ trades: 1000, mean_pct: mean, ci95: [lo, hi], worst_pct: -180, p_loss_gt_50: 0.02 });
const sample = (holds) => ({
  protocol: 'fade-study-1',
  universe: { symbols: 3500, inactive: 550 },
  eras: { development: { from: '2023-01-03', to: '2026-09-24' }, holdout: { from: '2018-01-02', to: '2022-12-30' } },
  short: {
    selected: holds ? { event: 'gap_hold', horizon_days: 5 } : null,
    holds,
    reference: { event: 'extended_any', horizon_days: 5, development: s(1, 0.2, 2), holdout: s(holds ? 1 : -1, holds ? 0.1 : -2, 0.5), holdout_borrow_100: s(0.5, -1, 1), contaminated_holdout: s(2, 1, 3) },
    sensitivity: { holdout: { s25: { 0: { mean_pct: 1 }, 50: { mean_pct: 0.5 }, 300: { mean_pct: -3 } } } },
    table: { gap_hold: { 5: { development: s(1, 0, 2), holdout: s(-1, -2, 0) } } },
  },
  avoid: { holds: false, primary: { development: { flagged_trades: 10, flagged_net_pct: -2, baseline_net_pct: -0.3, diff_pct: -1.7, diff_ci95: [-3, -0.5] }, holdout: { flagged_trades: 10, diff_pct: 0.2, diff_ci95: [-1, 1.4] } } },
});

test('fade card states the verdicts in Arabic and never hides a negative result', () => {
  const out = String(fadeCard(sample(false)));
  assert.match(out, /لم تكن أي صيغة رابحة/);
  assert.match(out, /لم يثبت/);
  assert.match(out, /2018-01-02/);
  assert.match(out, /لا أوامر/);
  assert.match(String(fadeCard(sample(true))), /صمد: فجوة صاعدة صامدة/);
  assert.equal(String(fadeCard(null)), '');
  assert.match(String(renderEvidence({ fade: sample(false) })), /دراسة الامتداد/);
});

test('published fade data, when present, renders', () => {
  const url = new URL('../data/fade-study.json', import.meta.url);
  if (!existsSync(url)) return;
  const data = JSON.parse(readFileSync(url, 'utf8'));
  assert.equal(data.protocol, 'fade-study-1');
  assert.equal(data.profitability_claim_allowed, false);
  assert.match(String(fadeCard(data)), /دراسة الامتداد/);
});

test('dossier shows the extension warning only inside its five-session window', async () => {
  const { fadeBanner } = await import('../src/views/dossier.js');
  const flags = { sessions: ['2026-09-25', '2026-09-24', '2026-09-23', '2026-09-22', '2026-09-21'], symbols: { AAA: { d: '2026-09-23', events: ['gap_hold'], c: 3 }, OLD: { d: '2026-09-10', events: ['spike_50'] } } };
  const out = String(fadeBanner(flags, 'AAA'));
  assert.match(out, /تحذير امتداد/);
  assert.match(out, /فجوة صاعدة صامدة/);
  assert.match(out, /البيع على المكشوف/);
  assert.equal(String(fadeBanner(flags, 'OLD')), '');
  assert.equal(String(fadeBanner(null, 'AAA')), '');
});
