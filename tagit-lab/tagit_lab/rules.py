"""قواعد الإشارة. baseline يطابق المنهجية المنشورة في TAGit NEXT حرفيًا قدر الإمكان."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .features import hhmm_to_idx


def signal_mask(f: pd.DataFrame, sig: dict, ctx: dict, session: dict,
                dilution_times: list | None = None, date: str | None = None) -> pd.Series:
    """قناع منطقي: هل تتحقق شروط الإشارة عند اكتمال الدقيقة i؟ (قبل تطبيق فترة التهدئة)"""
    ratio = f["vol_ratio_tod"] if sig["vol_ref"] == "tod" else f["vol_ratio_intraday"]
    m = (
        (f["ret_w"] >= sig["min_ret"])
        & (ratio >= sig["min_vol_ratio"])
        & (f["dvol_w"] >= sig["min_dollar_vol"])
        & (f["trades_w"] >= sig["min_trades"])
        & (f["conc_w"] <= sig["max_concentration"])
        & f["traded"]
    )
    if sig.get("require_above_vwap", True):
        m &= f["above_vwap"]
    if sig.get("exclude_extended"):
        ext = (f["day_chg"] > sig["extended_day"]) | (f["ret_w"] > sig["extended_window"])
        m &= ~ext.fillna(False)
    if sig.get("min_price"):
        m &= f["close"] >= sig["min_price"]
    if sig.get("max_price"):
        m &= f["close"] <= sig["max_price"]
    if sig.get("max_half_spread_bps") is not None:
        hs = ctx.get("half_spread_bps")
        if hs is None or not np.isfinite(hs) or hs > sig["max_half_spread_bps"]:
            m &= False

    first = hhmm_to_idx(session["first_signal"]) - 1 + int(sig.get("skip_first_min", 0))
    last = hhmm_to_idx(session["last_entry"]) - 1 - int(sig.get("skip_last_min", 0))
    idx = f.index.to_numpy()
    m &= pd.Series((idx >= first) & (idx <= last), index=f.index)

    nd = sig.get("exclude_dilution_days")
    if nd and dilution_times and date:
        # إيداع طرح/تخفيف خلال N يومًا قبل الدقيقة (ويشمل إيداعات اليوم نفسه قبل وقت الإشارة)
        day_open = pd.Timestamp(f"{date} 09:30", tz="America/New_York")
        minute_ts = day_open + pd.to_timedelta(idx + 1, unit="min")
        blocked = np.zeros(len(idx), dtype=bool)
        for t in dilution_times:
            t = pd.Timestamp(t)
            t = t.tz_localize("UTC").tz_convert("America/New_York") if t.tzinfo is None else t.tz_convert("America/New_York")
            blocked |= (minute_ts >= t) & (minute_ts <= t + pd.Timedelta(days=nd))
        m &= pd.Series(~blocked, index=f.index)
    return m.fillna(False).astype(bool)


def apply_cooldown(mask: pd.Series, cooldown: int) -> list[int]:
    """يحوّل القناع إلى أحداث مستقلة: إشارة واحدة لكل موجة، ثم تهدئة N دقيقة."""
    out, last = [], -10**9
    for i in np.flatnonzero(mask.to_numpy()):
        if i - last > cooldown:
            out.append(int(mask.index[i]))
            last = i
    return out
