"""سوق مصطنع لاختبار المحرك نفسه — لا لاستخلاص أي نتيجة عن السوق الحقيقي.

يتيح حالتين:
- edge=0: لا ميزة حقيقية بعد الانفجار السعري (الفرضية الصفرية). يجب ألا "يكتشف" المحرك ربحية.
- edge>0: استمرار صعودي حقيقي بعد الانفجار. يجب أن يكتشفه المحرك.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .features import DayData, IntradayCurve, N_MIN

NY = "America/New_York"


def trading_days(start: str, n: int) -> list[str]:
    return [d.strftime("%Y-%m-%d") for d in pd.bdate_range(start, periods=n)]


def generate(n_symbols: int = 40, n_days: int = 60, start: str = "2025-01-02", edge: float = 0.0,
             burst_rate: float = 0.6, seed: int = 1) -> list[DayData]:
    rng = np.random.default_rng(seed)
    curve = IntradayCurve.default_curve()
    syms = [f"SYN{k:03d}" for k in range(n_symbols)]
    price = rng.lognormal(np.log(4), 0.8, n_symbols).clip(0.3, 40)
    base = price.copy()
    shares = rng.uniform(3e6, 40e6, n_symbols)
    adv = rng.uniform(2e5, 3e6, n_symbols)
    sigma = rng.uniform(0.002, 0.006, n_symbols)
    trade_p = rng.uniform(0.35, 0.95, n_symbols)
    hs = rng.uniform(15, 150, n_symbols)
    out = []
    for d in trading_days(start, n_days):
        rows, ctx, filings = [], [], {}
        day_open = pd.Timestamp(f"{d} 09:30", tz=NY)
        for k, s in enumerate(syms):
            prev_close = price[k]
            ret = rng.normal(0, sigma[k], N_MIN)
            vol = rng.poisson(adv[k] * curve * rng.uniform(0.6, 1.6)).astype(float)
            n_b = rng.poisson(burst_rate)
            for _ in range(n_b):
                b = int(rng.integers(10, N_MIN - 60))
                ret[b:b + 3] += rng.uniform(0.004, 0.015)
                vol[b:b + 3] *= rng.uniform(4, 10)
                ret[b + 3:b + 33] += edge + rng.normal(0, sigma[k] * 0.5, 30)
                vol[b + 3:b + 33] *= 2.5
            traded = rng.random(N_MIN) < trade_p[k]
            traded[0] = True
            vol = np.where(traded, np.maximum(vol, 100), 0)
            c = prev_close * np.exp(np.cumsum(ret) + rng.normal(0, 0.01))
            o = np.r_[prev_close, c[:-1]] * np.exp(rng.normal(0, sigma[k] * 0.3, N_MIN))
            hi = np.maximum(o, c) * np.exp(np.abs(rng.normal(0, sigma[k] * 0.6, N_MIN)))
            lo = np.minimum(o, c) * np.exp(-np.abs(rng.normal(0, sigma[k] * 0.6, N_MIN)))
            vw = (o + hi + lo + c) / 4
            ntr = np.where(traded, np.maximum(1, (vol / rng.uniform(150, 400)).round()), 0)
            for i in np.flatnonzero(traded):
                rows.append((s, day_open + pd.Timedelta(minutes=int(i)), o[i], hi[i], lo[i], c[i], vol[i], ntr[i], vw[i]))
            ctx.append({"symbol": s, "prev_close": prev_close, "adv20": adv[k],
                        "market_cap": prev_close * shares[k], "half_spread_bps": hs[k]})
            if rng.random() < 0.01:
                filings[s] = [day_open - pd.Timedelta(hours=int(rng.integers(1, 200)))]
            # ارتداد ليلي نحو السعر الأساسي كي لا تخرج الأسهم من نطاق القيمة السوقية بمرور الوقت
            price[k] = c[-1] * np.exp(-0.5 * np.log(c[-1] / base[k]))
        bars = pd.DataFrame(rows, columns=["symbol", "ts", "o", "h", "l", "c", "v", "n", "vw"])
        out.append(DayData(date=d, bars=bars, ctx=pd.DataFrame(ctx).set_index("symbol"), filings=filings))
    return out
