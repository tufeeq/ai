import argparse
import json
import pandas as pd
import pytest
from tagit_lab.cli import cmd_forward
from tagit_lab.config import load_config
from tagit_lab.sources.alpaca import Alpaca
from tagit_lab.publish import export
from tagit_lab.features import DayData


def test_render_credentials_aliases(monkeypatch):
    for key in ['ALPACA_KEY_ID','ALPACA_SECRET_KEY','TAGIT_LAB_PROXY_URL','APCA_API_KEY_ID','APCA_API_SECRET_KEY']:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv('ALPACA_API_KEY_ID', 'example-key')
    monkeypatch.setenv('ALPACA_API_SECRET_KEY', 'example-secret')
    ap = Alpaca()
    assert ap.s.headers['APCA-API-KEY-ID'] == 'example-key'
    assert ap.proxy == ''


def test_proxy_never_receives_credentials(monkeypatch):
    for key in ['ALPACA_KEY_ID','ALPACA_SECRET_KEY','ALPACA_API_KEY_ID','ALPACA_API_SECRET_KEY','APCA_API_KEY_ID','APCA_API_SECRET_KEY']:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv('TAGIT_LAB_PROXY_URL', 'https://tagit-next-quotes.onrender.com/api/lab/provider')
    ap = Alpaca()
    assert 'APCA-API-KEY-ID' not in ap.s.headers
    assert ap.rl.per_minute == 30
    monkeypatch.setenv('TAGIT_LAB_PROXY_URL', 'https://untrusted.invalid')
    with pytest.raises(ValueError):
        Alpaca()


def test_empty_forward_session_is_recorded_once(tmp_path, monkeypatch):
    day = DayData('2026-09-22',pd.DataFrame(columns=['symbol','ts','o','h','l','c','v','n','vw']),pd.DataFrame())
    calls=[]
    def run_day(*args):
        calls.append(1)
        return [], {'symbols':0,'eligible':0,'unknown_mcap':0}
    monkeypatch.setattr('tagit_lab.cli.run_day',run_day)
    args=argparse.Namespace(results=str(tmp_path),synthetic_days=[day],variant='baseline')
    cfg=load_config()
    cmd_forward(args,cfg)
    cmd_forward(args,cfg)
    assert len(calls)==1
    summary=json.loads((tmp_path/'forward/summary.json').read_text())
    assert summary['sessions_evaluated']==1 and summary['last_date']=='2026-09-22'
    args.variant='wide_stop'
    with pytest.raises(ValueError,match='configuration changed'):
        cmd_forward(args,cfg)


def test_export_has_no_fabricated_performance(tmp_path):
    export(tmp_path/'empty',tmp_path/'web')
    data=json.loads((tmp_path/'web/summary.json').read_text())
    assert 'development' not in data and 'forward' not in data
    assert data['profitability_claim_allowed'] is False
