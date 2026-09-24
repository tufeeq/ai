import json
import sqlite3
import unittest
from unittest.mock import patch
from research.execution import simulate
from research.paper import evaluate
from research.events import time


class Paper(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.executescript('CREATE TABLE signals(id TEXT,symbol TEXT,at TEXT,feed TEXT,payload TEXT); CREATE TABLE outcomes(id TEXT PRIMARY KEY,status TEXT,payload TEXT); CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,received_at TEXT,kind TEXT,symbol TEXT,payload TEXT);')
        self.at='2026-09-24T14:00:00.000Z'
        self.lots=[dict(symbol='TEST',shares=100,source='synthetic',available_at='2026-09-23T00:00:00Z',valid_from='2026-09-24T00:00:00Z',valid_until='2026-09-25T00:00:00Z')]

    def tearDown(self):self.db.close()
    def signal(self,feed='sip',plan=True):
        payload=dict(plan=dict(entry=10,stop=9.8,targets=[10.2,10.4]) if plan else None)
        self.db.execute('INSERT INTO signals VALUES(?,?,?,?,?)',('ID','TEST',self.at,feed,json.dumps(payload)))
    def event(self,at,kind,payload,symbol=None):
        self.db.execute('INSERT INTO events(received_at,kind,symbol,payload) VALUES(?,?,?,?)',(at,kind,symbol,json.dumps(payload)))
    def result(self,lots=None,now='2026-09-24T14:35:00Z'):
        evaluate(self.db,self.lots if lots is None else lots,time(now))
        return json.loads(self.db.execute('SELECT payload FROM outcomes').fetchone()[0])
    def market(self):
        self.event('2026-09-24T13:59:00.000Z','STREAM_STATUS',dict(state='SUBSCRIBED',feed='sip',subscribed_symbols=['TEST']))
        self.event(self.at,'MARKET',dict(T='b',S='TEST',feed='sip',t='2026-09-24T13:59:00Z',v=10000),'TEST')
        for sec,bid,ask in [('01',9.99,10),('02',10.41,10.42)]:
            stamp=f'2026-09-24T14:00:{sec}.000Z'
            self.event(stamp,'MARKET',dict(T='q',S='TEST',feed='sip',t=stamp,bp=bid,ap=ask,bs=1,**{'as':1}),'TEST')
    def test_same_execution_function_and_terminal_idempotence(self):
        self.signal();self.market();r=self.result();self.assertEqual(r['status'],'TARGET');self.assertGreater(r['net_pct'],0)
        self.event('2026-09-24T14:36:00.000Z','STREAM_STATUS',dict(state='DISCONNECTED'))
        self.assertEqual(self.result(now='2026-09-24T14:40:00Z'),r)
    def test_connection_gap_prevents_fabricated_fill(self):
        self.signal();self.market()
        # Sequence is authoritative, with chronological insertion required in the journal.
        self.db.execute("UPDATE events SET payload=? WHERE kind='STREAM_STATUS'",(json.dumps(dict(state='DISCONNECTED')),))
        self.assertEqual(self.result()['status'],'UNKNOWN_COVERAGE')
    def test_post_transition_shares_do_not_require_lot_metadata(self):
        self.signal();self.market();r=self.result(lots=[])
        self.assertEqual(r['status'],'TARGET')
        self.assertEqual(r['quote_size_basis']['unit'],'shares')
    def test_single_venue_stays_unqualified(self):
        self.signal(feed='iex');self.market()
        self.assertEqual(self.result()['status'],'SINGLE_EXCHANGE_OR_DELAYED')
    def test_lot_metadata_does_not_multiply_share_sizes(self):
        self.signal();self.market()
        with patch('research.paper.simulate',wraps=simulate) as replay:
            self.result(lots=self.lots)
        quotes=replay.call_args.args[1]
        self.assertEqual([q['ask_size'] for q in quotes],[1,1])
        self.assertEqual([q['bid_size'] for q in quotes],[1,1])
    def test_older_wire_units_unknown_even_with_lot_file(self):
        self.at='2025-10-31T14:00:00.000Z';self.signal()
        self.assertEqual(self.result()['status'],'UNKNOWN_QUOTE_SIZE_UNIT')
    def test_invalid_size_does_not_enable_entry(self):
        self.signal();self.market()
        self.db.execute("UPDATE events SET payload=json_set(payload,'$.as',0.5) WHERE kind='MARKET' AND json_extract(payload,'$.T')='q'")
        self.assertEqual(self.result()['status'],'NO_ENTRY')
    def test_no_plan_is_not_a_loss(self):
        self.signal(plan=False);r=self.result();self.assertEqual(r['status'],'NO_PLAN');self.assertIsNone(r['net_pct'])


if __name__=='__main__':unittest.main()
