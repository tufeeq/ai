import test from 'node:test';
import assert from 'node:assert/strict';
import { upcomingCatalysts, catalystBanner, afterNewsWarning } from '../src/views/dossier.js';

const calendar = {
  earnings: [{ symbol: 'BYRN', date: '2026-10-08', time: 'PRE_MARKET' }, { symbol: 'OLD', date: '2026-09-01', time: 'AFTER_HOURS' }],
  fda: [{ symbol: 'INO', date: '2026-10-30', announced: '2025-12-29' }],
};

test('upcoming catalysts are the symbol\'s dates from today on', () => {
  assert.deepEqual(upcomingCatalysts(calendar, 'BYRN', '2026-10-02').map((e) => e.kind), ['earnings']);
  assert.equal(upcomingCatalysts(calendar, 'OLD', '2026-10-02').length, 0);
  assert.equal(upcomingCatalysts(null, 'INO', '2026-10-02').length, 0);
});

test('the dossier note names the date, the timing and that it is information only', () => {
  const html = String(catalystBanner(calendar, 'BYRN', '2026-10-02'));
  assert.match(html, /نتائج مالية/);
  assert.match(html, /2026-10-08/);
  assert.match(html, /قبل الافتتاح/);
  assert.match(html, /لا ميزة بعد التكلفة/);
  assert.match(String(catalystBanner(calendar, 'INO', '2026-10-02')), /PDUFA/);
  assert.equal(String(catalystBanner(calendar, 'NONE', '2026-10-02')), '');
});

test('after a report that followed a 10% run-up, the dossier warns for 3 sessions', () => {
  const cal = { ...calendar, after_news: [{ symbol: 'RUN', report_day: '2026-09-30', reaction_day: '2026-10-01', warn_until: '2026-10-05', runup_pct: 14.2 }] };
  assert.ok(afterNewsWarning(cal, 'RUN', '2026-10-02'));
  assert.equal(afterNewsWarning(cal, 'RUN', '2026-09-30'), null); // before the reaction session
  assert.equal(afterNewsWarning(cal, 'RUN', '2026-10-06'), null); // window over
  const out = String(catalystBanner(cal, 'RUN', '2026-10-02'));
  assert.match(out, /بيع على الخبر/);
  assert.match(out, /−٣٫٠ إلى −٠٫٣/);
});
