"""التحقق خارج العينة: walk-forward على فترة التطوير، ثم عينة holdout مختومة تُفتح مرة واحدة."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from .config import config_hash
from .stats import summarize


class HoldoutViolation(RuntimeError):
    pass


def guard_dev_range(cfg: dict, start: str, end: str) -> None:
    """يمنع أي أمر تطوير من لمس بيانات العينة المختومة."""
    hs = cfg["periods"]["holdout_start"]
    if end >= hs or start >= hs:
        raise HoldoutViolation(
            f"النطاق {start}..{end} يتداخل مع العينة المختومة التي تبدأ {hs}. "
            "استخدم أمر holdout بإعدادات مجمّدة."
        )


def walk_forward(trades: pd.DataFrame, cfg: dict) -> dict:
    wf = cfg["walkforward"]
    if trades.empty:
        return {"folds": [], "oos": {"n": 0}}
    t = trades.copy()
    t["month"] = pd.to_datetime(t["date"]).dt.to_period("M")
    months = sorted(t["month"].unique())
    folds, oos = [], []
    for k in range(wf["train_months"], len(months), wf["test_months"]):
        train_m = months[k - wf["train_months"]:k]
        test_m = months[k:k + wf["test_months"]]
        train = t[t["month"].isin(train_m)]
        best, best_score = None, -np.inf
        scores = {}
        for v, tv in train.groupby("variant"):
            if len(tv) < wf["min_train_trades"]:
                continue
            s = summarize(tv, cfg)
            score = s[wf["selection_metric"]]
            scores[v] = round(score, 5)
            if score > best_score:
                best, best_score = v, score
        # إن لم يكن أي متغيّر إيجابيًا بثقة في فترة التدريب، القرار الصحيح هو عدم التداول
        trade_it = best is not None and best_score > 0
        test = t[t["month"].isin(test_m) & (t["variant"] == best)] if best else t.iloc[0:0]
        fold = {
            "train": f"{train_m[0]}..{train_m[-1]}",
            "test": f"{test_m[0]}..{test_m[-1]}",
            "chosen": best,
            "train_score": None if best is None else round(best_score, 5),
            "active": trade_it,
            "train_scores": scores,
            "test_n": int(len(test)),
            "test_mean_ret": float(test["ret"].mean()) if len(test) else None,
            # أداء المتغيّر المختار حتى لو كان القرار عدم التداول، للشفافية
        }
        folds.append(fold)
        if trade_it:
            oos.append(test)
    oos_df = pd.concat(oos) if oos else trades.iloc[0:0]
    return {
        "folds": folds,
        "oos": summarize(oos_df, cfg) if len(oos_df) else {"n": 0},
        "oos_trades": oos_df,
        "stability": {
            "active_folds": int(sum(f["active"] for f in folds)),
            "positive_test_folds": int(sum(1 for f in folds if f["active"] and (f["test_mean_ret"] or 0) > 0)),
        },
    }


def open_holdout(cfg: dict, variant: str, lock_path: str | Path, force: bool = False) -> dict:
    """يختم الإعدادات قبل فتح العينة. أي محاولة ثانية بإعدادات مختلفة تُرفض وتُسجَّل."""
    lock_path = Path(lock_path)
    frozen = {"variant": variant, "variant_def": cfg["variants"][variant],
              "signal_defaults": cfg["signal_defaults"], "exit_defaults": cfg["exit_defaults"],
              "costs": cfg["costs"], "universe": cfg["universe"], "session": cfg["session"],
              "periods": cfg["periods"]}
    h = config_hash(frozen)
    now = datetime.now(timezone.utc).isoformat()
    if lock_path.exists():
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
        if lock["config_hash"] != h and not force:
            lock.setdefault("rejected_attempts", []).append({"at": now, "config_hash": h})
            lock_path.write_text(json.dumps(lock, ensure_ascii=False, indent=2), encoding="utf-8")
            raise HoldoutViolation(
                "العينة المختومة فُتحت سابقًا بإعدادات أخرى "
                f"({lock['config_hash']}). إعادة فتحها بإعدادات معدّلة تُبطل قيمتها كاختبار نهائي."
            )
        lock.setdefault("runs", []).append({"at": now, "config_hash": h, "forced": force})
    else:
        lock = {"config_hash": h, "opened_at": now, "frozen": frozen, "runs": [{"at": now, "config_hash": h}]}
    lock_path.write_text(json.dumps(lock, ensure_ascii=False, indent=2), encoding="utf-8")
    return lock


def verdict(summary: dict, cfg: dict) -> dict:
    """حكم صريح بلا تجميل، وفق معايير القبول."""
    n = summary.get("n", 0)
    need = cfg["stats"]["min_trades_for_claim"]
    lcb = summary.get("mean_ret_ci", [None])[0] if n else None
    if n < need:
        return {"status": "insufficient", "ar": f"العينة غير كافية ({n} من {need} صفقة مطلوبة). لا يمكن الحكم."}
    if lcb is not None and lcb > 0:
        return {"status": "supported", "ar": "متوسط العائد بعد التكلفة موجب، وفاصل الثقة 95% لا يشمل الصفر."}
    if summary["mean_ret"] > 0:
        return {"status": "inconclusive", "ar": "المتوسط موجب لكن فاصل الثقة يشمل الصفر: غير مثبت."}
    return {"status": "rejected", "ar": "متوسط العائد بعد التكلفة غير موجب: القاعدة لا تعمل بصيغتها الحالية."}
