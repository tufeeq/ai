// Browser check of the live workspace: does it render, does every price show its source, and are
// prices that are not current marked as such? Uses Playwright's Chromium.
//
//   node ui_check.mjs --site https://tufeeq.github.io/ai/tagit-next/   the published page
//   node ui_check.mjs --local                                           this checkout, real service
//   node ui_check.mjs --local --mock                                    this checkout, canned service
// Writes ui-check-<mode>.json and a screenshot; exits 1 when a required check fails.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const LOCAL = process.argv.includes('--local'), MOCK = process.argv.includes('--mock');
const ROOT = process.env.TAGIT_ROOT || new URL('../', import.meta.url).pathname;
const BASE = LOCAL ? 'http://tagit.local/tagit-next/' : arg('--site') || 'https://tufeeq.github.io/ai/tagit-next/';
const MODE = LOCAL ? (MOCK ? 'local-mock' : 'local') : 'site';
const WAIT_MS = Number(arg('--wait') || 45_000);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

function mockService(url, now) {
  const at = (d) => new Date(now + d).toISOString();
  const row = (symbol, ageMs, extra = {}) => ({ symbol, name: `${symbol} Corp`, market_cap: 4e7, price: 2 + symbol.length / 10, price_at: at(-ageMs), quote_at: at(-ageMs), bid: 1.99, ask: 2.01,
    previous_close: 1.9, change_basis: 'SPLIT_ADJUSTED_PREVIOUS_CLOSE', extended: false, score: 10, signal: null, ...extra });
  if (url.pathname === '/api/scanner') {
    return { schema_version: 1, status: 'OK', feed: 'iex', server_time: at(0), refresh_ms: 30000,
      coverage: { nasdaq_assets: 3000, eligible_small_caps: 815, with_prices: 3, fresh_prices: 1, detailed_symbols: 3, metadata_at: at(-3_600_000) },
      rows: [row('FRSH', 3_000), row('STAL', 45 * 60_000), row('CONS', 50 * 60_000, { consolidated: { source: 'NASDAQ_COM', real_time: true, price: 3.1, trade_minute_at: new Date(Math.floor((now - 60_000) / 60_000) * 60_000).toISOString(), fetched_at: at(-5_000) } })],
      gainers: ['FRSH', 'STAL', 'CONS'], alerts: [] };
  }
  if (url.pathname === '/api/quotes') return { schema_version: 1, status: 'OK', rows: [], rejected: [] };
  if (url.pathname === '/api/lab/provider') return { bars: {} };
  return null; // 404 → /api/live absent, like the currently deployed service
}

const report = { mode: MODE, base: BASE, checked_at: new Date().toISOString(), checks: {} };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, locale: 'ar' });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
const requests = { live: [], closes: 0 };
page.on('response', (r) => {
  const u = new URL(r.url());
  if (u.pathname === '/api/live') requests.live.push(r.status());
  if (u.pathname === '/api/lab/provider' && u.searchParams.get('timeframe') === '1Day') requests.closes++;
});
if (LOCAL) {
  await page.route('http://tagit.local/**', (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//, '');
    const file = join(ROOT, '..', path.endsWith('/') ? path + 'index.html' : path);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
  });
}
if (MOCK) {
  await page.route('https://tagit-next-quotes.onrender.com/**', (route) => {
    const body = mockService(new URL(route.request().url()), Date.now());
    return route.fulfill({ status: body ? 200 : 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body ?? { status: 'NOT_FOUND' }) });
  });
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
// Wait for scanner rows (a cold free server can take close to a minute).
await page.waitForSelector('#list [data-symbol]', { timeout: WAIT_MS }).catch(() => {});
await page.waitForTimeout(MOCK ? 3000 : 15_000);
for (const view of ['early', 'gainers']) {
  await page.click(`[data-view="${view}"]`).catch(() => {});
  await page.waitForTimeout(800);
  report.checks[view] = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#list .row[data-symbol]')];
    const info = rows.map((r) => ({
      symbol: r.dataset.symbol,
      price: r.querySelector('.px')?.textContent?.trim() ?? null,
      source: r.querySelector('.px-src')?.textContent?.trim() ?? null,
      level: [...(r.querySelector('.px-src')?.classList ?? [])].find((c) => c.startsWith('q-')) ?? null,
      stale_marked: Boolean(r.querySelector('.row-price.is-stale')),
      age: r.querySelector('.age-text')?.textContent?.trim() ?? null,
      dot: [...(r.querySelector('.row-age .dot')?.classList ?? [])].filter((c) => c !== 'dot').join(' '),
    }));
    return {
      rows: info.length,
      with_source: info.filter((x) => x.source).length,
      stale_marked: info.filter((x) => x.stale_marked).length,
      by_level: info.reduce((m, x) => ((m[x.level ?? 'none'] = (m[x.level ?? 'none'] ?? 0) + 1), m), {}),
      // Invariant: a row whose dot says stale/delayed/aging must be visually marked.
      unmarked_old: info.filter((x) => ['stale', 'aging', 'delayed'].includes(x.dot) && !x.stale_marked).map((x) => x.symbol),
      sample: info.slice(0, 8),
    };
  });
}
report.checks.notices = await page.$$eval('#notices .notice', (els) => els.map((e) => e.textContent.trim()));
report.checks.kpis = await page.$$eval('#kpis .kpi', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
report.requests = requests;
report.console_errors = consoleErrors.slice(0, 10);
await page.screenshot({ path: `ui-check-${MODE}.png`, fullPage: false });
// Dossier of the first row.
const first = await page.$('#list .row[data-symbol]');
if (first) {
  await first.click();
  await page.waitForTimeout(600);
  report.checks.dossier = await page.$eval('#dossier', (d) => ({
    meta: d.querySelector('.meta-age')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
    context: d.querySelector('.price-context')?.textContent.trim() ?? null,
    stale_marked: Boolean(d.querySelector('.dossier-price.is-stale')),
  }));
}
await browser.close();

const e = report.checks.early ?? {}, g = report.checks.gainers ?? {};
const rendered = (e.rows ?? 0) + (g.rows ?? 0) > 0;
// The new provenance markup exists only in this checkout; the published page is checked for rendering.
const provenance = MODE === 'site' ? true : (g.rows ?? 0) === (g.with_source ?? -1) && !(g.unmarked_old ?? []).length && !(e.unmarked_old ?? []).length;
report.pass = { rendered, provenance, no_page_errors: !consoleErrors.some((x) => /TypeError|ReferenceError|SyntaxError/.test(x)) };
writeFileSync(`ui-check-${MODE}.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
if (!Object.values(report.pass).every(Boolean)) process.exit(1);
