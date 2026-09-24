"""SEC EDGAR — مجاني بالكامل، ويتطلب فقط ترويسة User-Agent تعرّف بالجهة (متغير SEC_USER_AGENT).

نستخدمه لأمرين:
1) الأسهم القائمة كما كانت معروفة في تاريخ الإشارة (حسب تاريخ الإيداع) → قيمة سوقية بلا تحيّز النظر للمستقبل.
2) إيداعات الطرح والتخفيف (S-1, S-3, F-1, F-3, 424B*، و 8-K بند 3.02) مع وقت قبولها الدقيق.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

import pandas as pd
import requests

DILUTION_FORMS = {"S-1", "S-1/A", "S-3", "S-3/A", "F-1", "F-1/A", "F-3", "F-3/A",
                  "424B1", "424B2", "424B3", "424B4", "424B5", "424B7", "S-1MEF", "S-3MEF"}


class SEC:
    def __init__(self, cache_dir: str | Path, user_agent: str | None = None):
        ua = user_agent or os.environ.get("SEC_USER_AGENT")
        if not ua:
            raise RuntimeError('ضع SEC_USER_AGENT بصيغة "اسم الجهة بريد@مثال.com" كما تشترط SEC.')
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": ua, "Accept-Encoding": "gzip, deflate"})
        self.cache = Path(cache_dir)
        self.cache.mkdir(parents=True, exist_ok=True)
        self._last = 0.0

    def _get_json(self, url: str, cache_name: str, max_age_days: float = 7) -> dict:
        p = self.cache / cache_name
        if p.exists() and (time.time() - p.stat().st_mtime) < max_age_days * 86400:
            return json.loads(p.read_text())
        wait = 0.12 - (time.time() - self._last)  # SEC: حد أقصى 10 طلبات/ثانية
        if wait > 0:
            time.sleep(wait)
        r = self.s.get(url, timeout=60)
        self._last = time.time()
        if r.status_code == 404:
            return {}
        r.raise_for_status()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(r.text)
        return r.json()

    def ticker_map(self) -> pd.DataFrame:
        js = self._get_json("https://www.sec.gov/files/company_tickers_exchange.json", "tickers.json", 1)
        df = pd.DataFrame(js.get("data", []), columns=js.get("fields", ["cik", "name", "ticker", "exchange"]))
        return df.rename(columns={"ticker": "symbol"})

    def shares_history(self, cik: int) -> pd.DataFrame:
        """سلسلة الأسهم القائمة مع تاريخ الإيداع (filed) — الأساس للقيمة السوقية نقطة-في-الزمن."""
        js = self._get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json", f"facts/{cik}.json")
        rows = []
        facts = js.get("facts", {})
        for ns, tag in (("dei", "EntityCommonStockSharesOutstanding"), ("us-gaap", "CommonStockSharesOutstanding")):
            for unit, items in facts.get(ns, {}).get(tag, {}).get("units", {}).items():
                for it in items:
                    if it.get("val") and it.get("filed"):
                        rows.append((it["filed"], it.get("end"), float(it["val"]), ns))
        df = pd.DataFrame(rows, columns=["filed", "end", "shares", "source"])
        if df.empty:
            return df
        # نفضّل dei (تاريخ الغلاف، الأحدث) ونأخذ آخر قيمة لكل تاريخ إيداع
        df["pri"] = (df["source"] == "dei").astype(int)
        df = df.sort_values(["filed", "pri", "end"]).groupby("filed").tail(1)
        return df[["filed", "shares"]].reset_index(drop=True)

    def dilution_filings(self, cik: int) -> pd.DataFrame:
        js = self._get_json(f"https://data.sec.gov/submissions/CIK{cik:010d}.json", f"subs/{cik}.json", 1)
        blocks = [js.get("filings", {}).get("recent", {})]
        for f in js.get("filings", {}).get("files", []):
            blocks.append(self._get_json(f"https://data.sec.gov/submissions/{f['name']}", f"subs/{f['name']}", 30))
        rows = []
        for b in blocks:
            forms = b.get("form", [])
            for k, form in enumerate(forms):
                items = (b.get("items") or [""] * len(forms))[k] or ""
                if form in DILUTION_FORMS or (form == "8-K" and "3.02" in items):
                    rows.append((form, b["acceptanceDateTime"][k], items))
        df = pd.DataFrame(rows, columns=["form", "accepted", "items"])
        if not df.empty:
            # وقت القبول في EDGAR بتوقيت شرق أمريكا رغم لاحقة Z
            df["accepted"] = pd.to_datetime(df["accepted"].str[:19]).dt.tz_localize(
                "America/New_York", ambiguous="NaT", nonexistent="shift_forward")
        return df


def shares_as_of(hist: pd.DataFrame, date: str) -> float | None:
    """آخر رقم أسهم قائمة أُودع قبل التاريخ (لا بعده)."""
    if hist is None or hist.empty:
        return None
    h = hist[hist["filed"] < date]
    return float(h["shares"].iloc[-1]) if len(h) else None
