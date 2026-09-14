"""Train early +20% session discovery; describe +50% events; never auto-promote.

Date blocks, fixed model family, one first alert per ticker/day, five daily alerts.
Known historical dates have been examined by prior TAGit experiments: retrospective
holdout evidence is not advertised as a fresh prospective accuracy measurement.
"""
import gzip, hashlib, importlib.util, json, math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score
from sklearn.preprocessing import StandardScaler
from explosive import ET, FEATURES, SCHEMA, vector, reference, eligible, label, patterns, pct, slot, predict

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'history/explosive'
OUT = ROOT / 'reports'
spec = importlib.util.spec_from_file_location('calendar_guard', ROOT.parent / 'tagit/market-calendar-guard.py')
calendar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(calendar)


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, allow_nan=False) + '\n')


def examples():
    rows, events, references, exclusions = [], [], {}, Counter()
    for path in sorted(DATA.glob('bars-*.jsonl.gz')):
        with gzip.open(path, 'rt') as f:
            for line in f:
                item = json.loads(line)
                sym = item['symbol']
                byday = defaultdict(list)
                for b in item['bars']:
                    dt = datetime.fromtimestamp(b['t'], ET)
                    if 570 <= dt.hour * 60 + dt.minute < 960:
                        byday[dt.date().isoformat()].append(b)
                splitdays = {datetime.fromtimestamp(v['date'], ET).date().isoformat() for v in item.get('splitEvents', {}).values()}
                prior = []
                for day, bars in sorted(byday.items()):
                    bars = sorted(bars, key=lambda b: b['t'])
                    info = calendar.calendar_info(datetime.fromisoformat(day + 'T12:00:00').replace(tzinfo=ET))
                    if not info['verifiedYear'] or not info['regularCloseET'] or info['session'] == 'closed':
                        exclusions['invalidCalendarDays'] += 1
                        continue
                    close_at = int(datetime.fromisoformat(day + 'T' + info['regularCloseET']).replace(tzinfo=ET).timestamp())
                    bars = [b for b in bars if b['t'] < close_at]
                    if day in splitdays:
                        exclusions['splitDays'] += 1
                        prior = []
                        continue
                    if not bars or slot(bars[0]['t']) != 570 or bars[-1]['t'] + 300 != close_at:
                        exclusions['incompleteSessionEdges'] += 1
                        continue
                    peak = max(bars, key=lambda b: b['h'])
                    move = pct(peak['h'], bars[0]['o'])
                    event = {'symbol': sym, 'date': day, 'open': bars[0]['o'], 'high': peak['h'],
                             'openToHighPct': round(move, 3), 'closeReturnPct': round(pct(bars[-1]['c'], bars[0]['o']), 3),
                             'peakAtET': datetime.fromtimestamp(peak['t'], ET).isoformat(),
                             'observedBars': len(bars), 'expectedBars': (close_at - bars[0]['t']) // 300,
                             'volume': sum(b['v'] for b in bars), 'eligibleCheckpoints': 0}
                    events.append(event)
                    ref = reference(prior)
                    if ref:
                        for i in range(5, len(bars) - 2):
                            b = bars[i]
                            decision = b['t'] + 300
                            if decision % 900 or close_at - decision < 3600:
                                continue
                            x = vector(bars[:i + 1], ref)
                            if not eligible(x, b['c']):
                                continue
                            event['eligibleCheckpoints'] += 1
                            # Execution starts one full 5m bar AFTER the decision.
                            future = [v for v in bars[i + 1:] if v['t'] >= decision + 300]
                            y = label(future, decision, close_at)
                            y50 = label(future, decision, close_at, .50)
                            if y is None:
                                exclusions['unscorableCheckpointGaps'] += 1
                                continue
                            rows.append({'symbol': sym, 'date': day, 'decisionAt': decision,
                                         'x': x, **y, 'y50': y50['y'] if y50 else None,
                                         'dayMovePct': move})
                    else:
                        exclusions['priorBaselineWarmupDays'] += 1
                    prior.append(bars)
                    prior = prior[-10:]
                    ref = reference(prior)
                    if ref:
                        references[sym] = {**ref, 'asOfDate': day}
    return rows, events, references, dict(exclusions)


def alerts(rows, scores, threshold, cap=5):
    # Temporal replay: no sorting by the eventual day's best score or winner.
    order = sorted(range(len(rows)), key=lambda i: (rows[i]['date'], rows[i]['decisionAt'], -float(scores[i]), rows[i]['symbol']))
    seen, daily, chosen = set(), Counter(), []
    for i in order:
        r = rows[i]
        key = (r['date'], r['symbol'])
        if scores[i] < threshold or key in seen or daily[r['date']] >= cap:
            continue
        seen.add(key)
        daily[r['date']] += 1
        chosen.append({**r, 'modelScore': float(scores[i])})
    return chosen


def summarize(chosen, all_dates, events=None):
    n = len(chosen)
    tp = sum(r['y'] for r in chosen)
    days = defaultdict(list)
    for r in chosen:
        days[r['date']].append(r['grossReturnPct'] - .4)
    precision = tp / n if n else 0
    z = 1.96
    lower = ((precision + z*z/(2*n) - z*math.sqrt(precision*(1-precision)/n+z*z/(4*n*n))) / (1+z*z/n)) if n else None
    daily = [float(np.mean(days[d])) if days[d] else 0 for d in all_dates]
    if len(daily) >= 3:
        rng = np.random.default_rng(10320)
        lower_return = float(np.quantile(np.mean(rng.choice(daily, (1000, len(daily))), axis=1), .05))
    else:
        lower_return = None
    leads = [r['leadMinutes'] for r in chosen if r['y']]
    known50 = [r for r in chosen if r['y50'] is not None]
    s = {'alerts': n, 'target20Hits': tp, 'falseAlerts': n - tp,
         'precision20Pct': round(100 * precision, 3) if n else None,
         'precision95LowerPct': round(100 * lower, 3) if lower is not None else None,
         'target50Hits': sum(r['y50'] for r in known50), 'scorable50Alerts': len(known50),
         'meanNetReturnPct': round(float(np.mean([r['grossReturnPct'] - .4 for r in chosen])), 4) if n else None,
         'meanNetReturnStressPct': round(float(np.mean([r['grossReturnPct'] - 1 for r in chosen])), 4) if n else None,
         'medianNetReturnPct': round(float(np.median([r['grossReturnPct'] - .4 for r in chosen])), 4) if n else None,
         'worstMaePct': round(min(r['maePct'] for r in chosen), 4) if n else None,
         'medianLeadMinutes': float(np.median(leads)) if leads else None,
         'activeSessions': len(days), 'evaluationSessions': len(all_dates),
         'positiveSessions': sum(np.mean(v) > 0 for v in days.values()),
         'dailyMean95LowerPct': round(lower_return, 4) if lower_return is not None else None,
         'outcomes': dict(Counter(r['reason'] for r in chosen))}
    if events is not None:
        movers = {(r['symbol'], r['date']) for r in events if r['date'] in all_dates and r['openToHighPct'] >= 20}
        caught = {(r['symbol'], r['date']) for r in chosen if r['y']} & movers
        s.update(observed20MoverDays=len(movers), caught20MoverDays=len(caught),
                 moverRecallPct=round(100 * len(caught) / len(movers), 3) if movers else None)
    return s


def portable(fit, scaler=None):
    if scaler is not None:
        return {'kind': 'logistic', 'intercept': float(fit.intercept_[0]),
                'weights': fit.coef_[0].tolist(), 'mean': scaler.mean_.tolist(), 'scale': scaler.scale_.tolist()}
    trees = []
    for stage in fit._predictors:
        nodes = stage[0].nodes
        trees.append([{'leaf': bool(n['is_leaf']), 'value': float(n['value']),
                       'feature': int(n['feature_idx']), 'threshold': float(n['num_threshold']),
                       'left': int(n['left']), 'right': int(n['right'])} for n in nodes])
    return {'kind': 'histogram_gradient_boosting', 'intercept': float(fit._baseline_prediction[0, 0]), 'trees': trees}


def fit_candidate(train, cal, dates):
    x = np.asarray([r['x'] for r in train], dtype=np.float32)
    y = np.asarray([r['y'] for r in train])
    cx = np.asarray([r['x'] for r in cal], dtype=np.float32)
    count = Counter((r['symbol'], r['date']) for r in train)
    w = np.array([1/count[(r['symbol'], r['date'])] for r in train])
    w *= len(w) / w.sum()
    scaler = StandardScaler().fit(x)
    candidates = [
        ('logistic', LogisticRegression(C=.1, max_iter=300, random_state=10320), scaler),
        ('nonlinear', HistGradientBoostingClassifier(max_iter=90, max_leaf_nodes=15, max_depth=4,
                    min_samples_leaf=80, l2_regularization=10, learning_rate=.06,
                    early_stopping=False, random_state=10320), None)]
    trials, comparisons = [], []
    for name, fit, scale in candidates:
        fit.fit(scale.transform(x) if scale else x, y, sample_weight=w)
        p = fit.predict_proba(scale.transform(cx) if scale else cx)[:, 1]
        model = portable(fit, scale)
        # The JSON inference used by the live scanner must match sklearn.
        idx = np.linspace(0, len(cal)-1, min(len(cal), 100), dtype=int)
        error = max(abs(p[i] - predict(model, cx[i].tolist())) for i in idx)
        if error > 1e-6:
            raise RuntimeError('Portable inference mismatch')
        ap = float(average_precision_score([r['y'] for r in cal], p))
        for threshold in [.005, .01, .02, .03, .05, .075, .1, .15, .25, .4, .6]:
            selected = alerts(cal, p, threshold)
            m = summarize(selected, dates)
            comparisons.append({'model': name, 'threshold': threshold, **m})
            if m['alerts'] >= 15 and m['activeSessions'] >= 3:
                trials.append((m['dailyMean95LowerPct'], m['precision20Pct'], ap, model, threshold, m, name))
        print(json.dumps({'fit': name, 'calibrationAveragePrecision': ap, 'portableMaxError': error}), flush=True)
    if not trials:
        raise RuntimeError('No supported calibration policy; refusing unsupported fitted model')
    best = max(trials, key=lambda v: (v[0], v[1], v[2]))
    return best[3], best[4], best[5], best[6], comparisons


def main():
    OUT.mkdir(exist_ok=True)
    rows, events, references, exclusions = examples()
    dates = sorted({r['date'] for r in rows})
    print(json.dumps({'examples': len(rows), 'dates': len(dates), 'positive20': sum(r['y'] for r in rows), 'exclusions': exclusions}), flush=True)
    if len(dates) < 25 or sum(r['y'] for r in rows) < 50:
        raise RuntimeError('Insufficient complete history for chronological fitting')
    modelpath = OUT / 'explosive-model.json'
    existing = json.loads(modelpath.read_text()) if modelpath.exists() else None
    if existing and existing.get('schema') == SCHEMA:
        future_dates = [d for d in dates if d > existing['trainingCutoff']]
        if len(future_dates) < 10:
            frozen = datetime.fromisoformat(existing['frozenAtUTC']).timestamp()
            future = [r for r in rows if r['date'] in future_dates and r['decisionAt'] > frozen]
            selected = alerts(future, [predict(existing['model'], r['x']) for r in future], existing['threshold'])
            report = json.loads((OUT / 'explosive-learning.json').read_text())
            report['refreshedAtUTC'] = datetime.now(timezone.utc).isoformat()
            report['prospectiveMarketReplay'] = summarize(selected, future_dates, events)
            report['prospectiveMarketReplay']['note'] = 'Frozen-model replay of later market data, not recorded live alerts or broker fills'
            report['latestCompleteDataDate'] = dates[-1]
            save(OUT / 'explosive-learning.json', report)
            save(OUT / 'explosive-reference.json', {'symbols': references})
            print(json.dumps({'status': 'FROZEN_MODEL_RETAINED', 'laterSessions': len(future_dates)}), flush=True)
            return
    i, j = int(len(dates) * .6), int(len(dates) * .8)
    # One whole date embargo between each partition.
    train_dates, cal_dates, test_dates = dates[:i], dates[i+1:j], dates[j+1:]
    parts = [[r for r in rows if r['date'] in ds] for ds in [train_dates, cal_dates, test_dates]]
    train, cal, test = parts
    if any(len({r['y'] for r in part}) < 2 for part in parts):
        raise RuntimeError('Both positive and failed setups required in every split')
    model, threshold, calibration, name, trials = fit_candidate(train, cal, cal_dates)
    p = [predict(model, r['x']) for r in test]
    selected = alerts(test, p, threshold)
    holdout = summarize(selected, test_dates, events)
    baselines = {}
    for name0, scores, th in [
        ('volume_plus_momentum', [r['x'][3] if r['x'][1] > 0 and r['x'][8] > 0 else 0 for r in test], 2),
        ('momentum_only', [r['x'][1] for r in test], 1)]:
        baselines[name0] = summarize(alerts(test, scores, th), test_dates, events)
    supported = (holdout['alerts'] >= 30 and holdout['activeSessions'] >= 5 and
                 (holdout['dailyMean95LowerPct'] or -999) > 0 and
                 (holdout['meanNetReturnStressPct'] or -999) > 0 and
                 all((holdout['meanNetReturnPct'] or -999) > (v['meanNetReturnPct'] or -999) for v in baselines.values()))
    now = datetime.now(timezone.utc).isoformat()
    bundle = {'schema': SCHEMA, 'model': model, 'threshold': threshold, 'features': FEATURES,
              'frozenAtUTC': now, 'trainingCutoff': dates[-1], 'fitThroughDate': train_dates[-1],
              'validationStatus': 'RETROSPECTIVE_SUPPORT_ONLY' if supported else 'NOT_SUPPORTED_FOR_TRADING',
              'tradeEligible': False, 'promoted': False,
              'notes': 'Frozen for 10 later complete sessions; historical date reuse and cohort bias remain'}
    bundle['id'] = hashlib.sha256(json.dumps(bundle, sort_keys=True).encode()).hexdigest()[:16]
    groups = defaultdict(list)
    seen = set()
    for r in sorted(train, key=lambda r: (r['date'], r['decisionAt'], r['symbol'])):
        for pat in patterns(r['x']):
            key = (pat, r['date'], r['symbol'])
            if key not in seen:
                seen.add(key)
                groups[pat].append(r)
    pattern_stats = [{'pattern': pat, **summarize(rs, train_dates)} for pat, rs in groups.items() if len(rs) >= 30]
    pattern_stats.sort(key=lambda r: r['precision20Pct'] or 0, reverse=True)
    # Winner cases are descriptive and never fed back into feature/threshold selection.
    cases = []
    index = defaultdict(list)
    for r in rows:
        index[(r['symbol'], r['date'])].append(r)
    for e in sorted(events, key=lambda r: r['openToHighPct'], reverse=True)[:50]:
        checkpoints = sorted(index.get((e['symbol'], e['date']), []), key=lambda r: r['decisionAt'])
        usable = next((r for r in checkpoints if r['y']), None)
        cases.append({**e, 'split': 'holdout' if e['date'] in test_dates else 'calibration' if e['date'] in cal_dates else 'development_or_warmup',
                      'earliestScorable20SetupAtET': datetime.fromtimestamp(usable['decisionAt'], ET).isoformat() if usable else None,
                      'earlyPatterns': patterns(usable['x']) if usable else [],
                      'reasonIfMissed': None if usable else 'No early liquid checkpoint with scorable +20% before -5%; may move during first 30m, gap already extended, or have missing/ halted bars'})
    report = {'schema': SCHEMA, 'generatedAtUTC': now, 'status': 'TRAINED_AND_CONNECTED_IN_SHADOW',
              'modelId': bundle['id'], 'validationStatus': bundle['validationStatus'], 'promoted': False,
              'collection': json.loads((DATA / 'manifest.json').read_text()),
              'examples': len(rows), 'positive20Examples': sum(r['y'] for r in rows),
              'sessions': len(dates), 'dateFrom': dates[0], 'dateTo': dates[-1],
              'symbolSessions': len(events), 'observed20MoverDays': sum(e['openToHighPct'] >= 20 for e in events),
              'observed50MoverDays': sum(e['openToHighPct'] >= 50 for e in events),
              'exclusions': exclusions, 'features': FEATURES,
              'splits': {'train': train_dates, 'calibration': cal_dates, 'holdout': test_dates, 'embargo': [dates[i], dates[j]]},
              'target': 'Remaining +20% before -5% within the same regular session; +50% secondary outcome',
              'decisionPolicy': 'Closed 5m bars; 15m checkpoints; first 30m warmup; price $0.20–40; <10% from open and <20% from previous close; $100k/15m; one full 5m execution delay; max five first-symbol alerts/day',
              'statisticalUnit': 'First qualifying alert per ticker/day, chronological daily cap of five',
              'costAssumptions': {'roundTripPct': .4, 'stressRoundTripPct': 1, 'stopPct': 5},
              'calibration': calibration, 'holdout': holdout, 'baselines': baselines,
              'holdoutByDay': {d: summarize([r for r in selected if r['date'] == d], [d], events) for d in test_dates},
              'trainingPatterns': pattern_stats, 'futureEvaluationRequired': True,
              'limitations': ['Retrospective chronological test; prior TAGit experiments have inspected overlapping historical dates',
                              'Current sampled common-equity survivors; historical delisted membership unavailable',
                              'Model covers regular sessions only; premarket and after-hours bars are archived but not fitted',
                              'Missing intervals are unscorable, not wins; split dates and incomplete edges excluded',
                              'First 30 minutes excluded; 15m decisions and 5m execution delay miss fast openings',
                              '5m highs do not establish executable fills; no bid/ask, order book, halt verification, historical news or float',
                              'Returns are simulated per alert with concurrent positions, not portfolio performance',
                              'The model remains a research signal; no automatic live promotion']}
    save(modelpath, bundle)
    save(OUT / 'explosive-reference.json', {'symbols': references})
    save(OUT / 'explosive-learning.json', report)
    save(OUT / 'explosive-cases.json', {'description': 'Largest observed open-to-high moves inside the downloaded sample; hindsight case studies, not a market-wide top list', 'cases': cases})
    save(OUT / 'explosive-audit.json', {'calibrationTrials': trials,
         'holdoutAlerts': [{k: v for k, v in r.items() if k != 'x'} for r in selected],
         'missedHoldoutMovers': [e for e in events if e['date'] in test_dates and e['openToHighPct'] >= 20 and
                                 (e['symbol'], e['date']) not in {(r['symbol'], r['date']) for r in selected if r['y']}]})
    save(DATA / ('frozen-' + bundle['id'] + '.json'), bundle)
    save(DATA / ('evaluation-' + bundle['id'] + '.json'), report)
    with gzip.open(DATA / 'examples.jsonl.gz', 'wt') as f:
        for r in rows:
            f.write(json.dumps(r, separators=(',', ':'), allow_nan=False) + '\n')
    print(json.dumps({'status': report['status'], 'validationStatus': report['validationStatus'],
                      'model': name, 'threshold': threshold, 'holdout': holdout, 'baselines': baselines}), flush=True)


if __name__ == '__main__':
    main()
