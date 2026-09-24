"""محرك الاختبار: يمرّ على الأيام بالترتيب الزمني، ويحاكي كل المتغيّرات على نفس البيانات."""
from __future__ import annotations

from typing import Iterable

import numpy as np
import pandas as pd

from .config import variant_params
from .features import DayData, IntradayCurve, compute_features, to_grid
from .rules import signal_mask
from .execution import simulate_trade


def sig_ts(date: str, i: int) -> pd.Timestamp:
    """لحظة اكتمال الدقيقة i."""
    return pd.Timestamp(f"{date} 09:30", tz="America/New_York") + pd.Timedelta(minutes=i + 1)


def eligible(ctx: dict, cfg: dict) -> bool:
    mc = ctx.get("market_cap")
    if mc is None or not np.isfinite(mc):
        return bool(cfg["universe"]["include_unknown_market_cap"])
    return mc < cfg["universe"]["max_market_cap"]


def run_day(day: DayData, cfg: dict, variants: list[str], curve: IntradayCurve,
            cost_mult: float = 1.0) -> tuple[list[dict], dict]:
    session = cfg["session"]
    params = {v: variant_params(cfg, v) for v in variants}
    cur = curve.curve()
    trades: list[dict] = []
    grids = []
    stats = {"symbols": 0, "eligible": 0, "unknown_mcap": 0}
    for sym, sb in day.bars.groupby("symbol", sort=True):
        stats["symbols"] += 1
        ctx = day.ctx.loc[sym].to_dict() if sym in day.ctx.index else {}
        g = to_grid(sb, day.date)
        grids.append(g)
        mc = ctx.get("market_cap")
        if mc is None or not np.isfinite(mc):
            stats["unknown_mcap"] += 1
        if not eligible(ctx, cfg):
            continue
        stats["eligible"] += 1
        feats = {}
        for vname, (sig, ex) in params.items():
            key = (sig["window_min"], ex["atr_len"])
            if key not in feats:
                feats[key] = compute_features(g, ctx, cur, window=sig["window_min"], atr_len=ex["atr_len"])
            f = feats[key]
            mask = signal_mask(f, sig, ctx, session, day.filings.get(sym), day.date)
            busy_until, last_sig = -1, -10**9
            for i in np.flatnonzero(mask.to_numpy()):
                # إشارة جديدة فقط بعد انتهاء التهدئة وبعد الخروج من الصفقة السابقة
                if i - last_sig <= sig["cooldown_min"] or i <= busy_until:
                    continue
                t = simulate_trade(g, f, int(i), ex, ctx, cfg["costs"], session, cost_mult)
                last_sig = i
                if t is None:
                    continue
                busy_until = t["exit_i"]
                t.update({
                    "variant": vname, "date": day.date, "symbol": sym,
                    "ret_w": float(f["ret_w"].iat[i]),
                    "vol_ratio": float((f["vol_ratio_tod"] if sig["vol_ref"] == "tod" else f["vol_ratio_intraday"]).iat[i]),
                    "dvol_w": float(f["dvol_w"].iat[i]),
                    "day_chg": float(f["day_chg"].iat[i]),
                    "half_spread_bps": ctx.get("half_spread_bps"),
                    "market_cap": ctx.get("market_cap"),
                    # خبر منشور قبل اكتمال دقيقة الإشارة فقط (لا أخبار لاحقة)
                    "has_news": any(pd.Timestamp(ts) <= sig_ts(day.date, int(i)) for ts, _ in day.news.get(sym, [])),
                })
                trades.append(t)
    curve.update(grids)  # بعد انتهاء اليوم فقط، كي لا يتسرب المستقبل
    return trades, stats


def run(days: Iterable[DayData], cfg: dict, variants: list[str], cost_mult: float = 1.0,
        progress: bool = False) -> tuple[pd.DataFrame, pd.DataFrame]:
    curve = IntradayCurve()
    all_trades, day_stats = [], []
    for k, day in enumerate(days):
        tr, st = run_day(day, cfg, variants, curve, cost_mult)
        all_trades.extend(tr)
        st["date"] = day.date
        day_stats.append(st)
        if progress and k % 10 == 0:
            print(f"  {day.date}: {len(tr)} صفقة")
    return pd.DataFrame(all_trades), pd.DataFrame(day_stats)
