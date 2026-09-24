"""الإحصاء: فواصل ثقة بإعادة المعاينة حسب اليوم، وتصحيح تعدد الفرضيات، ونسبة شارب المخفّضة.

لماذا حسب اليوم؟ إشارات اليوم الواحد مترابطة (حالة السوق نفسها)، ومعاملتها كمستقلة
تُنتج فواصل ثقة ضيقة زورًا.
"""
from __future__ import annotations

import math
from statistics import NormalDist

import numpy as np
import pandas as pd

_N = NormalDist()


def day_block_bootstrap(trades: pd.DataFrame, col: str = "ret", iters: int = 5000,
                        seed: int = 7) -> np.ndarray:
    g = trades.groupby("date")[col].agg(["sum", "count"])
    s, c = g["sum"].to_numpy(), g["count"].to_numpy()
    if len(s) == 0:
        return np.array([])
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(s), size=(iters, len(s)))
    return s[idx].sum(1) / np.maximum(c[idx].sum(1), 1)


def deflated_sharpe(returns: np.ndarray, n_trials: int, sr_var_across_trials: float) -> float:
    """احتمال أن تكون نسبة شارب الحقيقية > 0 بعد احتساب عدد المحاولات (Bailey & López de Prado 2014)."""
    r = np.asarray(returns, dtype=float)
    T = len(r)
    if T < 10 or r.std(ddof=1) == 0:
        return float("nan")
    sr = r.mean() / r.std(ddof=1)
    skew = float(pd.Series(r).skew())
    kurt = float(pd.Series(r).kurt()) + 3
    if n_trials > 1 and sr_var_across_trials > 0:
        g = 0.5772156649
        sr0 = math.sqrt(sr_var_across_trials) * (
            (1 - g) * _N.inv_cdf(1 - 1 / n_trials) + g * _N.inv_cdf(1 - 1 / (n_trials * math.e))
        )
    else:
        sr0 = 0.0
    denom = 1 - skew * sr + (kurt - 1) / 4 * sr**2
    if denom <= 0:
        return float("nan")
    return float(_N.cdf((sr - sr0) * math.sqrt(T - 1) / math.sqrt(denom)))


def benjamini_hochberg(pvals: dict[str, float], alpha: float) -> dict[str, bool]:
    items = sorted((p, k) for k, p in pvals.items() if np.isfinite(p))
    m = len(items)
    passed, cutoff = {k: False for k in pvals}, -1
    for rank, (p, _) in enumerate(items, 1):
        if p <= alpha * rank / m:
            cutoff = rank
    for rank, (p, k) in enumerate(items, 1):
        passed[k] = rank <= cutoff
    return passed


def summarize(trades: pd.DataFrame, cfg: dict) -> dict:
    st = cfg["stats"]
    if trades.empty:
        return {"n": 0}
    r = trades["ret"].to_numpy()
    wins, losses = r[r > 0], r[r <= 0]
    boot = day_block_bootstrap(trades, "ret", st["bootstrap_iters"], st["seed"])
    a = st["alpha"]
    by_sym = trades.groupby("symbol")["ret"].sum().sort_values(ascending=False)
    total = trades["ret"].sum()
    hour = (trades["signal_i"] // 60).map(lambda h: f"{9 + (30 + 60 * h) // 60:02d}:{(30 + 60 * h) % 60:02d}")
    return {
        "n": int(len(r)),
        "days": int(trades["date"].nunique()),
        "symbols": int(trades["symbol"].nunique()),
        "win_rate": float((r > 0).mean()),
        "mean_ret": float(r.mean()),
        "median_ret": float(np.median(r)),
        "mean_ret_ci": [float(np.quantile(boot, a / 2)), float(np.quantile(boot, 1 - a / 2))],
        "mean_ret_lcb": float(np.quantile(boot, a)),
        "p_value": float((boot <= 0).mean()),  # أحادي الجانب: H0 المتوسط ≤ 0
        "avg_win": float(wins.mean()) if len(wins) else 0.0,
        "avg_loss": float(losses.mean()) if len(losses) else 0.0,
        "profit_factor": float(wins.sum() / -losses.sum()) if losses.sum() < 0 else float("inf"),
        "mean_r": float(trades["r_mult"].mean()),
        "exit_mix": trades["exit_reason"].value_counts(normalize=True).round(4).to_dict(),
        "mfe_r_median": float(trades["mfe_r"].median()),
        "mae_r_median": float(trades["mae_r"].median()),
        "top5_symbols_share_of_pnl": float(by_sym.head(5).sum() / total) if total > 0 else None,
        "by_hour_mean_ret": trades.groupby(hour)["ret"].agg(["mean", "count"]).round(5).to_dict("index"),
        "sufficient_sample": bool(len(r) >= st["min_trades_for_claim"]),
    }


def compare_variants(trades: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    rows = {}
    for v, t in trades.groupby("variant"):
        rows[v] = summarize(t, cfg)
    df = pd.DataFrame(rows).T
    n_trials = len(cfg["variants"])
    srs = {}
    for v, t in trades.groupby("variant"):
        r = t["ret"].to_numpy()
        srs[v] = r.mean() / r.std(ddof=1) if len(r) > 2 and r.std(ddof=1) > 0 else np.nan
    sr_var = float(np.nanvar(list(srs.values()), ddof=1)) if len(srs) > 1 else 0.0
    df["deflated_sharpe_prob"] = [
        deflated_sharpe(trades.loc[trades["variant"] == v, "ret"].to_numpy(), n_trials, sr_var) for v in df.index
    ]
    bh = benjamini_hochberg(df["p_value"].astype(float).to_dict(), cfg["stats"]["alpha"])
    df["passes_bh"] = [bh[v] for v in df.index]
    df["n_trials"] = n_trials
    return df
