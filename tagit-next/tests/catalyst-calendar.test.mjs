import test from 'node:test';
import assert from 'node:assert/strict';
import { upcomingCatalysts, catalystBanner } from '../src/views/dossier.js';

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
  assert.match(html, /معلومة لا توصية/);
  assert.match(String(catalystBanner(calendar, 'INO', '2026-10-02')), /PDUFA/);
  assert.equal(String(catalystBanner(calendar, 'NONE', '2026-10-02')), '');
});
