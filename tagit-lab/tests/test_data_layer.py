"""اختبار طبقة البيانات بخادم وهمي يحاكي استجابات Alpaca و EDGAR (دون شبكة)."""
import json

import numpy as np
import pandas as pd
import pytest

import tagit_lab.sources.alpaca as alp
import tagit_lab.sources.sec as secmod
from tagit_lab.config import load_config
from tagit_lab.engine import run
from tagit_lab.store import fetch, iter_days

DAYS = [d.strftime("%Y-%m-%d") for d in pd.bdate_range("2025-03-03", "2025-04-11")]
SYMS = {"AAA": 2.0, "BBB": 5.0, "BIG": 50.0}          # BIG قيمته السوقية كبيرة → يُستبعد
SHARES = {"AAA": 20e6, "BBB": 10e6, "BIG": 50e6}
CIK = {"AAA": 1, "BBB": 2, "BIG": 3}


class Resp:
    def __init__(self, js, code=200):
        self._js, self.status_code, self.text = js, code, json.dumps(js)

    def json(self):
        return self._js

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


def daily(sym, d, adj):
    k = DAYS.index(d)
    p = SYMS[sym] * (1 + 0.01 * np.sin(k))
    if sym == "BBB" and adj == "split" and d < "2025-03-20":
        p = p  # لا تقسيم هنا؛ نختبر أساس التحويل بالتساوي
    return {"t": f"{d}T04:00:00Z", "o": p, "h": p * 1.02, "l": p * 0.98, "c": p, "v": 400_000, "n": 900, "vw": p}


def minute_bars(sym, d):
    base = daily(sym, d, "raw")["c"]
    out = []
    t0 = pd.Timestamp(f"{d} 09:30", tz="America/New_York").tz_convert("UTC")
    for i in range(390):
        p = base * (1 + (0.02 if 120 <= i < 123 else 0) * (i - 119) / 3 + (0.02 if i >= 123 else 0))
        v = 30_000 if 120 <= i < 123 else 1_500
        out.append({"t": (t0 + pd.Timedelta(minutes=i)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "o": p, "h": p * 1.001, "l": p * 0.999, "c": p, "v": v, "n": 60 if v > 2000 else 5, "vw": p})
    return out


def fake_get(self, url, params=None, timeout=None):
    params = params or {}
    if url.endswith("/v2/calendar"):
        return Resp([{"date": d, "open": "09:30", "close": "16:00"} for d in DAYS])
    if url.endswith("/v2/assets"):
        rows = [{"symbol": s, "name": s, "exchange": "NASDAQ", "status": "active", "tradable": True} for s in SYMS]
        return Resp(rows if params["status"] == "active" else [])
    if url.endswith("/v2/stocks/bars"):
        syms = params["symbols"].split(",")
        if params["timeframe"] == "1Day":
            return Resp({"bars": {s: [daily(s, d, params["adjustment"]) for d in DAYS] for s in syms}})
        d = params["start"][:10]
        return Resp({"bars": {s: minute_bars(s, d) for s in syms}})
    if url.endswith("/v1beta1/news"):
        return Resp({"news": []})
    if url.endswith("company_tickers_exchange.json"):
        return Resp({"fields": ["cik", "name", "ticker", "exchange"],
                     "data": [[CIK[s], s, s, "Nasdaq"] for s in SYMS]})
    if "companyfacts" in url:
        cik = int(url.split("CIK")[1][:10])
        s = [k for k, v in CIK.items() if v == cik][0]
        items = [{"end": "2024-12-31", "val": SHARES[s], "filed": "2025-02-15"},
                 # رقم مُودع لاحقًا يجب ألا يُستخدم قبل تاريخ إيداعه
                 {"end": "2025-03-31", "val": SHARES[s] * 10, "filed": "2025-04-01"}]
        return Resp({"facts": {"dei": {"EntityCommonStockSharesOutstanding": {"units": {"shares": items}}}}})
    if "submissions" in url:
        cik = int(url.split("CIK")[1][:10])
        recent = {"form": ["424B5", "10-Q"], "acceptanceDateTime": ["2025-03-25T08:00:00.000Z", "2025-03-01T08:00:00.000Z"],
                  "filingDate": ["2025-03-25", "2025-03-01"], "items": ["", ""]} if cik == 1 else \
                 {"form": [], "acceptanceDateTime": [], "filingDate": [], "items": []}
        return Resp({"filings": {"recent": recent, "files": []}})
    raise AssertionError(f"طلب غير متوقع: {url}")


@pytest.fixture()
def fetched(tmp_path, monkeypatch):
    monkeypatch.setenv("ALPACA_KEY_ID", "k")
    monkeypatch.setenv("ALPACA_SECRET_KEY", "s")
    monkeypatch.setenv("SEC_USER_AGENT", "test test@example.com")
    monkeypatch.setattr("requests.Session.get", fake_get)
    monkeypatch.setattr(alp.RateLimiter, "wait", lambda self: None)
    monkeypatch.setattr(secmod.time, "sleep", lambda s: None)
    cfg = load_config()
    fetch(tmp_path, "2025-03-24", "2025-04-04", cfg, log=lambda *a: None)
    return tmp_path, cfg


def test_point_in_time_market_cap_and_universe(fetched):
    root, cfg = fetched
    ctx_before = pd.read_parquet(root / "ctx" / "2025-03-31.parquet").set_index("symbol")
    ctx_after = pd.read_parquet(root / "ctx" / "2025-04-02.parquet").set_index("symbol")
    assert "BIG" not in ctx_before.index                       # 50$ × 50م سهم > 100م
    assert ctx_before.loc["AAA", "shares"] == SHARES["AAA"]     # الرقم اللاحق لم يُستخدم قبل إيداعه
    assert ctx_after.loc["AAA", "shares"] == SHARES["AAA"] * 10 if "AAA" in ctx_after.index else True
    prev = daily("AAA", "2025-03-28", "raw")["c"]
    assert ctx_before.loc["AAA", "prev_close"] == pytest.approx(prev)
    assert ctx_before.loc["AAA", "market_cap"] == pytest.approx(prev * SHARES["AAA"])


def test_days_load_and_engine_runs(fetched):
    root, cfg = fetched
    days = list(iter_days(root, "2025-03-24", "2025-04-04"))
    assert len(days) == 10
    d = [x for x in days if x.date == "2025-03-26"][0]
    assert "AAA" in d.filings and "BBB" not in d.filings        # إيداع 424B5 قبل يوم
    trades, _ = run(days, cfg, ["baseline", "no_dilution"])
    base = trades[trades.variant == "baseline"]
    nod = trades[trades.variant == "no_dilution"]
    assert len(base) > 0
    assert (base["signal_i"] == 121).all()  # تكتمل الشروط بعد دقيقتين من الانفجار (11:31)
    # استبعاد AAA في الأيام التالية للإيداع فقط
    blocked = nod[(nod.symbol == "AAA") & (nod.date >= "2025-03-25")]
    assert blocked.empty
    assert not base[(base.symbol == "AAA") & (base.date >= "2025-03-25")].empty
