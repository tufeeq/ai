import json

import numpy as np
import pandas as pd
import pytest

from tagit_lab.config import load_config, variant_params
from tagit_lab.engine import run
from tagit_lab.execution import simulate_trade, half_spread_frac
from tagit_lab.features import IntradayCurve, compute_features, to_grid, N_MIN
from tagit_lab.rules import signal_mask
from tagit_lab.stats import benjamini_hochberg, day_block_bootstrap, summarize
from tagit_lab.synthetic import generate
from tagit_lab.validation import HoldoutViolation, guard_dev_range, open_holdout, verdict, walk_forward

CFG = load_config()


def flat_grid(price=10.0, vol=1000.0):
    g = pd.DataFrame({"o": price, "h": price, "l": price, "c": price, "vw": price,
                      "v": vol, "n": 10.0}, index=pd.RangeIndex(N_MIN, name="i"))
    g["traded"] = True
    return g


# --- لا تسرّب من المستقبل ---------------------------------------------------
@pytest.mark.parametrize("cut", [40, 150, 300])
def test_features_and_signals_are_causal(cut):
    day = generate(n_symbols=6, n_days=1, burst_rate=3, seed=3)[0]
    sig, ex = variant_params(CFG, "quality_combo")
    cur = IntradayCurve.default_curve()
    for sym, sb in day.bars.groupby("symbol"):
        ctx = day.ctx.loc[sym].to_dict()
        g1 = to_grid(sb, day.date)
        g2 = g1.copy()
        rng = np.random.default_rng(0)
        # نعبث بكل ما بعد الدقيقة cut
        for col in ["o", "h", "l", "c", "vw"]:
            g2.loc[cut + 1:, col] *= rng.uniform(0.5, 2.0, N_MIN - cut - 1)
        g2.loc[cut + 1:, "v"] *= 50
        f1 = compute_features(g1, ctx, cur)
        f2 = compute_features(g2, ctx, cur)
        pd.testing.assert_frame_equal(f1.loc[:cut], f2.loc[:cut])
        for v in ["baseline", "rvol_tod", "quality_combo"]:
            s, _ = variant_params(CFG, v)
            m1 = signal_mask(f1, s, ctx, CFG["session"])
            m2 = signal_mask(f2, s, ctx, CFG["session"])
            assert (m1.loc[:cut] == m2.loc[:cut]).all()


def test_entry_is_after_signal():
    t, _ = run(generate(n_symbols=10, n_days=3, burst_rate=2), CFG, ["baseline"])
    assert len(t) > 0
    assert (t["entry_i"] > t["signal_i"]).all()
    assert (t["exit_i"] >= t["entry_i"]).all()


# --- منطق الحواجز والتكلفة --------------------------------------------------
def _setup(g):
    ex = dict(CFG["exit_defaults"])
    f = compute_features(g, {"prev_close": 10, "adv20": 390000}, IntradayCurve.default_curve())
    return f, ex


def test_flat_market_loses_exactly_costs():
    g = flat_grid()
    f, ex = _setup(g)
    ctx = {"half_spread_bps": 30}
    t = simulate_trade(g, f, 100, ex, ctx, CFG["costs"], CFG["session"])
    c = half_spread_frac(ctx, CFG["costs"])
    assert t["exit_reason"] == "time"
    assert t["ret"] == pytest.approx((1 - c) / (1 + c) - 1, rel=1e-9)


def test_stop_wins_ties_and_gaps_fill_at_open():
    g = flat_grid()
    f, ex = _setup(g)
    ctx = {"half_spread_bps": 10}
    # الدقيقة 103: تلمس الوقف والهدف معًا → الوقف أولًا
    g.loc[103, ["h", "l"]] = [20.0, 5.0]
    t = simulate_trade(g, f, 100, ex, ctx, CFG["costs"], CFG["session"])
    assert t["exit_reason"] == "stop" and t["exit_i"] == 103
    # فجوة هابطة: الافتتاح تحت الوقف → التنفيذ بالافتتاح لا بالوقف
    g2 = flat_grid()
    g2.loc[103, ["o", "h", "l", "c"]] = [8.0, 8.0, 7.9, 7.95]
    t2 = simulate_trade(g2, f, 100, ex, ctx, CFG["costs"], CFG["session"])
    cst = half_spread_frac(ctx, CFG["costs"])
    assert t2["exit_reason"] == "stop"
    assert t2["ret"] == pytest.approx(8.0 * (1 - cst) / (10 * (1 + cst)) - 1)


def test_target_requires_trade_through():
    g = flat_grid()
    f, ex = _setup(g)
    ctx = {"half_spread_bps": 10}
    t0 = simulate_trade(g, f, 100, ex, ctx, CFG["costs"], CFG["session"])
    g.loc[105, "h"] = t0["target_px"]  # لمس فقط، دون تجاوز
    t1 = simulate_trade(g, f, 100, ex, ctx, CFG["costs"], CFG["session"])
    assert t1["exit_reason"] == "time"
    g.loc[105, "h"] = t0["target_px"] * 1.001
    t2 = simulate_trade(g, f, 100, ex, ctx, CFG["costs"], CFG["session"])
    assert t2["exit_reason"] == "target"
    entry = 10 * (1 + half_spread_frac(ctx, CFG["costs"]))
    assert t2["ret"] == pytest.approx(t0["target_px"] / entry - 1, rel=1e-9)
    assert 0 < t2["r_mult"] < ex["target_r"]  # التكلفة تُنقص R الصافي عن المستهدف الخام


def test_no_entry_without_trades():
    g = flat_grid()
    g.loc[101:110, ["v", "n"]] = 0
    g.loc[101:110, "traded"] = False
    f, ex = _setup(g)
    assert simulate_trade(g, f, 100, ex, {}, CFG["costs"], CFG["session"]) is None


# --- الإحصاء ------------------------------------------------------------------
def test_bootstrap_ci_contains_truth():
    rng = np.random.default_rng(1)
    tr = pd.DataFrame({"date": np.repeat(np.arange(200), 5), "ret": rng.normal(0.002, 0.02, 1000)})
    b = day_block_bootstrap(tr, iters=4000)
    lo, hi = np.quantile(b, [0.025, 0.975])
    assert lo < 0.002 < hi


def test_benjamini_hochberg():
    r = benjamini_hochberg({"a": 0.001, "b": 0.02, "c": 0.04, "d": 0.5}, 0.05)
    assert r == {"a": True, "b": True, "c": False, "d": False}


# --- الختم والعينة المختومة ---------------------------------------------------
def test_holdout_guard_and_lock(tmp_path):
    with pytest.raises(HoldoutViolation):
        guard_dev_range(CFG, "2025-06-01", "2026-02-01")
    guard_dev_range(CFG, "2025-01-01", "2025-12-31")
    lock = tmp_path / "holdout.lock.json"
    open_holdout(CFG, "baseline", lock)
    open_holdout(CFG, "baseline", lock)  # نفس الإعدادات: مسموح ويُسجَّل
    with pytest.raises(HoldoutViolation):
        open_holdout(CFG, "rvol_tod", lock)
    data = json.loads(lock.read_text())
    assert len(data["runs"]) == 2 and len(data["rejected_attempts"]) == 1


# --- المنهجية ككل: لا اكتشاف زائف، ولا إخفاق في كشف ميزة حقيقية ----------------
def test_null_market_is_not_declared_profitable():
    cfg = load_config()
    cfg["stats"]["min_trades_for_claim"] = 100
    cfg["stats"]["bootstrap_iters"] = 2000
    t, _ = run(generate(n_symbols=30, n_days=30, edge=0.0, seed=11), cfg, ["baseline"])
    s = summarize(t, cfg)
    assert verdict(s, cfg)["status"] != "supported"


def test_real_edge_is_detected():
    cfg = load_config()
    cfg["stats"]["min_trades_for_claim"] = 100
    cfg["stats"]["bootstrap_iters"] = 2000
    cfg["costs"]["min_half_spread_bps"] = 5
    t, _ = run(generate(n_symbols=30, n_days=30, edge=0.008, seed=11), cfg, ["baseline"])
    t0, _ = run(generate(n_symbols=30, n_days=30, edge=0.0, seed=11), cfg, ["baseline"])
    assert t["ret"].mean() > t0["ret"].mean() + 0.005
    assert verdict(summarize(t, cfg), cfg)["status"] == "supported"


def test_walk_forward_runs_and_abstains_on_null():
    cfg = load_config()
    cfg["walkforward"].update({"train_months": 1, "min_train_trades": 30})
    cfg["stats"]["bootstrap_iters"] = 500
    t, _ = run(generate(n_symbols=20, n_days=70, edge=0.0, seed=5), cfg, ["baseline", "rvol_tod"])
    wf = walk_forward(t, cfg)
    assert len(wf["folds"]) >= 2
    # في سوق بلا ميزة، القرار الصحيح في معظم الفترات هو الامتناع
    assert wf["stability"]["active_folds"] <= len(wf["folds"]) // 2
