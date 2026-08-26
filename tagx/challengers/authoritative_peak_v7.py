#!/usr/bin/env python3
import argparse, datetime as dt, json
from pathlib import Path


def load(path):
    p = Path(path)
    if not p.exists() or not p.stat().st_size:
        return {}
    return json.loads(p.read_text(encoding="utf-8"))


def rows(payload):
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in ("rows", "data", "results", "stocks", "items", "records", "topMovers"):
        if isinstance(payload.get(key), list):
            return payload[key]
    return []


def ticker(r):
    return str(r.get("Ticker") or r.get("ticker") or r.get("Symbol") or r.get("symbol") or "").upper().strip()


def num(v):
    try:
        return float(str(v).replace("%", "").replace(",", "").replace("$", "").strip())
    except Exception:
        return None


def stamp(payload):
    if not isinstance(payload, dict):
        return None
    return payload.get("snapshotTimestampET") or payload.get("updatedAtET") or payload.get("updatedAt") or payload.get("snapshotTimestampUTC")


def current_map(payload):
    return {ticker(r): r for r in rows(payload) if ticker(r)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--standard", default="tag/data/discovery.json")
    ap.add_argument("--fast", default="tag/data/discovery-fast.json")
    ap.add_argument("--v6", default="tag/data/tagx-signal-ledger-v6-challenger.json")
    ap.add_argument("--out", default="tag/data/tagx-authoritative-peak-v7-challenger.json")
    args = ap.parse_args()

    standard, fast, v6 = load(args.standard), load(args.fast), load(args.v6)
    if not standard and not fast:
        raise SystemExit("both proactive feeds unavailable")
    if not isinstance(v6, dict) or v6.get("schemaVersion") != 6:
        raise SystemExit("v6 authoritative origin ledger unavailable")

    stdm, fastm = current_map(standard), current_map(fast)
    day = v6.get("sessionDateET") or (stamp(standard) or stamp(fast) or "")[:10]
    if not day:
        raise SystemExit("session date unavailable")

    outp = Path(args.out)
    old = load(outp) if outp.exists() else {}
    if old.get("sessionDateET") != day or old.get("schemaVersion") != 7:
        old = {"schemaVersion": 7, "sessionDateET": day, "tickers": {}, "snapshots": []}
    state = old.setdefault("tickers", {})

    def observe(t, r, source, ts):
        ch = num(r.get("Change") if r.get("Change") not in (None, "") else r.get("changePct"))
        if ch is None:
            return
        e = state.setdefault(t, {"ticker": t})
        peak = e.get("sessionPeakChangePct")
        if peak is None or ch > peak:
            e["sessionPeakChangePct"] = ch
            e["sessionPeakSeenET"] = ts
            e["sessionPeakSource"] = source
        trough = e.get("sessionMinChangePct")
        if trough is None or ch < trough:
            e["sessionMinChangePct"] = ch
            e["sessionMinSeenET"] = ts
        e["lastChangePct"] = ch
        e["lastSeenET"] = ts
        e["seenByStandardPeakTrack"] = e.get("seenByStandardPeakTrack", False) or source == "standard"
        e["seenByFastPeakTrack"] = e.get("seenByFastPeakTrack", False) or source == "fast"

    stdts, fastts = stamp(standard), stamp(fast)
    for t, r in stdm.items():
        observe(t, r, "standard", stdts)
    for t, r in fastm.items():
        observe(t, r, "fast", fastts)

    evaluated = []
    fast_peak_rescues = 0
    reset_risks = 0
    early_with_safe_peak = 0
    for x in v6.get("currentTop20") or []:
        t = x.get("ticker")
        e = state.get(t, {})
        peak = e.get("sessionPeakChangePct")
        current = num(x.get("changePct"))
        give = (peak - current) if peak is not None and current is not None else None
        klass = x.get("class")
        risk = "NONE"
        if peak is not None and peak >= 50:
            risk = "EXHAUSTION_PEAK"
        elif peak is not None and peak >= 25 and give is not None and give >= 8:
            risk = "RUNNER_RESET_DISTRIBUTION"
        elif peak is not None and peak >= 25:
            risk = "LATE_PEAK_MEMORY"
        elif peak is not None and peak >= 15 and give is not None and give >= 8:
            risk = "WEAK_RETENTION"
        if risk != "NONE":
            reset_risks += 1
        if e.get("sessionPeakSource") == "fast" and not e.get("seenByStandardPeakTrack"):
            fast_peak_rescues += 1
        if klass == "PREDICTED_EARLY_LT10" and (peak is None or peak < 25):
            early_with_safe_peak += 1
        evaluated.append({
            **x,
            "sessionPeakChangePct": peak,
            "sessionPeakSeenET": e.get("sessionPeakSeenET"),
            "sessionPeakSource": e.get("sessionPeakSource"),
            "peakGivebackPts": round(give, 2) if give is not None else None,
            "peakMemoryRisk": risk,
        })

    old.update({
        "schemaVersion": 7,
        "sessionDateET": day,
        "updatedAtUTC": dt.datetime.now(dt.timezone.utc).isoformat(),
        "authority": "CHALLENGER_DUAL_LANE_ORIGIN_PLUS_DUAL_LANE_PEAK_MEMORY",
        "trainingEligible": False,
        "groundTruthEligible": False,
        "standardSnapshotET": stdts,
        "fastSnapshotET": fastts,
        "top20Count": len(evaluated),
        "runnerResetRiskCount": reset_risks,
        "fastOnlyPeakRescues": fast_peak_rescues,
        "earlyUnder10WithPeakBelow25Count": early_with_safe_peak,
        "currentTop20": evaluated,
        "tickers": state,
        "measurementPolicy": "Signal-time only. Earliest origin comes from v6 standard+fast ledger; session peak is accumulated only from proactive snapshots observed up to each run. Reactive Top-20 remains evaluation-only.",
    })
    snaps = old.setdefault("snapshots", [])
    snaps.append({
        "timestampET": max([x for x in (stdts, fastts) if x], default=None),
        "top20Count": len(evaluated),
        "runnerResetRiskCount": reset_risks,
        "fastOnlyPeakRescues": fast_peak_rescues,
        "earlyUnder10WithPeakBelow25Count": early_with_safe_peak,
    })
    old["snapshots"] = snaps[-500:]
    outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text(json.dumps(old, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "top20": len(evaluated),
        "runnerResetRiskCount": reset_risks,
        "fastOnlyPeakRescues": fast_peak_rescues,
        "earlyUnder10WithPeakBelow25Count": early_with_safe_peak,
    }))


if __name__ == "__main__":
    main()
