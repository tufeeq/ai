"""Read-only SIP recorder and paper setup monitor. Never submits brokerage orders.

Run continuously on a persistent server, not a scheduled static-page refresh.
The append-only journal records receipt time for future genuine replay.
"""
import argparse
import asyncio
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from engine import Config, Detector, quote_check, timestamp, UTC


def credentials():
    key = os.environ.get('ALPACA_API_KEY_ID') or os.environ.get('APCA_API_KEY_ID')
    secret = os.environ.get('ALPACA_API_SECRET_KEY') or os.environ.get('APCA_API_SECRET_KEY')
    if not key or not secret:
        raise RuntimeError('RUNTIME_CREDENTIALS_NOT_CONFIGURED')
    return key, secret


def now():
    return datetime.now(UTC).isoformat()


def write_state(path, state):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2))
    tmp.replace(path)


async def run(universe, output, journal):
    import websockets
    cfg = Config()
    metadata = json.loads(Path(universe).read_text())
    if not isinstance(metadata, list):
        raise ValueError('Universe must be a list of timestamped instrument metadata')
    metadata = [m for m in metadata if m.get('instrument_type') == 'equity'
                and isinstance(m.get('market_cap'), (int, float))
                and 0 < m['market_cap'] < cfg.max_cap
                and 0 <= (timestamp(now())-timestamp(m['metadata_at'])).total_seconds() <= 86400]
    state = dict(version='NEXT-0.1', mode='PAPER_ONLY', feed='sip', updated_at=now(),
                 status='CONNECTING', universe=len(metadata), setups=[], approved_for_live=False)
    output, journal = Path(output), Path(journal)
    output.parent.mkdir(parents=True, exist_ok=True)
    journal.parent.mkdir(parents=True, exist_ok=True)
    write_state(output, state)
    if not metadata:
        state.update(status='CURRENT_UNIVERSE_REQUIRED', updated_at=now())
        write_state(output, state)
        return
    try:
        key, secret = credentials()
    except RuntimeError as exc:
        state.update(status=str(exc), updated_at=now())
        write_state(output, state)
        return
    delay = 1
    while True:
        engine = Detector(metadata)
        active, quotes, history = {}, {}, []
        state.update(status='CONNECTING', setups=[], updated_at=now())
        write_state(output, state)
        try:
            async with websockets.connect('wss://stream.data.alpaca.markets/v2/sip',
                                          open_timeout=10, ping_interval=20) as ws:
                await ws.send(json.dumps(dict(action='auth', key=key, secret=secret)))
                authenticated = False
                with journal.open('a', buffering=1) as log:
                    # Record input provenance even before the first market event.
                    log.write(json.dumps(dict(received_at=now(), type='UNIVERSE', metadata=metadata))+'\n')
                    while True:
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=10)
                        except asyncio.TimeoutError:
                            # Quiet minutes are normal on a bars-only subscription.
                            # Keep the warm-up history; never label an old quote fresh.
                            if not authenticated:
                                raise
                            for symbol, setup in list(active.items()):
                                if timestamp(now()) > timestamp(setup['expires_at']):
                                    setup['quote_status'] = 'EXPIRED'
                                    del active[symbol]
                                    await ws.send(json.dumps(dict(action='unsubscribe', quotes=[symbol])))
                                else:
                                    setup['quote_status'] = 'STALE_QUOTE'
                            state.update(status='WAITING_FOR_MARKET_EVENTS', updated_at=now(), setups=history[-100:])
                            write_state(output, state)
                            continue
                        received = now()
                        messages = json.loads(raw)
                        for m in messages:
                            # Server-side data only: never journal the outbound auth message.
                            log.write(json.dumps(dict(received_at=received, event=m))+'\n')
                            if m.get('T') == 'error':
                                state.update(status='PROVIDER_ERROR', provider_code=m.get('code'), updated_at=received)
                                write_state(output, state)
                                return
                            if m.get('T') == 'success' and m.get('msg') == 'authenticated':
                                authenticated = True
                                await ws.send(json.dumps(dict(action='subscribe', bars=[x['symbol'] for x in metadata])))
                            if m.get('T') == 'subscription':
                                expected = {x['symbol'] for x in metadata}
                                subscribed = set(m.get('bars', []))
                                state['subscribed'] = len(subscribed)
                                state['status'] = 'WARMING_UP' if expected <= subscribed else 'INCOMPLETE_SUBSCRIPTION'
                                if not expected <= subscribed:
                                    write_state(output, state)
                                    return
                            if m.get('T') == 'q':
                                quotes[m['S']] = dict(timestamp=m['t'], feed='sip', bid=m['bp'], ask=m['ap'],
                                                     bid_size=m['bs'], ask_size=m['as'])
                            if m.get('T') == 'b' and authenticated:
                                b = dict(timestamp=m['t'], open=m['o'], high=m['h'], low=m['l'],
                                         close=m['c'], volume=m['v'], vwap=m.get('vw'))
                                signal = engine.on_bar(m['S'], b, received)
                                state['last_bar_received_at'] = received
                                state['status'] = 'RECORDING_PAPER'
                                if signal:
                                    signal['quote_status'] = 'WAITING_FOR_QUOTE'
                                    active[m['S']] = signal
                                    history.append(signal)
                                    await ws.send(json.dumps(dict(action='subscribe', quotes=[m['S']])))
                            for symbol, setup in list(active.items()):
                                if timestamp(received) > timestamp(setup['expires_at']):
                                    setup['quote_status'] = 'EXPIRED'
                                    del active[symbol]
                                    await ws.send(json.dumps(dict(action='unsubscribe', quotes=[symbol])))
                                elif symbol in quotes:
                                    status = quote_check(setup, quotes[symbol], received)
                                    setup['quote_status'] = status
                                    if status == 'PAPER_EXECUTABLE' and not setup.get('first_paper_quote'):
                                        setup['first_paper_quote'] = dict(received_at=received, **quotes[symbol])
                                        log.write(json.dumps(dict(received_at=received,type='PAPER_QUOTE',setup=setup))+'\n')
                                    if status == 'INVALIDATED':
                                        del active[symbol]
                                        await ws.send(json.dumps(dict(action='unsubscribe', quotes=[symbol])))
                        state.update(updated_at=received, setups=history[-100:],
                                     decisions=engine.decisions, warmup_symbols=sum(len(b)>=23 for b in engine.buffers.values()))
                        write_state(output, state)
                        delay = 1
        except (OSError, asyncio.TimeoutError, websockets.exceptions.ConnectionClosed):
            state.update(status='DISCONNECTED', updated_at=now(), setups=[])
            write_state(output, state)
            await asyncio.sleep(delay)
            delay = min(delay*2, 30)
            # No stale pre-disconnect setup can become executable after reconnect.


if __name__ == '__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--universe', required=True)
    p.add_argument('--output', default='data/live.json')
    p.add_argument('--journal', default='private-journal/events.jsonl')
    a=p.parse_args()
    asyncio.run(run(a.universe, a.output, a.journal))
