import asyncio
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from collect import collect
from stream import run
from test_engine import fixture, detect


class RuntimeIntegrity(unittest.TestCase):
    def test_collector_rejects_post_period_universe(self):
        with self.assertRaises(ValueError):
            collect([{'symbol':'X','metadata_at':'2026-09-14T00:00:00Z'}],
                    '2026-09-10T00:00:00Z','2026-09-11T00:00:00Z')

    def test_collector_rejects_reverse_period(self):
        with self.assertRaises(ValueError):
            collect([], '2026-09-11T00:00:00Z','2026-09-10T00:00:00Z')

    def test_missing_runtime_credentials_never_opens_connection(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            meta=[dict(symbol='X',market_cap=1e7,instrument_type='equity',
                       metadata_at=datetime.now(timezone.utc).isoformat())]
            (root/'universe.json').write_text(json.dumps(meta))
            with patch('stream.credentials',side_effect=RuntimeError('RUNTIME_CREDENTIALS_NOT_CONFIGURED')):
                with patch('websockets.connect') as connect:
                    asyncio.run(run(root/'universe.json',root/'state.json',root/'journal.jsonl'))
                    connect.assert_not_called()
            state=json.loads((root/'state.json').read_text())
            self.assertEqual(state['status'],'RUNTIME_CREDENTIALS_NOT_CONFIGURED')
            self.assertFalse(state['approved_for_live'])

    def test_previous_day_late_bar_cannot_reset_today(self):
        e,s=detect()
        before=list(e.buffers['TEST'])
        b=dict(fixture()[1][0],timestamp='2026-09-11T13:30:00Z')
        e.on_bar('TEST',b,s[0]['at'])
        self.assertEqual(list(e.buffers['TEST']),before)
