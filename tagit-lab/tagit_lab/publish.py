"""Export real research results and a credential-free connection check for TAGit NEXT."""
from __future__ import annotations
import argparse
import json
import shutil
from pathlib import Path
import pandas as pd
from .config import load_config, config_hash
from .sources.alpaca import Alpaca


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    # pandas normalizes NaN/Infinity to JSON null for browser consumers.
    path.write_text(pd.Series(value).to_json(force_ascii=False, indent=2), encoding="utf-8")


def probe(path):
    result = {"checked_at": pd.Timestamp.now(tz="UTC").isoformat(), "provider": "Alpaca",
              "feed": "sip", "minimum_delay_minutes": 16, "approved_for_live": False}
    try:
        ap = Alpaca()
        today = pd.Timestamp.now(tz="UTC")
        end = (today - pd.Timedelta(days=1)).strftime("%Y-%m-%dT00:00:00Z")
        start = (today - pd.Timedelta(days=8)).strftime("%Y-%m-%dT00:00:00Z")
        bars = ap.bars(["AAPL"], "1Day", start, end)
        cal = ap.calendar(start[:10], end[:10])
        result.update(status="CONNECTED" if len(bars) and len(cal) else "NO_DATA",
                      sample_bars=len(bars), calendar_sessions=len(cal),
                      last_bar_at=bars["ts"].max().isoformat() if len(bars) else None,
                      transport="Render relay" if ap.proxy else "Direct server credentials")
    except Exception as error:
        code = str(error)
        allowed = {"FEED_NOT_ENTITLED", "PROVIDER_AUTH_FAILED", "RUNTIME_CREDENTIALS_NOT_CONFIGURED"}
        result.update(status=code if code in allowed else "CONNECTION_FAILED", error_type=type(error).__name__)
    write(path, result)
    print(json.dumps(result, ensure_ascii=False))
    return result


def latest_session():
    now = pd.Timestamp.now(tz="America/New_York")
    cal = Alpaca().calendar((now-pd.Timedelta(days=10)).strftime("%Y-%m-%d"), now.strftime("%Y-%m-%d"))
    completed = [row["date"] for _, row in cal.iterrows()
                 if pd.Timestamp(f'{row["date"]} {row["close"]}', tz="America/New_York") < now-pd.Timedelta(minutes=16)
                 and row["close"] == "16:00"]
    if not completed:
        raise RuntimeError("No completed regular session")
    return max(completed)


def export(results, public):
    results, public = Path(results), Path(public)
    public.mkdir(parents=True, exist_ok=True)
    cfg = load_config()
    data = {"schema_version": 1, "published_at": pd.Timestamp.now(tz="UTC").isoformat(),
            "config_hash": config_hash(cfg), "periods": cfg["periods"],
            "variants": list(cfg["variants"]), "minimum_trades": cfg["stats"]["min_trades_for_claim"],
            "profitability_claim_allowed": False, "execution": "RESEARCH_ONLY"}
    for key, filename in {"connection": "connection.json", "development": "dev_compare.json",
                           "development_meta": "dev_meta.json", "walkforward": "walkforward.json",
                           "stress": "cost_stress.json", "holdout": "holdout.json",
                           "forward": "forward/summary.json"}.items():
        p = results / filename
        if p.exists():
            data[key] = json.loads(p.read_text())
    report = results / "report.html"
    if report.exists():
        shutil.copyfile(report, public / "report.html")
        data["report_available"] = True
    trade_file = results / "forward/trades.csv"
    if trade_file.exists():
        try:
            trades = pd.read_csv(trade_file)
            cols = [c for c in ["date", "symbol", "variant", "ret", "entry_px", "stop_px", "target_px", "exit_reason"] if c in trades]
            data["recent_trades"] = json.loads(trades[cols].tail(50).to_json(orient="records"))
        except pd.errors.EmptyDataError:
            data["recent_trades"] = []
    write(public / "summary.json", data)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--results", default="results")
    p.add_argument("--public", default="../tagit-next/lab/results")
    p.add_argument("--probe", action="store_true")
    p.add_argument("--latest-session", action="store_true")
    args = p.parse_args()
    if args.latest_session:
        print(latest_session())
        return
    if args.probe:
        probe(Path(args.results) / "connection.json")
    export(args.results, args.public)


if __name__ == "__main__":
    main()
