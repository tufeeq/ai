"""الإعدادات: كل عتبة ورقم في النظام يأتي من هنا، ويُحفظ مع كل نتيجة."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

DEFAULT_CONFIG: dict = {
    "universe": {
        "exchange": "NASDAQ",
        "max_market_cap": 100_000_000,
        # شرط لازم لأي إشارة (قيمة تداول ≥ 25 ألف في 3 دقائق)، يُستخدم فقط لتقليل التحميل
        "min_day_dollar_volume": 25_000,
        # الرموز بلا CIK في EDGAR لا تُعرف قيمتها السوقية؛ تُستبعد وتُعدّ في التقرير
        "include_unknown_market_cap": False,
    },
    "periods": {
        "dev_start": "2024-07-01",
        "dev_end": "2025-12-31",
        # عينة مختومة: لا يلمسها أي أمر تطوير، وتُفتح مرة واحدة بإعدادات مجمّدة
        "holdout_start": "2026-01-01",
        "holdout_end": "2026-06-30",
    },
    "session": {
        "open": "09:30",
        "close": "16:00",
        "first_signal": "09:33",   # أول 3 دقائق مكتملة
        "last_entry": "15:45",
        "flat_by": "15:58",
    },
    "signal_defaults": {
        "window_min": 3,
        "min_ret": 0.007,
        "min_vol_ratio": 2.0,
        "vol_ref": "intraday",      # intraday | tod (حسب توقيت اليوم)
        "min_dollar_vol": 25_000,
        "min_trades": 30,
        "max_concentration": 0.70,
        "require_above_vwap": True,
        "extended_day": 0.25,
        "extended_window": 0.08,
        "exclude_extended": False,
        "min_price": 0.0,
        "max_price": None,
        "max_half_spread_bps": None,
        "exclude_dilution_days": None,  # استبعاد من لديه إيداع طرح/تخفيف خلال N يومًا
        "skip_first_min": 0,          # تجاهل أول N دقيقة بعد 09:33
        "skip_last_min": 0,           # تجاهل آخر N دقيقة قبل last_entry
        "cooldown_min": 15,
    },
    "exit_defaults": {
        "stop": "atr",           # atr | window_low
        "stop_atr_mult": 1.5,
        "atr_len": 14,
        "min_stop_pct": 0.01,
        "max_stop_pct": 0.10,
        "target_r": 2.0,
        "max_hold_min": 30,
        "entry_max_wait_min": 2,  # إن لم تحدث صفقة خلال دقيقتين بعد الإشارة: لا دخول
    },
    "costs": {
        "min_half_spread_bps": 10,
        "slippage_bps": 10,
        "fallback_half_spread_bps": 50,
        "stress_multipliers": [1.0, 2.0, 3.0],
    },
    "stats": {
        "bootstrap_iters": 5000,
        "seed": 7,
        "min_trades_for_claim": 500,
        "alpha": 0.05,
    },
    "walkforward": {
        "train_months": 6,
        "test_months": 1,
        "min_train_trades": 100,
        "selection_metric": "mean_ret_lcb",  # الحد الأدنى لفاصل الثقة لا المتوسط
    },
    # قائمة المتغيّرات المختبرة. كل متغيّر = تعديل على الإعدادات الافتراضية.
    # عدد هذه القائمة يدخل في تصحيح تعدد الفرضيات، فلا تُضف متغيّرات بلا سبب.
    "variants": {
        "baseline": {},
        "no_extended": {"signal": {"exclude_extended": True}},
        "rvol_tod": {"signal": {"vol_ref": "tod", "min_vol_ratio": 3.0}},
        "price_ge_1": {"signal": {"min_price": 1.0}},
        "spread_cap": {"signal": {"max_half_spread_bps": 75}},
        "no_dilution": {"signal": {"exclude_dilution_days": 30}},
        "skip_open_15": {"signal": {"skip_first_min": 12}},
        "target_1r": {"exit": {"target_r": 1.0}},
        "hold_15": {"exit": {"max_hold_min": 15}},
        "window_low_stop": {"exit": {"stop": "window_low"}},
        # في الأسهم الصغيرة قد تتجاوز تكلفة الذهاب والعودة 1–2٪، فيصبح وقف 1٪ خاسرًا بنيويًا
        "wide_stop": {"exit": {"min_stop_pct": 0.03}},
        "quality_combo": {
            "signal": {
                "exclude_extended": True,
                "vol_ref": "tod",
                "min_vol_ratio": 3.0,
                "min_price": 1.0,
                "max_half_spread_bps": 75,
                "exclude_dilution_days": 30,
            }
        },
    },
}


def deep_merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def load_config(path: str | Path | None = None) -> dict:
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    if path:
        with open(path, encoding="utf-8") as f:
            user = json.load(f)
        # قائمة المتغيّرات تُستبدل كاملة إن وُجدت، كي لا تُختبر متغيّرات بلا قصد
        variants = user.pop("variants", None)
        cfg = deep_merge(cfg, user)
        if variants is not None:
            cfg["variants"] = variants
    return cfg


def variant_params(cfg: dict, name: str) -> tuple[dict, dict]:
    """يعيد (إعدادات الإشارة، إعدادات الخروج) لمتغيّر محدد."""
    if name not in cfg["variants"]:
        raise KeyError(f"متغيّر غير معروف: {name}")
    v = cfg["variants"][name]
    sig = deep_merge(cfg["signal_defaults"], v.get("signal", {}))
    ex = deep_merge(cfg["exit_defaults"], v.get("exit", {}))
    return sig, ex


def config_hash(obj) -> str:
    blob = json.dumps(obj, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:16]
