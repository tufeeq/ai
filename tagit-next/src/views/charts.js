// Inline SVG charts. Colors come from CSS custom properties so both themes work.
import { html, raw, escape } from '../html.js';
import * as f from '../format.js';
import { positive } from '../core/util.js';

/**
 * Observed price samples after detection, with the start price as a baseline.
 * Samples are discrete; the connecting line does not claim a continuous path.
 */
export function samplesChart(event) {
  const points = (event.points ?? []).filter((p) => positive(p.price));
  if (points.length < 2) {
    return html`<p class="note">يظهر الرسم بعد عينتين جديدتين من بدء المتابعة. لا نملأ الفترة السابقة ببيانات مصطنعة.</p>`;
  }
  const W = 420, H = 150, L = 8, R = 60, T = 12, B = 22;
  const prices = [...points.map((p) => p.price), event.start_price];
  const lo = Math.min(...prices), hi = Math.max(...prices);
  const span = Math.max(hi - lo, hi * 1e-6);
  const t0 = Date.parse(points[0].at), t1 = Date.parse(points.at(-1).at);
  const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (p) => T + (1 - (p - lo) / span) * (H - T - B);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(Date.parse(p.at)).toFixed(1)},${y(p.price).toFixed(1)}`).join('');
  const area = `${path}L${x(t1).toFixed(1)},${H - B}L${L},${H - B}Z`;
  const last = points.at(-1);
  const up = last.price >= event.start_price;
  const base = y(event.start_price).toFixed(1);
  return html`<figure class="chart ${up ? 'up' : 'down'}">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="عينات السعر المرصودة بعد بدء المتابعة">
      <path class="chart-area" d="${area}"/>
      <line class="chart-base" x1="${L}" x2="${W - R}" y1="${base}" y2="${base}"/>
      <text class="chart-tag" x="${W - R + 6}" y="${Number(base) + 4}">${f.price(event.start_price)}</text>
      <path class="chart-line" d="${path}"/>
      <circle class="chart-dot" cx="${x(t1).toFixed(1)}" cy="${y(last.price).toFixed(1)}" r="3.5"/>
      <text class="chart-tag strong" x="${W - R + 6}" y="${(y(last.price) + 4).toFixed(1)}">${f.price(last.price)}</text>
      <text class="chart-axis" x="${L}" y="${H - 6}">${f.time(points[0].at)}</text>
      <text class="chart-axis" x="${W - R}" y="${H - 6}" text-anchor="end">${f.time(last.at)}</text>
    </svg>
    <figcaption>${points.length} عينة منفصلة · الخط المتقطع سعر الرصد · التوقيت بنيويورك</figcaption>
  </figure>`;
}

/** Vertical price ladder: stop, entry, targets and the live price marker. */
export function planLadder(levels, price) {
  const marks = levels.filter((m) => positive(m.value));
  if (marks.length < 2) return '';
  const all = [...marks.map((m) => m.value), ...(positive(price) ? [price] : [])];
  const lo = Math.min(...all), hi = Math.max(...all);
  const span = Math.max(hi - lo, hi * 1e-6);
  const H = 200, T = 14, B = 14;
  const y = (v) => T + (1 - (v - lo) / span) * (H - T - B);
  const rows = marks.map((m) => {
    const yy = y(m.value).toFixed(1);
    return raw(`<g class="lvl lvl-${m.kind}"><line x1="70" x2="330" y1="${yy}" y2="${yy}"/><text x="62" y="${Number(yy) + 4}" text-anchor="end">${f.price(m.value)}</text><text class="lvl-name" x="338" y="${Number(yy) + 4}">${escape(m.label)}</text></g>`);
  });
  const stop = marks.find((m) => m.kind === 'stop');
  const entry = marks.find((m) => m.kind === 'entry');
  const zone = stop && entry
    ? raw(`<rect class="zone-risk" x="70" width="260" y="${y(entry.value).toFixed(1)}" height="${Math.max(1, y(stop.value) - y(entry.value)).toFixed(1)}"/>`)
    : '';
  const target = marks.filter((m) => m.kind === 'target').at(-1);
  const reward = target && entry
    ? raw(`<rect class="zone-reward" x="70" width="260" y="${y(target.value).toFixed(1)}" height="${Math.max(1, y(entry.value) - y(target.value)).toFixed(1)}"/>`)
    : '';
  const now = positive(price)
    ? raw(`<g class="lvl-now"><circle cx="200" cy="${y(price).toFixed(1)}" r="5"/><text x="210" y="${(y(price) - 8).toFixed(1)}">الآن ${f.price(price)}</text></g>`)
    : '';
  return html`<svg class="ladder" viewBox="0 0 420 ${H}" role="img" aria-label="مستويات الخطة والسعر الحالي" dir="ltr">${reward}${zone}${rows}${now}</svg>`;
}
