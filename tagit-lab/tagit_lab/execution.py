"""محاكاة الدخول والخروج بطريقة Triple Barrier مع تكاليف واقعية ومحافِظة.

قواعد محافِظة (تميل ضد الاستراتيجية عمدًا):
- الدخول عند افتتاح أول دقيقة فيها صفقة بعد الإشارة + نصف الفرق + الانزلاق.
- إن لُمس الوقف والهدف في الدقيقة نفسها يُفترض أن الوقف حدث أولًا.
- الهدف أمر محدد: لا يُحتسب إلا إذا تجاوز الأعلى السعرَ المستهدف (لا مجرد لمسه).
- الوقف والخروج الزمني أوامر سوق: يُخصم نصف الفرق والانزلاق، وفجوة تحت الوقف تُنفّذ بالافتتاح.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .features import hhmm_to_idx


def half_spread_frac(ctx: dict, costs: dict, mult: float = 1.0) -> float:
    hs = ctx.get("half_spread_bps")
    if hs is None or not np.isfinite(hs):
        hs = costs["fallback_half_spread_bps"]
    hs = max(hs, costs["min_half_spread_bps"])
    return (hs + costs["slippage_bps"]) * mult / 1e4


def simulate_trade(g: pd.DataFrame, f: pd.DataFrame, sig_i: int, ex: dict, ctx: dict,
                   costs: dict, session: dict, cost_mult: float = 1.0,
                   entry_override: float | None = None) -> dict | None:
    """يعيد نتيجة صفقة واحدة أو None إذا تعذّر الدخول."""
    n = len(g)
    flat_i = hhmm_to_idx(session["flat_by"])
    # الدخول: أول دقيقة فيها صفقات بعد الإشارة، خلال مهلة محددة
    entry_i = None
    for j in range(sig_i + 1, min(sig_i + 1 + ex["entry_max_wait_min"], n)):
        if g["traded"].iat[j]:
            entry_i = j
            break
    if entry_i is None or entry_i >= flat_i:
        return None

    cost = half_spread_frac(ctx, costs, cost_mult)
    raw_entry = entry_override if entry_override is not None else float(g["o"].iat[entry_i])
    entry = raw_entry * (1 + cost)

    if ex["stop"] == "window_low":
        stop = float(f["window_low"].iat[sig_i]) * 0.999
    else:
        atr = float(f["atr"].iat[sig_i])
        stop = raw_entry - ex["stop_atr_mult"] * atr if np.isfinite(atr) else np.nan
    # حدود دنيا/عليا لمسافة الوقف لتفادي وقف ضيق جدًا أو واسع جدًا
    lo = raw_entry * (1 - ex["max_stop_pct"])
    hi = raw_entry * (1 - ex["min_stop_pct"])
    stop = float(np.clip(stop if np.isfinite(stop) else hi, lo, hi))
    # مسافة R تُحسب من الأسعار الخام (مستقلة عن التكلفة)، والهدف يُقاس من سعر التنفيذ الفعلي كما يفعل المتداول،
    # فيبقى أثر اختبار حساسية التكلفة محصورًا في التكلفة لا في تغيير مسافة الهدف.
    target = entry + ex["target_r"] * (raw_entry - stop)
    risk = entry - stop * (1 - cost)  # الخسارة الصافية لكل سهم إذا نُفّذ الوقف

    last_i = min(entry_i + ex["max_hold_min"] - 1, flat_i, n - 1)
    exit_i, exit_px, reason = last_i, None, "time"
    mfe = mae = 0.0
    for j in range(entry_i, last_i + 1):
        o, h, l = g["o"].iat[j], g["h"].iat[j], g["l"].iat[j]
        if not g["traded"].iat[j]:
            continue
        mfe = max(mfe, h - raw_entry)
        mae = min(mae, l - raw_entry)
        if l <= stop:
            fill = stop if j == entry_i else min(o, stop)
            exit_i, exit_px, reason = j, fill * (1 - cost), "stop"
            break
        if h > target:
            fill = target if j == entry_i else max(o, target)
            exit_i, exit_px, reason = j, fill, "target"
            break
    if exit_px is None:
        exit_px = float(g["c"].iat[last_i]) * (1 - cost)

    ret = exit_px / entry - 1
    return {
        "signal_i": sig_i,
        "entry_i": entry_i,
        "exit_i": exit_i,
        "entry_px": raw_entry,
        "stop_px": stop,
        "target_px": target,
        "exit_reason": reason,
        "ret": ret,
        "r_mult": (exit_px - entry) / risk if risk > 0 else np.nan,
        "mfe_r": mfe / risk if risk > 0 else np.nan,
        "mae_r": mae / risk if risk > 0 else np.nan,
        "hold_min": exit_i - entry_i + 1,
        "cost_round_trip": 2 * cost,
    }
