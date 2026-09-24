"""عميل Alpaca للبيانات التاريخية — الخطة المجانية (Basic).

ما تتيحه الخطة المجانية ونستخدمه:
- بيانات SIP الموحّدة (كل البورصات) منذ 2016 بشرط أن تكون أقدم من 15 دقيقة.
- 200 طلب في الدقيقة للبيانات التاريخية.
- الشموع تتضمن عدد الصفقات n و VWAP (vw).
المفاتيح: حساب Alpaca مجاني (Paper) — متغيرا البيئة ALPACA_KEY_ID و ALPACA_SECRET_KEY.
"""
from __future__ import annotations

import os
import time
from collections import deque

import pandas as pd
import requests

DATA_URL = "https://data.alpaca.markets"
TRADING_URL = "https://paper-api.alpaca.markets"


class RateLimiter:
    def __init__(self, per_minute: int = 180):
        self.per_minute = per_minute
        self.calls: deque[float] = deque()

    def wait(self) -> None:
        now = time.monotonic()
        while self.calls and now - self.calls[0] > 60:
            self.calls.popleft()
        if len(self.calls) >= self.per_minute:
            time.sleep(60 - (now - self.calls[0]) + 0.05)
        self.calls.append(time.monotonic())


class Alpaca:
    def __init__(self, key: str | None = None, secret: str | None = None, per_minute: int = 180):
        key = key or os.environ.get("ALPACA_KEY_ID") or os.environ.get("ALPACA_API_KEY_ID") or os.environ.get("APCA_API_KEY_ID")
        secret = secret or os.environ.get("ALPACA_SECRET_KEY") or os.environ.get("ALPACA_API_SECRET_KEY") or os.environ.get("APCA_API_SECRET_KEY")
        self.proxy = os.environ.get("TAGIT_LAB_PROXY_URL", "").rstrip("/") if not (key and secret) else ""
        if self.proxy and self.proxy != "https://tagit-next-quotes.onrender.com/api/lab/provider":
            raise ValueError("Unknown research proxy")
        if (not key or not secret) and not self.proxy:
            raise RuntimeError("ضع ALPACA_KEY_ID و ALPACA_SECRET_KEY (حساب Paper مجاني من alpaca.markets).")
        self.s = requests.Session()
        if not self.proxy:
            self.s.headers.update({"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret})
        self.rl = RateLimiter(min(per_minute, 30) if self.proxy else per_minute)

    def _get(self, url: str, params: dict) -> dict | list:
        params = dict(params)
        if params.get("feed") == "sip" and params.get("end"):
            # قيد الخطة المجانية: نهاية طلب SIP يجب أن تكون أقدم من 15 دقيقة
            limit = pd.Timestamp.now(tz="UTC") - pd.Timedelta(minutes=16)
            end = pd.Timestamp(params["end"])
            end = end.tz_localize("UTC") if end.tzinfo is None else end.tz_convert("UTC")
            if end > limit:
                params = {**params, "end": limit.strftime("%Y-%m-%dT%H:%M:%SZ")}
        if self.proxy:
            resources = {f"{DATA_URL}/v2/stocks/bars": "bars", f"{DATA_URL}/v2/stocks/quotes": "quotes",
                         f"{DATA_URL}/v1beta1/news": "news", f"{TRADING_URL}/v2/calendar": "calendar",
                         f"{TRADING_URL}/v2/assets": "assets"}
            if url not in resources:
                raise ValueError("Unsupported read-only resource")
            params = {**params, "resource": resources[url]}
            url = self.proxy
        for attempt in range(6):
            self.rl.wait()
            r = self.s.get(url, params=params, timeout=60)
            if r.status_code >= 400:
                try:
                    code = r.json().get("status")
                except (ValueError, AttributeError):
                    code = None
                if code in {"FEED_NOT_ENTITLED", "PROVIDER_AUTH_FAILED", "RUNTIME_CREDENTIALS_NOT_CONFIGURED"}:
                    raise RuntimeError(code)
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(min(60, 2 ** attempt * 2))
                continue
            if r.status_code == 403 and "sip" in str(params.get("feed", "")):
                raise RuntimeError(
                    "رفضت Alpaca طلب SIP. تأكد أن نهاية الفترة أقدم من 15 دقيقة (قيد الخطة المجانية)."
                )
            r.raise_for_status()
            return r.json()
        r.raise_for_status()
        return {}

    # --- مرجعيات -----------------------------------------------------------
    def calendar(self, start: str, end: str) -> pd.DataFrame:
        js = self._get(f"{TRADING_URL}/v2/calendar", {"start": start, "end": end})
        return pd.DataFrame(js, columns=["date", "open", "close"])

    def assets(self) -> pd.DataFrame:
        rows = []
        for status in ("active", "inactive"):  # inactive = مشطوبة، لتقليل تحيّز البقاء
            js = self._get(f"{TRADING_URL}/v2/assets", {"status": status, "asset_class": "us_equity"})
            rows.extend(js)
        df = pd.DataFrame(rows)
        return df[["symbol", "name", "exchange", "status", "tradable"]].drop_duplicates("symbol")

    # --- أسعار ---------------------------------------------------------------
    def bars(self, symbols: list[str], timeframe: str, start: str, end: str,
             adjustment: str = "raw", feed: str = "sip") -> pd.DataFrame:
        out = []
        for k in range(0, len(symbols), 100):
            chunk = symbols[k:k + 100]
            token = None
            while True:
                p = {"symbols": ",".join(chunk), "timeframe": timeframe, "start": start, "end": end,
                     "adjustment": adjustment, "feed": feed, "limit": 10000, "sort": "asc"}
                if token:
                    p["page_token"] = token
                js = self._get(f"{DATA_URL}/v2/stocks/bars", p)
                for sym, bars in (js.get("bars") or {}).items():
                    for b in bars:
                        out.append((sym, b["t"], b["o"], b["h"], b["l"], b["c"], b["v"], b.get("n", 0), b.get("vw", b["c"])))
                token = js.get("next_page_token")
                if not token:
                    break
        df = pd.DataFrame(out, columns=["symbol", "ts", "o", "h", "l", "c", "v", "n", "vw"])
        df["ts"] = pd.to_datetime(df["ts"], utc=True)
        return df

    def first_quote(self, symbol: str, start: str, end: str) -> dict | None:
        """أول عرض NBBO بعد لحظة الإشارة — لقياس الفرق الفعلي بدل تقديره."""
        js = self._get(f"{DATA_URL}/v2/stocks/quotes",
                       {"symbols": symbol, "start": start, "end": end, "feed": "sip", "limit": 50})
        for q in (js.get("quotes") or {}).get(symbol, []):
            if q.get("ap", 0) > 0 and q.get("bp", 0) > 0 and q["ap"] >= q["bp"]:
                return {"t": q["t"], "ask": q["ap"], "bid": q["bp"]}
        return None

    # --- أخبار (Benzinga عبر Alpaca، متاحة في الخطة المجانية) ---------------
    def news(self, symbols: list[str], start: str, end: str) -> pd.DataFrame:
        rows = []
        for k in range(0, len(symbols), 50):
            token = None
            while True:
                p = {"symbols": ",".join(symbols[k:k + 50]), "start": start, "end": end,
                     "limit": 50, "sort": "asc", "include_content": "false"}
                if token:
                    p["page_token"] = token
                js = self._get(f"{DATA_URL}/v1beta1/news", p)
                for n in js.get("news", []):
                    for s in n.get("symbols", []):
                        rows.append((s, n["created_at"], n.get("headline", ""), n.get("source", "")))
                token = js.get("next_page_token")
                if not token:
                    break
        df = pd.DataFrame(rows, columns=["symbol", "ts", "headline", "source"])
        df["ts"] = pd.to_datetime(df["ts"], utc=True)
        return df
