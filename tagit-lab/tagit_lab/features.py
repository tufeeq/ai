"""حساب الخصائص اللحظية بطريقة سببية صارمة: قيمة الدقيقة t تُبنى من الدقائق ≤ t فقط.

الشبكة: 390 دقيقة من 09:30 إلى 15:59 (بتوقيت نيويورك). الدقيقة i تمثل الشمعة
التي تبدأ عند 09:30+i وتكتمل عند 09:31+i. الإشارة عند i تُتخذ بعد اكتمالها،
والدخول يكون في الدقيقة i+1 أو بعدها.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

N_MIN = 390
NY = "America/New_York"


def hhmm_to_idx(hhmm: str) -> int:
    h, m = map(int, hhmm.split(":"))
    return (h * 60 + m) - (9 * 60 + 30)


@dataclass
class DayData:
    """بيانات يوم واحد، بنفس الشكل سواء جاءت من Alpaca أو من المولّد المصطنع."""
    date: str
    bars: pd.DataFrame            # symbol, ts, o, h, l, c, v, n, vw
    ctx: pd.DataFrame             # index=symbol: prev_close, adv20, market_cap, half_spread_bps
    filings: dict = field(default_factory=dict)   # symbol -> [pd.Timestamp] إيداعات طرح/تخفيف
    news: dict = field(default_factory=dict)      # symbol -> [(pd.Timestamp, headline)]


def to_grid(sym_bars: pd.DataFrame, date: str) -> pd.DataFrame:
    """يحوّل شموع رمز واحد إلى شبكة 390 دقيقة، والدقائق بلا صفقات حجمها صفر."""
    day_open = pd.Timestamp(f"{date} 09:30", tz=NY)
    ts = pd.to_datetime(sym_bars["ts"])
    if getattr(ts.dt, "tz", None) is None:
        ts = ts.dt.tz_localize("UTC")
    idx = ((ts - day_open) // pd.Timedelta(minutes=1)).to_numpy(dtype=np.int64)
    ok = (idx >= 0) & (idx < N_MIN)
    idx = idx[ok]
    data = {}
    for col in ["o", "h", "l", "c", "vw", "v", "n"]:
        arr = np.full(N_MIN, np.nan if col not in ("v", "n") else 0.0)
        arr[idx] = sym_bars[col].to_numpy(dtype=float)[ok]  # عند التكرار تبقى الأخيرة
        data[col] = arr
    g = pd.DataFrame(data, index=pd.RangeIndex(N_MIN, name="i"))
    g["traded"] = g["v"] > 0
    # الدقائق الخالية: السعر = آخر إغلاق (بلا حركة)، ولا نملأ قبل أول صفقة
    g["c"] = g["c"].ffill()
    for col in ["o", "h", "l"]:
        g[col] = g[col].where(g["traded"], g["c"])
    g["vw"] = g["vw"].where(g["traded"], g["c"])
    return g


def abdi_ranaldo_half_spread_bps(grid: pd.DataFrame) -> float:
    """مقدّر Abdi–Ranaldo (2017) لنصف الفرق من الأعلى/الأدنى/الإغلاق. يعيد NaN عند نقص البيانات."""
    t = grid[grid["traded"]]
    if len(t) < 30:
        return float("nan")
    c = np.log(t["c"].values)
    eta = np.log((t["h"].values + t["l"].values) / 2)
    s2 = 4 * np.mean((c[:-1] - eta[:-1]) * (c[:-1] - eta[1:]))
    s = np.sqrt(max(s2, 0.0))
    return float(s / 2 * 1e4)


class IntradayCurve:
    """منحنى توزيع الحجم خلال اليوم (شكل U)، يُقدَّر من الأيام السابقة فقط."""

    def __init__(self, min_days: int = 5):
        self.sum = np.zeros(N_MIN)
        self.days = 0
        self.min_days = min_days

    @staticmethod
    def default_curve() -> np.ndarray:
        x = np.linspace(0, 1, N_MIN)
        w = 1.0 + 3.0 * np.exp(-x / 0.05) + 1.5 * np.exp(-(1 - x) / 0.04)
        return w / w.sum()

    def curve(self) -> np.ndarray:
        if self.days < self.min_days or self.sum.sum() <= 0:
            return self.default_curve()
        c = self.sum / self.sum.sum()
        # تنعيم خفيف لأن الأسهم الصغيرة متقطعة التداول
        k = np.ones(9) / 9
        sm = np.convolve(np.pad(c, 4, mode="edge"), k, mode="valid")
        return sm / sm.sum()

    def update(self, grids: list[pd.DataFrame]) -> None:
        tot = np.zeros(N_MIN)
        for g in grids:
            v = g["v"].values
            if v.sum() > 0:
                tot += v / v.sum()
        if tot.sum() > 0:
            self.sum += tot / tot.sum()
            self.days += 1


def compute_features(g: pd.DataFrame, ctx: dict, curve: np.ndarray, window: int = 3,
                     atr_len: int = 14) -> pd.DataFrame:
    """كل عمود في الدقيقة i يعتمد على الدقائق 0..i فقط (يُتحقق من ذلك في الاختبارات)."""
    f = pd.DataFrame(index=g.index)
    c = g["c"]
    v = g["v"]
    dv = g["vw"] * v
    f["close"] = c
    f["ret_w"] = c / c.shift(window) - 1
    f["vol_w"] = v.rolling(window).sum()
    f["dvol_w"] = dv.rolling(window).sum()
    f["trades_w"] = g["n"].rolling(window).sum()
    f["conc_w"] = v.rolling(window).max() / f["vol_w"].replace(0, np.nan)
    f["vwap_w"] = f["dvol_w"] / f["vol_w"].replace(0, np.nan)
    f["above_vwap"] = c > f["vwap_w"]
    f["window_low"] = g["l"].rolling(window).min()

    adv = float(ctx.get("adv20") or np.nan)
    flat_ref = adv / N_MIN * window if adv and adv > 0 else np.nan
    # مرجع يومي داخلي: متوسط حجم الدقيقة في الثلاثين دقيقة السابقة للنافذة
    prior = v.shift(window).rolling(30, min_periods=10).mean() * window
    f["vol_ref_intraday"] = prior.fillna(flat_ref)
    # مرجع حسب توقيت اليوم: متوسط الحجم اليومي × حصة هذه الدقائق من منحنى اليوم
    cw = pd.Series(curve, index=g.index).rolling(window).sum()
    f["vol_ref_tod"] = adv * cw if adv and adv > 0 else np.nan
    f["vol_ratio_intraday"] = f["vol_w"] / f["vol_ref_intraday"].replace(0, np.nan)
    f["vol_ratio_tod"] = f["vol_w"] / f["vol_ref_tod"].replace(0, np.nan)

    prev_close = float(ctx.get("prev_close") or np.nan)
    f["day_chg"] = c / prev_close - 1 if prev_close > 0 else np.nan

    prev_c = c.shift(1).fillna(g["o"])
    tr = pd.concat([g["h"] - g["l"], (g["h"] - prev_c).abs(), (g["l"] - prev_c).abs()], axis=1).max(axis=1)
    f["atr"] = tr.rolling(atr_len, min_periods=5).mean()
    f["traded"] = g["traded"]
    return f
