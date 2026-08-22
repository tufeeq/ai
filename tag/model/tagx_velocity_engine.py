#!/usr/bin/env python3
"""TAGX challenger: derive pre-ignition velocity features from consecutive discovery snapshots.

This module is intentionally fail-closed. It never invents missing values and does not
turn a velocity feature into an actionable trade recommendation. It produces telemetry
for champion/challenger evaluation.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import pathlib
import re
import sys
from typing import Any

_SUFFIX = {"K": 1e3, "M": 1e6, "B": 1e9, "T": 1e12}


def number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        x = float(value)
        return x if math.isfinite(x) else None
    s = str(value).strip().replace(",", "").replace("$", "").replace("%", "")
    if not s or s in {"-", "—", "N/A", "None", "null"}:
        return None
    m = re.fullmatch(r"([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([KMBT])?", s, re.I)
    if not m:
        return None
    x = float(m.group(1))
    suffix = (m.group(2) or "").upper()
    return x * _SUFFIX.get(suffix, 1.0)


def parse_ts(value: Any) -> dt.datetime | None:
    if not value:
        return None
    try:
        x = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if x.tzinfo is None:
            x = x.replace(tzinfo=dt.timezone.utc)
        return x.astimezone(dt.timezone.utc)
    except Exception:
        return None


def safe_rate(delta: float | None, minutes: float) -> float | None:
    if delta is None or minutes <= 0:
        return None
    return round(delta / minutes, 6)


def build(current: dict[str, Any], prior: dict[str, Any]) -> dict[str, Any]:
    cur_ts = parse_ts(current.get("snapshotTimestampUTC") or current.get("updatedAt"))
    prev_ts = parse_ts(prior.get("snapshotTimestampUTC") or prior.get("updatedAt"))
    if not cur_ts or not prev_ts:
        raise ValueError("missing/invalid snapshot timestamps")
    elapsed = (cur_ts - prev_ts).total_seconds() / 60.0
    if elapsed <= 0 or elapsed > 30:
        raise ValueError(f"invalid snapshot interval: {elapsed:.2f} minutes")

    prior_rows = {
        str(r.get("Ticker") or "").upper(): r
        for r in prior.get("rows", [])
        if r.get("Ticker")
    }
    output = []
    for row in current.get("rows", []):
        ticker = str(row.get("Ticker") or "").upper()
        old = prior_rows.get(ticker)
        if not ticker or not old:
            continue

        vol, pvol = number(row.get("Volume")), number(old.get("Volume"))
        chg, pchg = number(row.get("Change")), number(old.get("Change"))
        rv, prv = number(row.get("Rel Volume")), number(old.get("Rel Volume"))
        price, pprice = number(row.get("Price")), number(old.get("Price"))
        flt = number(row.get("Float"))

        volume_delta = None if vol is None or pvol is None else max(0.0, vol - pvol)
        change_delta = None if chg is None or pchg is None else chg - pchg
        relvol_delta = None if rv is None or prv is None else rv - prv
        price_delta_pct = None
        if price is not None and pprice not in (None, 0):
            price_delta_pct = (price / pprice - 1.0) * 100.0

        float_turnover = None
        interval_float_capture = None
        if flt and flt > 0:
            if vol is not None:
                float_turnover = vol / flt
            if volume_delta is not None:
                interval_float_capture = volume_delta / flt

        # Pure telemetry score: designed to rank candidates for evaluation, not execution.
        components = []
        vv = safe_rate(volume_delta, elapsed)
        cv = safe_rate(change_delta, elapsed)
        rvv = safe_rate(relvol_delta, elapsed)
        if vv is not None:
            components.append(min(35.0, 7.0 * math.log10(max(vv, 1.0))))
        if cv is not None and cv > 0:
            components.append(min(25.0, cv * 25.0))
        if rvv is not None and rvv > 0:
            components.append(min(20.0, rvv * 20.0))
        if interval_float_capture is not None and interval_float_capture > 0:
            components.append(min(20.0, interval_float_capture * 200.0))
        velocity_score = round(min(100.0, sum(components)), 2)

        output.append({
            "ticker": ticker,
            "elapsedMinutes": round(elapsed, 3),
            "price": price,
            "priceDeltaPct": None if price_delta_pct is None else round(price_delta_pct, 5),
            "changePct": chg,
            "changeDeltaPctPts": None if change_delta is None else round(change_delta, 5),
            "changeVelocityPctPtsPerMin": cv,
            "volume": vol,
            "volumeDelta": volume_delta,
            "volumeVelocityPerMin": vv,
            "relativeVolume": rv,
            "relativeVolumeDelta": None if relvol_delta is None else round(relvol_delta, 5),
            "relativeVolumeVelocityPerMin": rvv,
            "float": flt,
            "floatTurnover": None if float_turnover is None else round(float_turnover, 6),
            "intervalFloatCapture": None if interval_float_capture is None else round(interval_float_capture, 6),
            "velocityScore": velocity_score,
            "originClass": row.get("_originClass"),
            "discoveryLanes": row.get("_discoveryLanes", []),
        })

    output.sort(key=lambda r: r["velocityScore"], reverse=True)
    return {
        "schemaVersion": 1,
        "engine": "TAGX_CHALLENGER_VELOCITY_V1",
        "purpose": "shadow telemetry only; not an execution signal",
        "currentSnapshotUTC": cur_ts.isoformat(),
        "priorSnapshotUTC": prev_ts.isoformat(),
        "elapsedMinutes": round(elapsed, 3),
        "matchedTickers": len(output),
        "top": output[:100],
    }


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: tagx_velocity_engine.py CURRENT PRIOR OUTPUT", file=sys.stderr)
        return 2
    current = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
    prior = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
    result = build(current, prior)
    out = pathlib.Path(sys.argv[3])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: result[k] for k in ("engine", "elapsedMinutes", "matchedTickers")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
