"""واجهة الأوامر.

  python -m tagit_lab fetch       --start 2024-07-01 --end 2025-12-31
  python -m tagit_lab backtest    --start 2024-07-01 --end 2025-12-31
  python -m tagit_lab walkforward
  python -m tagit_lab stress      --variant baseline
  python -m tagit_lab holdout     --variant <المتغيّر المختار>      (مرة واحدة فقط)
  python -m tagit_lab forward     [--date 2026-09-23]              (يوميًا بعد الإغلاق)
  python -m tagit_lab report
  python -m tagit_lab demo                                          (سوق مصطنع لاختبار المحرك)
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from .config import config_hash, load_config, variant_params
from .engine import run, run_day
from .features import IntradayCurve
from .report import build_report
from .stats import compare_variants, summarize
from .validation import guard_dev_range, open_holdout, verdict, walk_forward


def _dump(obj, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2, default=_jsonable), encoding="utf-8")


def _jsonable(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    return str(o)


def _days(args, cfg, start, end):
    if getattr(args, "synthetic_days", None) is not None:
        return [d for d in args.synthetic_days if start <= d.date <= end]
    from .store import iter_days
    return iter_days(args.data, start, end)


def cmd_backtest(args, cfg):
    start = args.start or cfg["periods"]["dev_start"]
    end = args.end or cfg["periods"]["dev_end"]
    guard_dev_range(cfg, start, end)
    variants = args.variants.split(",") if getattr(args, "variants", None) else list(cfg["variants"])
    trades, day_stats = run(_days(args, cfg, start, end), cfg, variants, progress=not args.quiet)
    out = Path(args.results)
    out.mkdir(parents=True, exist_ok=True)
    trades.to_parquet(out / "dev_trades.parquet")
    day_stats.to_parquet(out / "dev_day_stats.parquet")
    cmp = compare_variants(trades, cfg)
    cmp.to_json(out / "dev_compare.json", orient="index", force_ascii=False, indent=2)
    _dump({"config_hash": config_hash(cfg), "start": start, "end": end, "variants": variants}, out / "dev_meta.json")
    cols = ["n", "win_rate", "mean_ret", "mean_ret_ci", "p_value", "deflated_sharpe_prob", "passes_bh"]
    print(cmp[cols].to_string())


def cmd_walkforward(args, cfg):
    out = Path(args.results)
    trades = pd.read_parquet(out / "dev_trades.parquet")
    wf = walk_forward(trades, cfg)
    wf["oos_trades"].to_parquet(out / "walkforward_trades.parquet")
    res = {k: v for k, v in wf.items() if k != "oos_trades"}
    res["verdict"] = verdict(wf["oos"], cfg)
    if not wf["oos"].get("n") and wf["folds"]:
        res["verdict"] = {"status": "abstain", "ar": "لم يجتز أي متغيّر شرط الثقة في أي فترة تدريب، فكان القرار الصحيح في كل الأشهر هو عدم التداول."}
    _dump(res, out / "walkforward.json")
    print(json.dumps(res["verdict"], ensure_ascii=False), "| OOS n =", wf["oos"].get("n"))


def cmd_stress(args, cfg):
    start, end = args.start or cfg["periods"]["dev_start"], args.end or cfg["periods"]["dev_end"]
    guard_dev_range(cfg, start, end)
    res = {}
    for m in cfg["costs"]["stress_multipliers"]:
        t, _ = run(_days(args, cfg, start, end), cfg, [args.variant], cost_mult=m)
        s = summarize(t, cfg)
        res[str(m)] = {"n": s.get("n", 0), "mean_ret": s.get("mean_ret"), "win_rate": s.get("win_rate")}
        print(f"تكلفة ×{m}: n={s.get('n')}, متوسط={s.get('mean_ret')}")
    _dump({"variant": args.variant, "results": res}, Path(args.results) / "cost_stress.json")


def cmd_holdout(args, cfg):
    out = Path(args.results)
    lock = open_holdout(cfg, args.variant, out / "holdout.lock.json", force=getattr(args, "force", False))
    p = cfg["periods"]
    t, _ = run(_days(args, cfg, p["holdout_start"], p["holdout_end"]), cfg, [args.variant])
    t.to_parquet(out / "holdout_trades.parquet")
    s = summarize(t, cfg)
    v = verdict(s, cfg)
    _dump({"variant": args.variant, "config_hash": lock["config_hash"], "opened_at": lock["opened_at"],
           "summary": s, "verdict": v}, out / "holdout.json")
    print(json.dumps(v, ensure_ascii=False))


def cmd_forward(args, cfg):
    """متابعة حية: يقيّم إشارات يوم منتهٍ بالقواعد المجمّدة ويضيفها إلى السجل الدائم."""
    out = Path(args.results) / "forward"
    out.mkdir(parents=True, exist_ok=True)
    lock_p = Path(args.results) / "holdout.lock.json"
    variant = getattr(args, "variant", None) or (json.loads(lock_p.read_text())["frozen"]["variant"] if lock_p.exists() else "baseline")
    days = list(args.synthetic_days) if getattr(args, "synthetic_days", None) is not None else None
    if days is None:
        from .store import fetch, iter_days
        date = getattr(args, "date", None) or pd.Timestamp.now(tz="America/New_York").strftime("%Y-%m-%d")
        from .sources.alpaca import Alpaca
        calendar = Alpaca().calendar(date, date)
        if calendar.empty or calendar.iloc[0]["close"] != "16:00":
            raise ValueError("Forward evaluation requires a regular trading session")
        close = pd.Timestamp(f'{date} {calendar.iloc[0]["close"]}', tz="America/New_York")
        if close + pd.Timedelta(minutes=16) >= pd.Timestamp.now(tz="UTC"):
            raise ValueError("Session is not complete or its data is not yet available")
        fetch(args.data, date, date, cfg, log=lambda *a: None)
        days = list(iter_days(args.data, date, date))
    tr_p = out / "trades.csv"
    try:
        prev = pd.read_csv(tr_p) if tr_p.exists() else pd.DataFrame()
    except pd.errors.EmptyDataError:
        prev = pd.DataFrame()
    ledger_p = out / "sessions.json"
    ledger = json.loads(ledger_p.read_text()) if ledger_p.exists() else {}
    frozen_hash = config_hash({"variant": variant, "config": cfg})
    if ledger and any(row["config_hash"] != frozen_hash for row in ledger.values()):
        raise ValueError("Forward configuration changed; use a separate results directory")
    curve = IntradayCurve()
    cp = out / "curve.npz"
    if cp.exists():
        z = np.load(cp)
        curve.sum, curve.days = z["sum"], int(z["days"])
    new = []
    for day in days:
        if day.date in ledger or (not prev.empty and day.date in set(prev["date"])):
            continue
        if ledger and day.date < max(ledger):
            raise ValueError("Forward sessions must be evaluated chronologically")
        t, day_stats = run_day(day, cfg, [variant], curve)
        new.extend(t)
        ledger[day.date] = {"config_hash": frozen_hash, "trades": len(t), **day_stats}
    np.savez(cp, sum=curve.sum, days=curve.days)
    allt = pd.concat([prev, pd.DataFrame(new)], ignore_index=True) if new else prev
    allt.to_csv(tr_p, index=False)
    _dump(ledger, ledger_p)
    s = summarize(allt, cfg) if len(allt) else {"n": 0}
    sig, ex = variant_params(cfg, variant)
    _dump({
        "updated": pd.Timestamp.now(tz="UTC").isoformat(), "variant": variant,
        "config_hash": config_hash({"signal": sig, "exit": ex, "costs": cfg["costs"]}),
        "since": str(allt["date"].min()) if len(allt) else None,
        "last_date": max(ledger) if ledger else (str(allt["date"].max()) if len(allt) else None),
        "sessions_evaluated": len(ledger), "feed": "sip", "mode": "retrospective_session_evaluation",
        "last_session_coverage": ledger[max(ledger)] if ledger else None,
        "summary": s, "verdict": verdict(s, cfg),
        "rules": {"signal": sig, "exit": ex},
    }, out / "summary.json")
    print(f"أُضيفت {len(new)} صفقة؛ الإجمالي {len(allt)}")


def cmd_report(args, cfg):
    print(build_report(args.results, cfg, synthetic=getattr(args, "synthetic", False)))


def cmd_demo(args, cfg):
    """تشغيل كامل على سوق مصطنع بلا ميزة حقيقية، للتحقق من أن الأنبوب يعمل ويمتنع بشكل صحيح."""
    from .synthetic import generate
    days = generate(n_symbols=args.symbols, n_days=args.days, edge=args.edge, seed=args.seed)
    dates = [d.date for d in days]
    n = len(dates)
    cfg["periods"] = {"dev_start": dates[0], "dev_end": dates[int(n * 0.6) - 1],
                      "holdout_start": dates[int(n * 0.6)], "holdout_end": dates[int(n * 0.85) - 1]}
    cfg["walkforward"].update({"train_months": 2, "min_train_trades": 60})
    cfg["stats"]["bootstrap_iters"] = 2000
    args.synthetic_days, args.synthetic = days, True
    args.start = args.end = None
    lock = Path(args.results) / "holdout.lock.json"
    if lock.exists():
        lock.unlink()
    for f in (Path(args.results) / "forward").glob("*"):
        f.unlink()
    print("— backtest"); cmd_backtest(args, cfg)
    print("— walkforward"); cmd_walkforward(args, cfg)
    cmp = pd.read_json(Path(args.results) / "dev_compare.json", orient="index")
    best = cmp["mean_ret_lcb"].astype(float).idxmax()
    args.variant = best
    print("— stress", best); cmd_stress(args, cfg)
    print("— holdout", best); cmd_holdout(args, cfg)
    args.synthetic_days = [d for d in days if d.date >= dates[int(n * 0.85)]]
    args.variant = None
    print("— forward"); cmd_forward(args, cfg)
    cmd_report(args, cfg)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="tagit_lab")
    ap.add_argument("--config", default=None)
    ap.add_argument("--data", default="data")
    ap.add_argument("--results", default="results")
    ap.add_argument("--quiet", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("fetch"); p.add_argument("--start", required=True); p.add_argument("--end", required=True)
    p.add_argument("--no-news", action="store_true")
    p = sub.add_parser("backtest"); p.add_argument("--start"); p.add_argument("--end"); p.add_argument("--variants")
    sub.add_parser("walkforward")
    p = sub.add_parser("stress"); p.add_argument("--variant", required=True); p.add_argument("--start"); p.add_argument("--end")
    p = sub.add_parser("holdout"); p.add_argument("--variant", required=True); p.add_argument("--force", action="store_true")
    p = sub.add_parser("forward"); p.add_argument("--date"); p.add_argument("--variant")
    sub.add_parser("report")
    p = sub.add_parser("demo"); p.add_argument("--symbols", type=int, default=40); p.add_argument("--days", type=int, default=160)
    p.add_argument("--edge", type=float, default=0.0); p.add_argument("--seed", type=int, default=21)
    args = ap.parse_args(argv)
    cfg = load_config(args.config)
    if args.cmd == "fetch":
        from .store import fetch
        fetch(args.data, args.start, args.end, cfg, with_news=not args.no_news)
        return
    {"backtest": cmd_backtest, "walkforward": cmd_walkforward, "stress": cmd_stress, "holdout": cmd_holdout,
     "forward": cmd_forward, "report": cmd_report, "demo": cmd_demo}[args.cmd](args, cfg)


if __name__ == "__main__":
    main()
