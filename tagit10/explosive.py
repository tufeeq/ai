"""Identical closed-5m feature contract for historical training and live shadow scoring.

Scores describe a research model, never trade permission or guaranteed probability.
"""
import json, math, statistics
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ET = ZoneInfo('America/New_York')
FEATURES = ['return5', 'return15', 'return30', 'volumeAcceleration15',
            'logDollarVolume15', 'range15', 'range30', 'compressionRatio',
            'vwapDistance', 'drawdownFromHigh', 'closePosition', 'moveFromOpen',
            'moveFromPreviousClose', 'gapPct', 'minutesFromOpen', 'upBarFraction',
            'upperWickFraction', 'logSameTimeRelativeVolume', 'priorDayReturn', 'priorDayRange']
SCHEMA = 'session-mover-v1'


def pct(a, b):
    return (a / b - 1) * 100


def slot(t):
    d = datetime.fromtimestamp(t, ET)
    return d.hour * 60 + d.minute


def reference(prior):
    if len(prior) < 5:
        return None
    byslot = {}
    for bars in prior[-10:]:
        total = 0
        for b in bars:
            total += b['v']
            byslot.setdefault(str(slot(b['t'])), []).append(total)
    p = prior[-1]
    return {'previousClose': p[-1]['c'], 'priorDayReturn': pct(p[-1]['c'], p[0]['o']),
            'priorDayRange': pct(max(b['h'] for b in p), min(b['l'] for b in p)),
            'cumulativeVolume': {k: statistics.median(v) for k, v in byslot.items() if len(v) >= 5}}


def vector(prefix, ref):
    if len(prefix) < 6 or not ref or slot(prefix[0]['t']) != 570:
        return None
    b = prefix[-6:]
    if any(y['t'] - x['t'] != 300 for x, y in zip(b, b[1:])):
        return None
    if any(not all(math.isfinite(x[k]) for k in 'ohlcv') or x['v'] < 0 or
           not (0 < x['l'] <= min(x['o'], x['c']) <= max(x['o'], x['c']) <= x['h']) for x in prefix):
        return None
    recent, before = b[-3:], b[:3]
    vol, priorvol = sum(x['v'] for x in recent), sum(x['v'] for x in before)
    total = sum(x['v'] for x in prefix)
    base = ref['cumulativeVolume'].get(str(slot(b[-1]['t'])))
    if min(vol, priorvol, total, base or 0) <= 0:
        return None
    p = b[-1]['c']
    r15 = pct(max(x['h'] for x in recent), min(x['l'] for x in recent))
    previousrange = pct(max(x['h'] for x in before), min(x['l'] for x in before))
    hi, lo = max(x['h'] for x in b), min(x['l'] for x in b)
    vwap = sum((x['h'] + x['l'] + x['c']) / 3 * x['v'] for x in prefix) / total
    last = b[-1]
    return [pct(p, last['o']), pct(p, recent[0]['o']), pct(p, b[0]['o']),
            min(vol / priorvol, 50), math.log1p(sum(x['c'] * x['v'] for x in recent)),
            r15, pct(hi, lo), min(r15 / max(previousrange, .01), 50),
            pct(p, vwap), pct(max(x['h'] for x in prefix), p),
            (p - lo) / max(hi - lo, .000001), pct(p, prefix[0]['o']),
            pct(p, ref['previousClose']), pct(prefix[0]['o'], ref['previousClose']),
            slot(last['t']) + 5 - 570, sum(x['c'] > x['o'] for x in b) / 6,
            (last['h'] - max(last['o'], p)) / max(last['h'] - last['l'], .000001),
            math.log1p(min(total / base, 100)), ref['priorDayReturn'], ref['priorDayRange']]


def eligible(x, price):
    return bool(x and .2 <= price <= 40 and -20 <= x[11] < 10 and x[12] < 20
                and 30 <= x[14] <= 330 and x[4] >= math.log1p(100000))


def label(future, decision, close_at, target=.20):
    """One complete 5m execution delay, next open; stop-first OHLC ambiguity.

    Gaps are unscorable unless a barrier was resolved before the missing interval.
    A high print is a simulated target touch, not evidence of an executable fill.
    """
    if not future or future[0]['t'] != decision + 300:
        return None
    entry = future[0]['o']
    if entry <= 0:
        return None
    low, high, previous = entry, entry, future[0]['t'] - 300
    for b in future:
        if b['t'] != previous + 300:
            return None
        previous = b['t']
        low, high = min(low, b['l']), max(high, b['h'])
        if b['l'] <= entry * .95:
            return {'y': 0, 'grossReturnPct': pct(min(b['o'], entry * .95), entry),
                    'reason': 'STOP_FIRST', 'leadMinutes': None, 'maePct': pct(low, entry)}
        if b['h'] >= entry * (1 + target):
            return {'y': 1, 'grossReturnPct': target * 100, 'reason': 'TARGET_FIRST',
                    'leadMinutes': (b['t'] - decision) / 60, 'maePct': pct(low, entry)}
    if future[-1]['t'] + 300 != close_at:
        return None
    return {'y': 0, 'grossReturnPct': pct(future[-1]['c'], entry), 'reason': 'SESSION_CLOSE',
            'leadMinutes': None, 'maePct': pct(low, entry)}


def predict(model, x):
    if model['kind'] == 'logistic':
        raw = model['intercept'] + sum((v - m) / s * w for v, m, s, w in
                                      zip(x, model['mean'], model['scale'], model['weights']))
    else:
        raw = model['intercept']
        for tree in model['trees']:
            i = 0
            while not tree[i]['leaf']:
                n = tree[i]
                i = n['left'] if x[n['feature']] <= n['threshold'] else n['right']
            raw += tree[i]['value']
    return 1 / (1 + math.exp(-max(-40, min(40, raw))))


def patterns(x):
    found = []
    if x[3] >= 2 and x[1] > 0:
        found.append('VOLUME_IGNITION')
    if x[7] <= .75 and x[8] > 0 and x[3] >= 1.5:
        found.append('COMPRESSION_WITH_FLOW')
    if x[8] > 0 and x[9] <= 1 and x[10] >= .8:
        found.append('HIGH_RETENTION_ABOVE_VWAP')
    if x[17] >= math.log1p(2) and x[1] > 0:
        found.append('UNUSUAL_SAME_TIME_VOLUME')
    if x[16] >= .5 and x[0] <= 0:
        found.append('REJECTED_BREAKOUT')
    return found or ['NO_NAMED_PATTERN']


def aggregate_minutes(points):
    groups = {}
    for p in points:
        if len(p) < 6 or p[2] is None or p[0] % 60:
            continue
        groups.setdefault(int(p[0] // 300 * 300), {})[p[0]] = p
    out = []
    for t, group in sorted(groups.items()):
        if sorted(group) != list(range(t, t + 300, 60)):
            continue
        p = [group[k] for k in sorted(group)]
        out.append({'t': t, 'o': p[0][3], 'h': max(x[4] for x in p),
                    'l': min(x[5] for x in p), 'c': p[-1][1], 'v': sum(x[2] for x in p)})
    return out


def shadow(symbol, points, session, bundle, references, at):
    base = {'status': 'UNAVAILABLE', 'tradeEligible': False, 'schema': SCHEMA}
    if not bundle or bundle.get('schema') != SCHEMA:
        return {**base, 'reason': 'MODEL_UNAVAILABLE'}
    if session != 'regular':
        return {**base, 'reason': 'REGULAR_SESSION_MODEL'}
    ref = references.get('symbols', {}).get(symbol)
    if not ref:
        return {**base, 'reason': 'NO_PRIOR_SESSION_BASELINE'}
    today = datetime.fromtimestamp(at, ET).date().isoformat()
    if ref.get('asOfDate', today) >= today or (datetime.fromisoformat(today) - datetime.fromisoformat(ref['asOfDate'])).days > 7:
        return {**base, 'reason': 'BASELINE_DATE_INVALID'}
    if bundle.get('trainingCutoff', today) >= today:
        return {**base, 'reason': 'MODEL_DATE_INVALID'}
    p = [b for b in aggregate_minutes(points) if datetime.fromtimestamp(b['t'], ET).date().isoformat() == today and 570 <= slot(b['t']) < 960]
    # The training contract observes at 15-minute checkpoints, using closed bars.
    ends = [i for i, b in enumerate(p) if (b['t'] + 300) % 900 == 0]
    if not ends:
        return {**base, 'reason': 'WAITING_FOR_CLOSED_CHECKPOINT'}
    p = p[:ends[-1] + 1]
    decision = p[-1]['t'] + 300
    if not 0 <= at - decision <= 900:
        return {**base, 'reason': 'STALE_PATTERN_CHECKPOINT'}
    x = vector(p, ref)
    if not eligible(x, p[-1]['c']):
        return {**base, 'reason': 'OUTSIDE_EARLY_MODEL_DOMAIN'}
    score = predict(bundle['model'], x)
    return {'status': 'SHADOW', 'schema': SCHEMA, 'modelId': bundle['id'],
            'score': round(score * 100, 3), 'aboveResearchThreshold': score >= bundle['threshold'],
            'decisionAtUTC': datetime.fromtimestamp(decision, ET).isoformat(),
            'patterns': patterns(x), 'tradeEligible': False,
            'validationStatus': bundle.get('validationStatus', 'UNPROVEN'),
            'meaning': 'Research model output; not a calibrated probability or an entry recommendation'}


def load_assets():
    root = Path(__file__).resolve().parent / 'reports'
    try:
        return json.loads((root / 'explosive-model.json').read_text()), json.loads((root / 'explosive-reference.json').read_text())
    except (OSError, ValueError):
        return None, {}
