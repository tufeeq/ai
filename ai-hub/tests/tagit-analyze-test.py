#!/usr/bin/env python3
"""Tests for ai-hub/scripts/tagit-analyze.py (stdlib only, no network beyond 127.0.0.1).

Run: python3 ai-hub/tests/tagit-analyze-test.py
"""
import datetime
import http.server
import json
import os
import pathlib
import socket
import subprocess
import sys
import tempfile
import threading
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'tagit-analyze.py'
KEY = 'test-key-do-not-print-7f3a'


def analysis_for(ticker):
    return {
        'ticker': ticker, 'company': ticker + ' Inc', 'asOf': '2026-01-01',
        'executiveSummary': 'summary ' + ticker, 'shortTermSetup': 's', 'liquidityRead': 'l',
        'technicalRead': 't', 'fundamentalGrowth': 'f', 'catalysts': [], 'risks': ['r'],
        'dilutionAndFinancing': 'd', 'latestNewsTake': 'n', 'confidence': 55,
        'verdict': 'WATCH', 'sources': [],
    }


class FakeHub:
    """Local fake of POST /api/tagit/analyze. `mode` maps ticker -> behaviour."""

    def __init__(self):
        self.requests = []
        self.mode = {}
        self.reject_auth = False
        hub = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, code, obj):
                data = json.dumps(obj).encode('utf-8')
                self.send_response(code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)))
                hub.requests.append({'path': self.path, 'auth': self.headers.get('Authorization'),
                                     'body': body})
                if hub.reject_auth or self.headers.get('Authorization') != 'Bearer ' + KEY:
                    return self._send(401, {'error': {'code': 'UNAUTHORIZED', 'message': 'no'}})
                if self.path != '/api/tagit/analyze':
                    return self._send(404, {'error': {'code': 'NOT_FOUND'}})
                ticker = body['rows'][0]['ticker']
                mode = hub.mode.get(str(ticker).upper(), 'ok')  # rows keep the feed's raw ticker case
                if mode == 'http500':
                    return self._send(500, {'error': {'code': 'INTERNAL'}})
                base = {'schemaVersion': 4, 'provider': 'SELF_HOSTED_OLLAMA', 'model': 'fake-model:1b',
                        'updatedAtUTC': 'x', 'liveFeedUpdatedAtUTC': body.get('liveFeedUpdatedAtUTC')}
                if mode == 'model_failed':
                    a = analysis_for(ticker)
                    a.update({'verdict': 'INSUFFICIENT_EVIDENCE', 'confidence': 0,
                              'aiStatus': 'MODEL_FAILED'})
                    base.update({'status': 'MODEL_UNAVAILABLE', 'analysisCount': 1,
                                 'analyses': {ticker: a}, 'note': 'model failed'})
                    return self._send(200, base)
                base.update({'status': 'OK', 'analysisCount': 1,
                             'analyses': {ticker: analysis_for(ticker)}, 'note': 'ok'})
                return self._send(200, base)

        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.url = 'http://127.0.0.1:%d' % self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


def closed_port_url():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return 'http://127.0.0.1:%d' % port


LIVE = {
    'updatedAtUTC': '2026-01-02T15:00:00+00:00',
    'quotes': {'AAA': {'price': 1.5, 'sessionVolume': 1000, 'timestampET': '10:00', 'rsi14': 61},
               'BBB': {'price': 9.0}},
    'emergingCandidates': [{'ticker': 'aaa', 'changePct': 12.5, 'price': 1.6}],
    'accumulationCandidates': [{'ticker': 'AAA', 'changePct': 1}, {'ticker': 'BBB', 'accumulationScore': 80},
                               {'ticker': ''}],
}


class TagitAnalyzeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        self.live = self.dir / 'live-quotes.json'
        self.out = self.dir / 'ai-stock-analysis.json'
        self.live.write_text(json.dumps(LIVE), encoding='utf-8')
        self.hub = FakeHub()

    def tearDown(self):
        self.hub.close()
        self.tmp.cleanup()

    def run_script(self, url=None, key=KEY, event='schedule', extra=()):
        env = {k: v for k, v in os.environ.items()
               if k not in ('AI_HUB_URL', 'AI_HUB_KEY', 'GITHUB_EVENT_NAME')}
        for name in ('http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'all_proxy'):
            env.pop(name, None)
        env['NO_PROXY'] = env['no_proxy'] = '127.0.0.1,localhost'
        if url is not None:
            env['AI_HUB_URL'] = url
        if key is not None:
            env['AI_HUB_KEY'] = key
        env['GITHUB_EVENT_NAME'] = event
        p = subprocess.run([sys.executable, str(SCRIPT), '--live', str(self.live), '--out', str(self.out),
                            '--timeout', '10', *extra],
                           env=env, capture_output=True, text=True, timeout=120)
        self.assertNotIn(KEY, p.stdout + p.stderr, 'the key must never be printed')
        return p

    def doc(self):
        return json.loads(self.out.read_text(encoding='utf-8'))

    def test_merges_two_tickers_one_request_each(self):
        p = self.run_script(self.hub.url + '/')
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(len(self.hub.requests), 2)
        for r, ticker in zip(self.hub.requests, ['AAA', 'BBB']):
            self.assertEqual(r['path'], '/api/tagit/analyze')
            self.assertEqual(r['auth'], 'Bearer ' + KEY)
            self.assertEqual(r['body']['lang'], 'ar')
            self.assertEqual(r['body']['liveFeedUpdatedAtUTC'], LIVE['updatedAtUTC'])
            self.assertEqual(len(r['body']['rows']), 1)
        # Row for AAA: candidate overrides quote, signal type from the first source, quote fields merged.
        row = self.hub.requests[0]['body']['rows'][0]
        self.assertEqual(row['signalType'], 'EMERGING')
        self.assertEqual(row['price'], 1.6)
        self.assertEqual(row['changePct'], 12.5)
        self.assertEqual(row['sessionVolume'], 1000)
        self.assertEqual(row['rsi14'], 61)
        self.assertEqual(row['quoteTime'], '10:00')
        self.assertIn('fibResistance', row)
        self.assertEqual(len(row), 34)
        self.assertEqual(self.hub.requests[1]['body']['rows'][0]['signalType'], 'ACCUMULATION')

        d = self.doc()
        self.assertEqual(list(d)[:3], ['schemaVersion', 'provider', 'model'])
        self.assertEqual(d['schemaVersion'], 4)
        self.assertEqual(d['provider'], 'SELF_HOSTED_OLLAMA')
        self.assertEqual(d['model'], 'fake-model:1b')
        self.assertEqual(d['status'], 'OK')
        self.assertEqual(d['liveFeedUpdatedAtUTC'], LIVE['updatedAtUTC'])
        self.assertEqual(d['analysisCount'], 2)
        self.assertEqual(sorted(d['analyses']), ['AAA', 'BBB'])
        self.assertEqual(d['analyses']['BBB']['executiveSummary'], 'summary BBB')
        self.assertTrue(d['note'])
        datetime.datetime.fromisoformat(d['updatedAtUTC'])

    def test_unreachable_hub_writes_status_doc_without_old_analyses(self):
        self.out.write_text(json.dumps({'schemaVersion': 4, 'provider': 'OPENAI_RESPONSES_WEB_SEARCH',
                                        'updatedAtUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                                        'analysisCount': 1, 'analyses': {'OLD': analysis_for('OLD')}}),
                            encoding='utf-8')
        p = self.run_script(closed_port_url())
        self.assertEqual(p.returncode, 0, p.stderr)
        d = self.doc()
        self.assertEqual(d['status'], 'HUB_UNREACHABLE')
        self.assertEqual(d['provider'], 'SELF_HOSTED_OLLAMA')
        self.assertEqual(d['analyses'], {})
        self.assertEqual(d['analysisCount'], 0)
        self.assertIn('could not be reached', d['note'])
        self.assertEqual(len(self.hub.requests), 0)

    def test_unauthorized_stops_after_first_request(self):
        self.hub.reject_auth = True
        p = self.run_script(self.hub.url)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(len(self.hub.requests), 1)
        d = self.doc()
        self.assertEqual(d['status'], 'HUB_UNREACHABLE')
        self.assertEqual(d['analyses'], {})
        self.assertIn('401', d['note'])
        self.assertNotIn(KEY, self.out.read_text(encoding='utf-8'))

    def test_missing_env_leaves_file_untouched(self):
        before = '{"provider": "OPENAI_RESPONSES_WEB_SEARCH", "marker": 1}\n'
        self.out.write_text(before, encoding='utf-8')
        for url, key in ((None, KEY), (self.hub.url, None), (None, None), ('  ', '  ')):
            p = self.run_script(url, key)
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertIn('not configured', p.stdout)
            self.assertEqual(self.out.read_text(encoding='utf-8'), before)
        self.out.unlink()
        self.run_script(None, None)
        self.assertFalse(self.out.exists())
        self.assertEqual(len(self.hub.requests), 0)

    def test_freshness_skip_and_manual_override(self):
        fresh = json.dumps({'schemaVersion': 4, 'provider': 'SELF_HOSTED_OLLAMA', 'model': 'm',
                            'updatedAtUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                            'analysisCount': 0, 'analyses': {}, 'marker': 'fresh'})
        self.out.write_text(fresh, encoding='utf-8')
        p = self.run_script(self.hub.url)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn('still fresh', p.stdout)
        self.assertEqual(self.out.read_text(encoding='utf-8'), fresh)
        self.assertEqual(len(self.hub.requests), 0)
        # workflow_dispatch bypasses the skip.
        p = self.run_script(self.hub.url, event='workflow_dispatch')
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(len(self.hub.requests), 2)
        self.assertEqual(self.doc()['status'], 'OK')

    def test_stale_or_other_provider_file_is_not_skipped(self):
        old_t = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=600)).isoformat()
        self.out.write_text(json.dumps({'provider': 'SELF_HOSTED_OLLAMA', 'updatedAtUTC': old_t}),
                            encoding='utf-8')
        self.run_script(self.hub.url)
        self.assertEqual(len(self.hub.requests), 2)
        self.out.write_text(json.dumps({'provider': 'OPENAI_RESPONSES_WEB_SEARCH',
                                        'updatedAtUTC': datetime.datetime.now(datetime.timezone.utc).isoformat()}),
                            encoding='utf-8')
        self.run_script(self.hub.url)
        self.assertEqual(len(self.hub.requests), 4)

    def test_empty_shortlist_document(self):
        self.live.write_text(json.dumps({'updatedAtUTC': 'T', 'quotes': {}}), encoding='utf-8')
        p = self.run_script(self.hub.url)
        self.assertEqual(p.returncode, 0, p.stderr)
        d = self.doc()
        self.assertEqual(d['provider'], 'SELF_HOSTED_OLLAMA')
        self.assertEqual(d['note'], 'No active shortlist to research.')
        self.assertEqual(d['analysisCount'], 0)
        self.assertEqual(d['analyses'], {})
        self.assertEqual(d['liveFeedUpdatedAtUTC'], 'T')
        self.assertEqual(len(self.hub.requests), 0)

    def test_partial_when_one_ticker_fails(self):
        self.hub.mode['BBB'] = 'http500'
        p = self.run_script(self.hub.url)
        self.assertEqual(p.returncode, 0, p.stderr)
        d = self.doc()
        self.assertEqual(d['status'], 'PARTIAL')
        self.assertEqual(list(d['analyses']), ['AAA'])
        self.assertEqual(d['analysisCount'], 1)
        self.assertIn('BBB', d['note'])

    def test_model_failed_everywhere_is_model_unavailable(self):
        self.hub.mode.update({'AAA': 'model_failed', 'BBB': 'model_failed'})
        p = self.run_script(self.hub.url)
        self.assertEqual(p.returncode, 0, p.stderr)
        d = self.doc()
        self.assertEqual(d['status'], 'MODEL_UNAVAILABLE')
        self.assertEqual(d['analyses']['AAA']['aiStatus'], 'MODEL_FAILED')
        self.assertEqual(d['analyses']['AAA']['verdict'], 'INSUFFICIENT_EVIDENCE')

    def test_max_eight_rows_and_budget_leaves_rest_out(self):
        live = dict(LIVE)
        live['emergingCandidates'] = [{'ticker': 'T%02d' % i} for i in range(12)]
        self.live.write_text(json.dumps(live), encoding='utf-8')
        p = self.run_script(self.hub.url)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(len(self.hub.requests), 8)
        self.assertEqual(self.doc()['analysisCount'], 8)
        # An exhausted budget makes no request and fabricates nothing.
        self.hub.requests.clear()
        p = self.run_script(self.hub.url, event='workflow_dispatch', extra=('--budget', '0'))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(len(self.hub.requests), 0)
        self.assertEqual(self.doc()['analyses'], {})


if __name__ == '__main__':
    unittest.main(verbosity=2)
