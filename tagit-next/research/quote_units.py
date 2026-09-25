"""Versioned Alpaca US SIP quote-size contract, expressed in shares.

Do not infer historical wire encoding from a security's round-lot definition.
Older dates/other providers and feeds require their own qualified contract.
"""
from datetime import date
from math import isfinite

from .events import time

VERSION = 'ALPACA_US_SIP_SHARES_20251103_V1'
SOURCE = 'https://docs.alpaca.markets/us/v1.1/changelog/marketdata-bid-and-ask-size-display-change'
EFFECTIVE_DATE = date(2025, 11, 3)
# Midnight New York on the effective date (EST); fixed instant avoids a runtime tzdata dependency.
EFFECTIVE_AT = time('2025-11-03T05:00:00Z')


def contract(event_at, *, provider, feed):
    if (provider != 'alpaca' or feed != 'sip'
            or time(event_at) < EFFECTIVE_AT):
        return None
    return dict(version=VERSION, provider=provider, feed=feed, unit='shares', multiplier=1,
                source=SOURCE, effective_from=EFFECTIVE_DATE.isoformat())


def normalize(bid_size, ask_size, event_at, *, provider, feed):
    """No lot conversion; invalid sizes stay invalid rather than being invented."""
    basis = contract(event_at, provider=provider, feed=feed)
    if basis is None:
        return dict(status='UNKNOWN_QUOTE_SIZE_UNIT', bid_size=None, ask_size=None, basis=None)
    values = (bid_size, ask_size)
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not isfinite(v)
           or v < 0 or int(v) != v for v in values):
        return dict(status='INVALID_QUOTE_SIZE', bid_size=None, ask_size=None, basis=basis)
    return dict(status='SHARES', bid_size=int(bid_size), ask_size=int(ask_size), basis=basis)
