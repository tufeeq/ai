"""Direction and data availability, independent of the legacy activity score."""
from datetime import datetime
from math import isfinite

RELEASE = '10.6.0'

def timestamp(value):
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
    except (ValueError, TypeError, AttributeError):
        return None

def close_age(row, at):
    # Keep the existing 120s limit from bar START: 60s from its CLOSE.
    # This corrects the displayed clock without relaxing eligibility.
    start = timestamp(row.get('quoteTimestampUTC'))
    close = timestamp(row.get('barCloseTimestampUTC'))
    if start is None or (close is not None and abs(close-start-60) > .001):
        return None
    return at - (close if close is not None else start+60)

def state_of(row):
    blocks = set(row.get('riskBlocks', []))
    if not row.get('quoteFresh') or blocks & {'INCOMPLETE_WINDOWS', 'UNVERIFIED_SESSION', 'UNSUPPORTED_INSTRUMENT'}:
        return 'UNAVAILABLE'
    if 'FALLING_PRICE' in blocks:
        return 'INVALIDATED'
    if 'EXTENDED_MOVE' in blocks:
        return 'EXTENDED'
    if blocks:
        return 'WATCH'
    return 'DEVELOPING' if row.get('stage') == 'WATCH' else 'OBSERVED'

def order_key(row):
    state = state_of(row)
    states = {'OBSERVED':5, 'DEVELOPING':4, 'WATCH':3, 'EXTENDED':2, 'INVALIDATED':1, 'UNAVAILABLE':0}
    rank = {'CONFIRMED':3, 'ACTIONABLE':2, 'EARLY':1}
    def number(k):
        v = row.get(k)
        return v if isinstance(v, (int, float)) and isfinite(v) else -1e9
    # Actual direction sorts the watchlist. Activity is no longer an upside rank.
    return (states[state], rank.get(row.get('stage'), 0), number('ret5mPct'), number('ret15mPct'), number('dollarVolume5m'))

def coverage_health(state, rows, universe, directory, at):
    ages = sorted(max(0, x) for row in rows if (x := close_age(row, at)) is not None and x >= -30)
    def percentile(p):
        return round(ages[min(len(ages)-1, int((len(ages)-1)*p))], 1) if ages else None
    names = set(directory)
    records = [v for s,v in state.get('symbols', {}).items() if s in names]
    # Prior releases recorded successful attempts as lastSeenUTC. Preserve that
    # evidence across rollout; absent metadata means unknown, never "not scanned".
    attempted = [timestamp(x.get('lastAttemptUTC') or x.get('lastSeenUTC')) for x in records]
    successful = [timestamp(x.get('lastSuccessfulScanUTC') or x.get('lastSeenUTC')) for x in records]
    observed = [timestamp(x.get('lastQuoteTimestampUTC')) for x in records]
    return {'scope':'CURRENT_DIRECTORY', 'directorySize':len(names),
        'attemptedThisScan':len(universe), 'validThisScan':len(rows),
        'unavailableThisScan':len(universe)-len(rows),
        'attemptedLast5m':sum(t is not None and 0<=at-t<=300 for t in attempted),
        'successfulLast5m':sum(t is not None and 0<=at-t<=300 for t in successful),
        'freshAcrossDirectory':sum(t is not None and 0<=at-t<=120 for t in observed),
        'noRecordedAttemptToday':len(names)-sum(t is not None for t in attempted),
        'barCloseAgeMedianSeconds':percentile(.5), 'barCloseAgeP95Seconds':percentile(.95),
        'freshnessRule':'Closed 1m bar; at most 60 seconds after close, unchanged from 120 seconds after start',
        'streaming':False, 'bidAskAvailable':False}
