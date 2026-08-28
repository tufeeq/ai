'use strict';

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TAGX2Engine = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function clamp(v, a, b) {
    a = a == null ? 0 : a;
    b = b == null ? 100 : b;
    return Math.max(a, Math.min(b, v));
  }

  function num(v) {
    var x = Number(v);
    return Number.isFinite(x) ? x : null;
  }

  function ageMin(t) {
    if (!t) return Infinity;
    var ms = Date.now() - new Date(t).getTime();
    return Number.isFinite(ms) ? ms / 60000 : Infinity;
  }

  function stageOf(c) {
    c = c || {};
    var ch = num(c.changePct);
    var r5 = num(c.priceVelocity5mPct);
    var r15 = num(c.priceVelocity15mPct);
    if (ch == null) return 'DISCOVERY';
    if (ch >= 10 && ((r5 != null && r5 <= 0) || (r15 != null && r15 <= 0))) return 'EXHAUSTION';
    if (ch >= 12) return 'LATE';
    if (ch < 1) return 'DISCOVERY';
    if (ch < 3) return 'WAKE_UP';
    if (ch < 7) return 'PRE_IGNITION';
    return 'IGNITION';
  }

  function scoreCandidate(c, ctx) {
    c = c || {};
    ctx = ctx || {};
    var ch = num(c.changePct);
    var v5 = num(c.priceVelocity5mPct) || 0;
    var v15 = num(c.priceVelocity15mPct) || 0;
    var va = num(c.volumeAcceleration5m);
    var to = num(c.turnover5mPctFloat);
    var ers = num(c.earlyRegimeShiftScore) || 0;
    var ign = num(c.ignitionScore) || 0;
    var session = String(ctx.session || c.session || 'unknown');
    var stage = stageOf(c);
    var trace = [];
    var dataAge = num(ctx.liveAgeMin);
    var dataHigh = String(ctx.dataConfidence || '').toUpperCase() === 'HIGH';
    var baselineOk = c.baselineIntegrity === 'VERIFIED_POINT_IN_TIME' || c.baselineIntegrity === 'VERIFIED';
    var liquidityProof = c.extendedLiquidityVerified === true || (va != null && va >= 2) || (to != null && to >= 0.20);
    var coverageOnly = !!c.coverageOnly;

    var dataScore = 0;
    if (dataHigh) dataScore += 35;
    if (dataAge != null && dataAge <= 6) dataScore += 35;
    else if (dataAge != null && dataAge <= 10) dataScore += 15;
    if (baselineOk) dataScore += 30;
    dataScore = clamp(dataScore);

    var momentum = clamp(Math.max(0, v5) * 22 + Math.max(0, v15) * 10);
    var acceleration = clamp(Math.max(0, v5 - v15 / 3) * 32);
    var liquidity = clamp(Math.max(va != null ? va * 15 : 0, to != null ? to * 90 : 0));
    var regime = clamp((ers + ign) / 2);
    var earlyFit = 0;
    if (ch != null && ch >= 1 && ch <= 9.5) earlyFit = 100;
    else if (ch != null && ch > 9.5 && ch < 12) earlyFit = 35;
    else if (ch != null && ch >= 0 && ch < 1) earlyFit = 45;
    var extended = ['pre-market', 'premarket', 'after-hours'].indexOf(session) >= 0;
    var persistence = clamp((v5 > 0 ? 30 : 0) + (v15 > 0 ? 25 : 0) + (liquidityProof ? 25 : 0) + (extended ? 20 : 10));

    var score = 0.16 * dataScore + 0.18 * momentum + 0.12 * acceleration + 0.17 * liquidity + 0.16 * regime + 0.12 * earlyFit + 0.09 * persistence;
    var risk = 28;
    if (!dataHigh) risk += 28;
    if (dataAge == null || dataAge > 6) risk += 22;
    if (!baselineOk) risk += 18;
    if (!liquidityProof) risk += 16;
    if (coverageOnly) risk += 22;
    if (ch != null && ch >= 9.5) risk += 18;
    if (ch != null && ch >= 12) risk += 30;
    if (v5 <= 0) risk += 18;
    if (v15 <= 0) risk += 12;
    if (session === 'after-hours') risk += 8;
    risk = clamp(risk);

    trace.push([dataHigh ? '+' : '-', dataHigh ? 'High-confidence feed' : 'Feed confidence not HIGH']);
    trace.push([dataAge != null && dataAge <= 6 ? '+' : '-', dataAge != null && dataAge <= 6 ? 'Feed fresh <=6m' : 'Feed older than execution window']);
    trace.push([baselineOk ? '+' : '-', baselineOk ? 'Point-in-time baseline verified' : 'Baseline not independently verified']);
    trace.push([v5 > 0.4 && v15 > 0.2 ? '+' : '-', v5 > 0.4 && v15 > 0.2 ? '5m/15m continuation positive' : 'Continuation not proven']);
    trace.push([liquidityProof ? '+' : '-', liquidityProof ? 'Independent liquidity/float evidence' : 'No independent liquidity proof']);
    trace.push([ch != null && ch >= 1 && ch <= 9.5 ? '+' : '-', ch != null && ch >= 1 && ch <= 9.5 ? 'Still inside early displacement window' : 'Outside preferred early window']);
    if (coverageOnly) trace.push(['-', 'Discovery-only source: never execution by itself']);

    var sharia = String(ctx.shariaStatus || 'UNVERIFIED').toUpperCase();
    var dataGate = dataHigh && dataAge != null && dataAge <= 6 && baselineOk;
    var continuation = v5 >= 0.45 && v15 >= 0.20;
    var early = ch != null && ch >= 1.5 && ch <= 9.5;
    var crossValidated = liquidityProof && regime >= 70 && continuation;
    var researchPass = dataGate && early && crossValidated && !coverageOnly && score >= 70 && risk <= 58 && stage !== 'LATE' && stage !== 'EXHAUSTION';
    var action = 'IGNORE';
    if (stage === 'LATE' || stage === 'EXHAUSTION') action = 'LATE';
    else if (!dataGate) action = 'BLOCKED_DATA';
    else if (researchPass && sharia === 'VERIFIED') action = 'READY_RESEARCH';
    else if (researchPass && sharia === 'UNVERIFIED') action = 'WATCH_SHARIA';
    else if (sharia === 'EXCLUDED') action = 'EXCLUDED';
    else if (stage === 'PRE_IGNITION' || stage === 'IGNITION' || stage === 'WAKE_UP') action = 'PROVE';
    else action = 'WATCH';

    var invalidation = [];
    if (v5 <= 0) invalidation.push('5m velocity <= 0');
    if (v15 <= 0) invalidation.push('15m velocity <= 0');
    if (ch != null && ch >= 10) invalidation.push('displacement >= 10%');
    if (!liquidityProof) invalidation.push('liquidity confirmation lost');
    if (dataAge == null || dataAge > 6) invalidation.push('feed stale');
    if (!invalidation.length) invalidation.push('5m/15m continuation breaks');

    return {
      ticker: String(c.ticker || '').toUpperCase(), stage: stage,
      score: Math.round(clamp(score)), risk: Math.round(risk), action: action,
      researchPass: researchPass, sharia: sharia, trace: trace, invalidation: invalidation,
      components: {
        dataScore: Math.round(dataScore), momentum: Math.round(momentum), acceleration: Math.round(acceleration),
        liquidity: Math.round(liquidity), regime: Math.round(regime), earlyFit: Math.round(earlyFit), persistence: Math.round(persistence)
      }
    };
  }

  function mergeSources(live, rescue, sentinel) {
    live = live || {}; rescue = rescue || {}; sentinel = sentinel || {};
    var map = new Map();
    var fields = ['price','changePct','priceVelocity5mPct','priceVelocity15mPct','volumeAcceleration5m','turnover5mPctFloat','earlyRegimeShiftScore','ignitionScore','baselineIntegrity','extendedLiquidityVerified'];
    function absorb(e, source, discoveryOnly) {
      var t = String((e && e.ticker) || '').toUpperCase();
      if (!t) return;
      if (!map.has(t)) {
        var copy = Object.assign({}, e, {ticker:t, sources:[source], coverageOnly:!!discoveryOnly});
        map.set(t, copy);
        return;
      }
      var x = map.get(t);
      if (x.sources.indexOf(source) < 0) x.sources.push(source);
      fields.forEach(function (k) { if (x[k] == null && e[k] != null) x[k] = e[k]; });
      if (source === 'live') x.coverageOnly = false;
    }
    (live.emergingCandidates || []).forEach(function (e) { absorb(e, 'live', false); });
    (sentinel.candidates || []).forEach(function (e) { absorb(e, 'sentinel', true); });
    (rescue.topMovers || []).forEach(function (e) { absorb(e, 'coverage', true); });
    return Array.from(map.values());
  }

  function weeklyLessons(history) {
    history = history || {};
    var rows = (history.sessions || []).map(function (s) {
      var c = s.counts || {};
      var early = c.earlyCohort || 0, w = c.earlyWinners50 || 0, f = c.earlyFailuresUnder10 || 0;
      return {date:s.sessionDateET, early:early, winners50:w, failures:f, winner50Rate:early ? 100*w/early : 0, failureRate:early ? 100*f/early : 0, promotionEligible:!!s.promotionEligible};
    });
    var early = rows.reduce(function(a,b){return a+b.early;},0);
    var wins = rows.reduce(function(a,b){return a+b.winners50;},0);
    var fail = rows.reduce(function(a,b){return a+b.failures;},0);
    return {rows:rows,total:{early:early,wins:wins,fail:fail,winner50Rate:early?100*wins/early:0,failureRate:early?100*fail/early:0}};
  }

  return {num:num, ageMin:ageMin, stageOf:stageOf, scoreCandidate:scoreCandidate, mergeSources:mergeSources, weeklyLessons:weeklyLessons};
}));
