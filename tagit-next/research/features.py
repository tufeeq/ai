"""Causal research features; no detector imports, orders or fitted thresholds.

Final historical bars without receipt times require an explicit availability
scenario. Synthetic end-of-minute availability is never labelled observed.
"""
from datetime import datetime, timedelta
from math import isfinite
from statistics import mean
from zoneinfo import ZoneInfo
from .events import time

MINUTE = timedelta(minutes=1)
END_OF_MINUTE = 'FINAL_BARS_AVAILABLE_AT_MINUTE_END_SCENARIO'


def unknown(reason):
    return {'status': reason, 'value': None}


def known(value, **details):
    return {'status': 'OBSERVABLE', 'value': value, **details}


def exchange_sessions(calendar):
    """Alpaca calendar strings are exchange-local, including early closes/DST."""
    result = {}
    for row in calendar:
        bounds = []
        for name in ('open', 'close'):
            dt = datetime.fromisoformat(row[name])
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=ZoneInfo('America/New_York'))
            bounds.append(time(dt))
        if row['date'] in result or bounds[0] >= bounds[1]:
            raise ValueError('Invalid or duplicate session')
        result[row['date']] = tuple(bounds)
    return result


def visible_bars(rows, at, availability_scenario=None):
    """Latest version actually available at `at`, keyed by minute start.

    No unobserved revision may replace an earlier version. Ambiguous duplicates
    fail instead of depending on input order. Irrelevant future OHLCV is not read.
    """
    at = time(at)
    versions = {}
    for row in rows:
        start = time(row['timestamp'])
        if start + MINUTE > at:
            continue
        available = row.get('available_at')
        if available is None:
            if availability_scenario != END_OF_MINUTE:
                raise ValueError('Receipt time or explicit availability scenario required')
            available = start + MINUTE
        available = time(available)
        if available > at:
            continue
        if available < start + MINUTE:
            raise ValueError('Incomplete minute exposed before end')
        seq = row.get('sequence', 0)
        if not isinstance(seq, int) or isinstance(seq, bool) or seq < 0:
            raise ValueError('Invalid source sequence')
        key = (available, seq)
        bucket = versions.setdefault(start, {})
        if key in bucket:
            raise ValueError('Ambiguous duplicate bar version')
        bucket[key] = row
    output = {}
    for start, versions_at_start in versions.items():
        key = max(versions_at_start)
        row = versions_at_start[key]
        values = [row[k] for k in ('open', 'high', 'low', 'close', 'volume')]
        if any(isinstance(v, bool) or not isinstance(v, (float, int)) or not isfinite(v) for v in values):
            raise ValueError('Invalid OHLCV')
        o, h, l, c, v = values
        if min(o, h, l, c) <= 0 or v < 0 or not l <= min(o, c) <= max(o, c) <= h:
            raise ValueError('Invalid OHLCV range')
        output[start] = {**row, '_available': key[0]}
    return output


def minute_window(bars, end, count, as_of):
    rows = [bars.get(end - i * MINUTE) for i in range(count, 0, -1)]
    return rows if all(r is not None and r['_available'] <= as_of for r in rows) else None


def session_position(at, session):
    if session is None:
        return unknown('UNKNOWN_SESSION')
    at = time(at); start, end = session
    return known((at - start).total_seconds() / 60,
                 minutes_to_close=(end - at).total_seconds() / 60,
                 regular_session=start <= at < end)


def momentum_atr(bars, at, period=14):
    """Price rise in completed last 3 minutes / preceding simple-mean ATR.

    Requires 3 + period + 1 contiguous minutes. The last three minutes do not
    enter ATR. This measures expansion, not an ATR stop or a tradable return.
    """
    if not isinstance(period, int) or period < 1:
        raise ValueError('Positive integer ATR period required')
    end = time(at).replace(second=0, microsecond=0)
    rows = minute_window(bars, end, period + 4, time(at))
    if rows is None:
        return unknown('UNKNOWN_CONTIGUOUS_ATR_HISTORY')
    history, expansion = rows[:-3], rows[-3:]
    atr = mean(max(b['high'] - b['low'], abs(b['high'] - prev['close']),
                   abs(b['low'] - prev['close'])) for prev, b in zip(history, history[1:]))
    if atr <= 0:
        return unknown('UNKNOWN_ZERO_ATR')
    return known((expansion[-1]['close'] - expansion[0]['open']) / atr,
                 atr_price=atr, atr_end_at=(end - 3 * MINUTE).isoformat(),
                 last_input_available_at=max(r['_available'] for r in rows).isoformat())


def same_time_rvol(bars, at, sessions, volume_basis_verified=False, lookback=20):
    """Three-minute volume / same window in each of the previous 20 sessions.

    Missing minutes, shortened prior sessions and unverified split-volume basis
    remain unknown. Never skip a missing session to find a more convenient one.
    `bars` must already be availability-filtered by visible_bars.
    """
    if not isinstance(lookback, int) or lookback < 1:
        raise ValueError('Positive integer RVOL lookback required')
    at = time(at); date = at.astimezone(ZoneInfo('America/New_York')).date().isoformat()
    session = sessions.get(date)
    if session is None or not session[0] <= at < session[1]:
        return unknown('UNKNOWN_SESSION')
    previous = sorted(d for d in sessions if d < date)[-lookback:]
    if len(previous) != lookback:
        return unknown('UNKNOWN_20_SESSION_HISTORY')
    if not volume_basis_verified:
        return unknown('UNKNOWN_VOLUME_ADJUSTMENT_BASIS')
    end = at.replace(second=0, microsecond=0); offset = end - session[0]
    if offset < 3 * MINUTE:
        return unknown('UNKNOWN_COMPLETE_THREE_MINUTES')
    current = minute_window(bars, end, 3, at)
    if current is None:
        return unknown('UNKNOWN_CURRENT_VOLUME')
    volumes = []
    for date in previous:
        start, close = sessions[date]; prior_end = start + offset
        rows = minute_window(bars, prior_end, 3, at) if prior_end <= close else None
        if rows is None:
            return unknown('UNKNOWN_SAME_TIME_VOLUME')
        volumes.append(sum(r['volume'] for r in rows))
    denominator = mean(volumes)
    if denominator <= 0:
        return unknown('UNKNOWN_ZERO_REFERENCE_VOLUME')
    return known(sum(r['volume'] for r in current) / denominator,
                 reference_sessions=previous, reference_mean_volume=denominator)
