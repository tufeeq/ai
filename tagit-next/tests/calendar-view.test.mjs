import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarEntries, renderCalendarList } from '../src/views/calendar.js';
import { createState } from '../src/state.js';

const calendar = {
  updated_at: '2026-10-03T10:17:00Z',
  earnings: [{ symbol: 'BYRN', date: '2026-10-08', time: 'PRE_MARKET', market_cap_m: 81.9 }, { symbol: 'OLD', date: '2026-09-01' }],
  fda: [{ symbol: 'INO', date: '2026-10-30', announced: '2025-12-29', market_cap_m: 122.3, industry: 'Biotechnology' }],
  after_news: [{ symbol: 'RUN', report_day: '2026-10-01', reaction_day: '2026-10-02', warn_until: '2026-10-06', runup_pct: 14 }],
};

test('calendar entries: sell-the-news warnings first, then upcoming dates in order', () => {
  const e = calendarEntries(calendar, '2026-10-05');
  assert.deepEqual(e.map((x) => `${x.kind}:${x.symbol}`), ['after:RUN', 'earnings:BYRN', 'fda:INO']);
  assert.deepEqual(calendarEntries(calendar, '2026-10-09').map((x) => x.symbol), ['INO']);
});

test('the calendar tab lists each date with its countdown and the study note', () => {
  const state = createState();
  state.catalysts = calendar;
  const now = Date.parse('2026-10-05T15:00:00Z');
  const out = renderCalendarList(state, now);
  assert.equal(out.count, 3);
  const html = String(out.markup);
  assert.match(html, /قرار FDA/);
  assert.match(html, /بعد 25 يوم|بعد ٢٥ يوم/);
  assert.match(html, /بيع على الخبر/);
  assert.match(html, /data-symbol="INO"/);
  assert.equal(renderCalendarList(createState(), now).count, 0);
});
