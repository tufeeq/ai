/*
 * TAGit signal — نسخة JavaScript مطابقة لمنطق tagit_lab (Python) لاستخدامها في الواجهة الحية.
 * المطابقة مُختبرة آليًا (tests/test_js_parity.py)؛ أي تعديل هنا يجب أن يقابله تعديل في Python.
 *
 * الشبكة (grid): مصفوفات طولها 390 (09:30..15:59 بتوقيت نيويورك):
 *   { o, h, l, c, vw, v, n, traded }  — الدقائق بلا صفقات: v=0, والأسعار = آخر إغلاق.
 * القواعد (rules): تُقرأ من results/forward/summary.json → rules.signal / rules.exit
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TagitSignal = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const N_MIN = 390;
  const isNum = (x) => typeof x === "number" && Number.isFinite(x);

  function hhmmToIdx(s) {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m - (9 * 60 + 30);
  }

  // مجموع متحرك يتطلب نافذة كاملة من القيم غير الفارغة (مثل pandas rolling(w).sum())
  function rollSum(a, w, minP = w) {
    const out = new Array(a.length).fill(NaN);
    for (let i = 0; i < a.length; i++) {
      let s = 0, k = 0;
      for (let j = Math.max(0, i - w + 1); j <= i; j++) if (isNum(a[j])) { s += a[j]; k++; }
      if (k >= minP) out[i] = s;
    }
    return out;
  }
  function rollMean(a, w, minP = w) {
    const out = new Array(a.length).fill(NaN);
    for (let i = 0; i < a.length; i++) {
      let s = 0, k = 0;
      for (let j = Math.max(0, i - w + 1); j <= i; j++) if (isNum(a[j])) { s += a[j]; k++; }
      if (k >= minP) out[i] = s / k;
    }
    return out;
  }
  function rollExt(a, w, fn) {
    const out = new Array(a.length).fill(NaN);
    for (let i = w - 1; i < a.length; i++) {
      let m = null, ok = true;
      for (let j = i - w + 1; j <= i; j++) { if (!isNum(a[j])) { ok = false; break; } m = m === null ? a[j] : fn(m, a[j]); }
      if (ok) out[i] = m;
    }
    return out;
  }
  const shift = (a, k) => a.map((_, i) => (i - k >= 0 && i - k < a.length ? a[i - k] : NaN));
  const div = (x, y) => (isNum(x) && isNum(y) && y !== 0 ? x / y : NaN);

  function defaultCurve() {
    const w = [];
    for (let i = 0; i < N_MIN; i++) {
      const x = i / (N_MIN - 1);
      w.push(1 + 3 * Math.exp(-x / 0.05) + 1.5 * Math.exp(-(1 - x) / 0.04));
    }
    const s = w.reduce((a, b) => a + b, 0);
    return w.map((x) => x / s);
  }

  function computeFeatures(g, ctx, curve, window = 3, atrLen = 14) {
    const n = g.c.length;
    const dv = g.vw.map((p, i) => p * g.v[i]);
    const volW = rollSum(g.v, window);
    const dvolW = rollSum(dv, window);
    const f = {
      close: g.c.slice(),
      ret_w: g.c.map((c, i) => div(c, shift(g.c, window)[i]) - 1),
      vol_w: volW,
      dvol_w: dvolW,
      trades_w: rollSum(g.n, window),
    };
    const vmax = rollExt(g.v, window, Math.max);
    f.conc_w = vmax.map((m, i) => div(m, volW[i]));
    f.vwap_w = dvolW.map((d, i) => div(d, volW[i]));
    f.above_vwap = g.c.map((c, i) => isNum(f.vwap_w[i]) && c > f.vwap_w[i]);
    f.window_low = rollExt(g.l, window, Math.min);

    const adv = isNum(ctx.adv20) ? ctx.adv20 : NaN;
    const flatRef = adv > 0 ? (adv / N_MIN) * window : NaN;
    const prior = rollMean(shift(g.v, window), 30, 10).map((x) => x * window);
    f.vol_ref_intraday = prior.map((x) => (isNum(x) ? x : flatRef));
    const cw = rollSum(curve, window);
    f.vol_ref_tod = cw.map((x) => (adv > 0 ? adv * x : NaN));
    f.vol_ratio_intraday = volW.map((v, i) => div(v, f.vol_ref_intraday[i]));
    f.vol_ratio_tod = volW.map((v, i) => div(v, f.vol_ref_tod[i]));
    const pc = isNum(ctx.prev_close) ? ctx.prev_close : NaN;
    f.day_chg = g.c.map((c) => (pc > 0 ? c / pc - 1 : NaN));

    const tr = g.c.map((_, i) => {
      const pcI = i > 0 && isNum(g.c[i - 1]) ? g.c[i - 1] : g.o[i];
      const vals = [g.h[i] - g.l[i], Math.abs(g.h[i] - pcI), Math.abs(g.l[i] - pcI)].filter(isNum);
      return vals.length ? Math.max(...vals) : NaN;
    });
    f.atr = rollMean(tr, atrLen, 5);
    f.traded = g.traded.slice();
    return f;
  }

  /** فحص الإشارة عند الدقيقة i مع تفصيل كل شرط (لعرض "سبب الظهور" في الواجهة). */
  function evaluate(f, i, sig, ctx, session, opts = {}) {
    const ratio = sig.vol_ref === "tod" ? f.vol_ratio_tod[i] : f.vol_ratio_intraday[i];
    const ge = (x, t) => isNum(x) && x >= t;
    const checks = {
      ret: ge(f.ret_w[i], sig.min_ret),
      volume: ge(ratio, sig.min_vol_ratio),
      dollar_volume: ge(f.dvol_w[i], sig.min_dollar_vol),
      trades: ge(f.trades_w[i], sig.min_trades),
      concentration: isNum(f.conc_w[i]) && f.conc_w[i] <= sig.max_concentration,
      traded: !!f.traded[i],
    };
    if (sig.require_above_vwap !== false) checks.above_vwap = !!f.above_vwap[i];
    const extended = (isNum(f.day_chg[i]) && f.day_chg[i] > sig.extended_day) ||
                     (isNum(f.ret_w[i]) && f.ret_w[i] > sig.extended_window);
    if (sig.exclude_extended) checks.not_extended = !extended;
    if (sig.min_price) checks.min_price = isNum(f.close[i]) && f.close[i] >= sig.min_price;
    if (sig.max_price) checks.max_price = isNum(f.close[i]) && f.close[i] <= sig.max_price;
    if (sig.max_half_spread_bps !== null && sig.max_half_spread_bps !== undefined) {
      checks.spread = isNum(ctx.half_spread_bps) && ctx.half_spread_bps <= sig.max_half_spread_bps;
    }
    const first = hhmmToIdx(session.first_signal) - 1 + (sig.skip_first_min || 0);
    const last = hhmmToIdx(session.last_entry) - 1 - (sig.skip_last_min || 0);
    checks.session = i >= first && i <= last;
    if (sig.exclude_dilution_days && opts.dilutionTimes && opts.minuteEndMs !== undefined) {
      const win = sig.exclude_dilution_days * 86400000;
      checks.no_dilution = !opts.dilutionTimes.some((t) => opts.minuteEndMs >= t && opts.minuteEndMs <= t + win);
    }
    return { pass: Object.values(checks).every(Boolean), checks, extended, ratio };
  }

  /** مستويات الخطة المشروطة: نفس منطق المحاكاة (الوقف ثم الهدف بمضاعف R من سعر التنفيذ). */
  function planLevels(f, i, ex, entryPx, costFrac = 0) {
    let stop = ex.stop === "window_low" ? f.window_low[i] * 0.999 : entryPx - ex.stop_atr_mult * f.atr[i];
    const lo = entryPx * (1 - ex.max_stop_pct), hi = entryPx * (1 - ex.min_stop_pct);
    if (!isNum(stop)) stop = hi;
    stop = Math.min(Math.max(stop, lo), hi);
    const entry = entryPx * (1 + costFrac);
    return { entry, stop, target: entry + ex.target_r * (entryPx - stop), maxHoldMin: ex.max_hold_min };
  }

  return { N_MIN, hhmmToIdx, defaultCurve, computeFeatures, evaluate, planLevels };
});
