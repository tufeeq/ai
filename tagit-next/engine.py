"""Independent causal small-cap hypothesis engine. No imports from prior TAGit code.

Outputs are research setups, never calibrated probabilities or approved trades.
All timestamps refer to information availability (minute bars end at t + 60s).
"""
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta, timezone
from collections import defaultdict, deque
from statistics import mean
from zoneinfo import ZoneInfo
import math

ET = ZoneInfo('America/New_York')
UTC = timezone.utc


def timestamp(value):
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        raise ValueError('Timestamp must have a timezone')
    return dt.astimezone(UTC)


@dataclass(frozen=True)
class Config:
    max_cap: float = 1_000_000_000
    min_price: float = .15
    max_price: float = 30
    baseline_bars: int = 20
    base_bars: int = 5
    min_dollar_volume_3m: float = 25000
    min_volume_acceleration: float = 1.5
    max_base_width: float = .08
    max_risk: float = .06
    max_chase: float = .005
    max_spread: float = .008
    quote_age_seconds: int = 3
    expiry_seconds: int = 120
    cooldown_minutes: int = 30
    horizon_minutes: int = 45
    cost_per_side: float = .0025


class Detector:
    def __init__(self, metadata, config=None, retrospective_metadata=False):
        self.config = config or Config()
        self.metadata = {r['symbol']: r for r in metadata}
        self.retrospective_metadata = retrospective_metadata
        self.buffers = defaultdict(lambda: deque(maxlen=80))
        self.days = {}
        self.vwap = defaultdict(lambda: [0., 0.])
        self.last_alert = {}
        self.decisions = {}

    def on_bar(self, symbol, bar, received_at):
        cfg = self.config
        start = timestamp(bar['timestamp'])
        end = start + timedelta(minutes=1)
        now = timestamp(received_at)
        def reject(reason):
            self.decisions[symbol] = {'reason': reason, 'at': now.isoformat()}
            return None
        if end > now:
            return reject('INCOMPLETE_BAR')
        fields = ('open', 'high', 'low', 'close', 'volume')
        if any(not isinstance(bar.get(k), (float, int)) or not math.isfinite(bar[k]) for k in fields):
            return reject('INVALID_BAR')
        if not (0 < bar['low'] <= min(bar['open'], bar['close']) <= max(bar['open'], bar['close']) <= bar['high']) or bar['volume'] <= 0:
            return reject('INVALID_BAR')
        day = start.astimezone(ET).date().isoformat()
        existing = self.buffers[symbol]
        if existing and start <= timestamp(existing[-1]['timestamp']):
            return reject('DUPLICATE_OR_CORRECTED_BAR')
        if self.days.get(symbol) != day:
            self.buffers[symbol].clear()
            self.vwap[symbol] = [0., 0.]
            self.last_alert.pop(symbol, None)
            self.days[symbol] = day
        buf = self.buffers[symbol]
        if buf and start <= timestamp(buf[-1]['timestamp']):
            return reject('DUPLICATE_OR_CORRECTED_BAR')
        # Pre/post-market histories are isolated by the session date; output below
        # is regular-session only until separate extended-hours testing is complete.
        buf.append(dict(bar))
        vw = bar.get('vwap') or (bar['high'] + bar['low'] + bar['close']) / 3
        self.vwap[symbol][0] += vw * bar['volume']
        self.vwap[symbol][1] += bar['volume']
        local = start.astimezone(ET)
        if not (570 <= local.hour * 60 + local.minute < 960):
            return reject('EXTENDED_HOURS_CONTEXT_ONLY')
        if (now - end).total_seconds() > 10:
            return reject('DELAYED_BAR')
        meta = self.metadata.get(symbol)
        if not meta or meta.get('instrument_type') != 'equity':
            return reject('MISSING_EQUITY_METADATA')
        cap = meta.get('market_cap')
        if not isinstance(cap, (int, float)) or not math.isfinite(cap) or not 0 < cap < cfg.max_cap:
            return reject('OUTSIDE_SMALL_CAP_UNIVERSE')
        if not self.retrospective_metadata:
            age = (now - timestamp(meta['metadata_at'])).total_seconds()
            if age < 0 or age > 86400:
                return reject('METADATA_NOT_CURRENT')
        if not cfg.min_price <= bar['close'] <= cfg.max_price:
            return reject('OUTSIDE_PRICE_RANGE')
        if len(buf) < cfg.baseline_bars + 3:
            return reject('WARMING_UP')
        seq = list(buf)
        recent, baseline = seq[-3:], seq[-(cfg.baseline_bars+3):-3]
        if any((timestamp(b['timestamp']) - timestamp(a['timestamp'])).total_seconds() != 60 for a, b in zip(seq[-6:], seq[-5:])):
            return reject('RECENT_MINUTE_GAP')
        elapsed = (timestamp(baseline[-1]['timestamp']) - timestamp(baseline[0]['timestamp'])).total_seconds()/60 + 1
        if elapsed > 45:
            return reject('SPARSE_BASELINE')
        acceleration = (sum(b['volume'] for b in recent)/3) / (sum(b['volume'] for b in baseline)/elapsed)
        dollars = sum(b['close'] * b['volume'] for b in recent)
        session_vwap = self.vwap[symbol][0]/self.vwap[symbol][1]
        if dollars < cfg.min_dollar_volume_3m:
            return reject('INSUFFICIENT_TRADED_VALUE')
        if acceleration < cfg.min_volume_acceleration:
            return reject('NO_VOLUME_ACCELERATION')
        if bar['close'] < session_vwap:
            return reject('BELOW_SESSION_VWAP')
        base = seq[-(cfg.base_bars+1):-1]
        high, low = max(b['high'] for b in base), min(b['low'] for b in base)
        width = high / low - 1
        close_location = (bar['close'] - bar['low']) / max(bar['high'] - bar['low'], 1e-9)
        breakout = width <= cfg.max_base_width and bar['close'] > high * 1.001
        reclaim = (seq[-2]['close'] < session_vwap <= bar['close']
                   and bar['close'] > max(b['high'] for b in seq[-4:-1]))
        if not (breakout or reclaim) or close_location < .65:
            return reject('NO_BREAKOUT_OR_RECLAIM')
        stop = low * .999
        entry = bar['close']
        max_entry = entry * (1 + cfg.max_chase)
        risk = (max_entry - stop) / max_entry
        if not .005 <= risk <= cfg.max_risk:
            return reject('STOP_TOO_CLOSE_OR_TOO_FAR')
        last = self.last_alert.get(symbol)
        if last and (end - last).total_seconds() < cfg.cooldown_minutes * 60:
            return reject('COOLDOWN')
        self.last_alert[symbol] = end
        # Target equals 2R after both entry and exit cost, computed at worst allowed entry.
        effective_entry = max_entry * (1 + cfg.cost_per_side)
        net_risk = effective_entry - stop * (1 - cfg.cost_per_side)
        target = (effective_entry + 2 * net_risk) / (1 - cfg.cost_per_side)
        result = dict(id=f'{symbol}:{end.isoformat()}', symbol=symbol,
                      at=end.isoformat(), pattern='BASE_BREAKOUT' if breakout else 'VWAP_RECLAIM',
                      status='RESEARCH_SETUP', entry=entry, max_entry=max_entry, stop=stop,
                      target=target, expires_at=(end+timedelta(seconds=cfg.expiry_seconds)).isoformat(),
                      volume_acceleration=round(acceleration, 3), dollar_volume_3m=round(dollars),
                      risk_pct=round(risk*100, 3), session_vwap=session_vwap,
                      metadata_retrospective=self.retrospective_metadata,
                      approved_for_live=False)
        self.decisions[symbol] = {'reason': 'SETUP', 'at': now.isoformat()}
        return result


def quote_check(setup, quote, now, config=None):
    cfg = config or Config()
    now = timestamp(now)
    if now < timestamp(setup['at']) or now > timestamp(setup['expires_at']):
        return 'EXPIRED_OR_FUTURE_SETUP'
    if quote.get('feed') != 'sip':
        return 'CONSOLIDATED_QUOTE_REQUIRED'
    age = (now - timestamp(quote['timestamp'])).total_seconds()
    if age < 0 or age > cfg.quote_age_seconds:
        return 'STALE_QUOTE'
    bid, ask = quote.get('bid', 0), quote.get('ask', 0)
    if not all(isinstance(x, (int, float)) and math.isfinite(x) for x in (bid, ask)) or not 0 < bid <= ask:
        return 'INVALID_QUOTE'
    if quote.get('bid_size', 0) <= 0 or quote.get('ask_size', 0) <= 0:
        return 'EMPTY_QUOTE'
    if (ask-bid)/((ask+bid)/2) > cfg.max_spread:
        return 'SPREAD_TOO_WIDE'
    if bid <= setup['stop']:
        return 'INVALIDATED'
    if ask < setup['entry'] or ask > setup['max_entry']:
        return 'OUTSIDE_ENTRY_RANGE'
    return 'PAPER_EXECUTABLE'


def simulate(setup, bars, config=None):
    """Next-minute-open approximation. Never a historical executable-price claim.

    No interpolation across absent minutes. Ambiguous stop/target order is charged
    as a stop and separately reported. Truncated horizons remain UNRESOLVED.
    """
    cfg = config or Config()
    at = timestamp(setup['at'])
    future = [b for b in bars if timestamp(b['timestamp']) >= at]
    result = dict(setup, outcome='UNRESOLVED', net_pct=None, fill=None,
                  execution_assumption='next-minute open; no historical quotes; 0.25% cost each side')
    if not future or timestamp(future[0]['timestamp']) != at:
        return dict(result, outcome='NO_NEXT_MINUTE')
    fill = future[0]['open']
    if not setup['entry'] <= fill <= setup['max_entry']:
        return dict(result, outcome='ENTRY_NOT_AVAILABLE')
    result['fill'] = fill
    last = at - timedelta(minutes=1)
    mfe, mae = 0., 0.
    for b in future:
        t = timestamp(b['timestamp'])
        if t >= at + timedelta(minutes=cfg.horizon_minutes):
            break
        if t != last + timedelta(minutes=1):
            return dict(result, outcome='UNSCORABLE_GAP', mfe_pct=mfe, mae_pct=mae)
        last = t
        stop_hit, target_hit = b['low'] <= setup['stop'], b['high'] >= setup['target']
        mfe = max(mfe, (b['high']/fill-1)*100)
        mae = min(mae, (b['low']/fill-1)*100)
        if stop_hit or target_hit:
            label = 'AMBIGUOUS_STOP_ASSUMED' if stop_hit and target_hit else 'STOP' if stop_hit else 'TARGET'
            price = min(b['open'], setup['stop']) if stop_hit else setup['target']
            # Bar extremes do not establish whether they happened before the exit.
            return dict(result, outcome=label, exit_at=(t+timedelta(minutes=1)).isoformat(),
                        net_pct=round((price*(1-cfg.cost_per_side)/(fill*(1+cfg.cost_per_side))-1)*100,4))
        if t + timedelta(minutes=1) == at + timedelta(minutes=cfg.horizon_minutes):
            return dict(result, outcome='TIMEOUT', exit_at=(t+timedelta(minutes=1)).isoformat(),
                        net_pct=round((b['close']*(1-cfg.cost_per_side)/(fill*(1+cfg.cost_per_side))-1)*100,4))
    return result
