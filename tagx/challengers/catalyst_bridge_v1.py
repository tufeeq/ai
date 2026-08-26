#!/usr/bin/env python3
"""TAGX Catalyst Bridge challenger.

Purpose: rescue fresh-catalyst symbols that are visible in enrichment/news but absent
from the standard discovery universe. This is CHALLENGER-ONLY: it never promotes a
symbol to production eligibility and never bypasses Sharia/data-quality gates.

Observe -> Detect -> Cross-Validate -> Challenge -> Rank -> Track.
No third-party dependency is required.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

LATE_PCT = 30.0
PRIMARY_NEWS_SOURCES = {
    "GlobeNewswire", "Business Wire", "PR Newswire", "Reuters", "SEC",
    "Nasdaq", "Stock Titan", "Yahoo Finance",
}


def num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace("%", "").replace(",", "").replace("$", "").strip())
    except (TypeError, ValueError):
        return None


def parse_time(v: Any) -> datetime | None:
    if not v:
        return None
    s = str(v).strip()
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        try:
            d = parsedate_to_datetime(s)
        except (TypeError, ValueError, OverflowError):
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def stage(change: float | None) -> str:
    if change is None:
        return "DATA"
    if change < 2:
        return "DISCOVERY"
    if change < 8:
        return "WAKE-UP"
    if change < 18:
        return "PRE-IGNITION"
    if change < LATE_PCT:
        return "IGNITION"
    return "LATE"


def freshest_news(items: list[dict[str, Any]], now: datetime, max_hours: float) -> tuple[dict[str, Any] | None, float | None]:
    best = None
    best_age = None
    for item in items or []:
        ts = parse_time(item.get("published") or item.get("timestamp") or item.get("publishedAt"))
        if not ts:
            continue
        age = (now - ts).total_seconds() / 3600
        if age < -0.25 or age > max_hours:
            continue
        if best_age is None or age < best_age:
            best, best_age = item, age
    return best, best_age


def confidence(row: dict[str, Any], catalyst: dict[str, Any] | None) -> int:
    s = 0
    price = row.get("price") or {}
    if num(price.get("last")) is not None:
        s += 25
    if parse_time(price.get("timestampUTC")):
        s += 15
    if catalyst:
        s += 25
        if str(catalyst.get("source") or "") in PRIMARY_NEWS_SOURCES:
            s += 15
    if row.get("identity"):
        s += 10
    if not row.get("errors"):
        s += 10
    return max(0, min(100, s))


def risk_score(row: dict[str, Any], catalyst: dict[str, Any] | None, change: float | None) -> int:
    s = 25
    if not row.get("identity"):
        s += 15
    if row.get("errors"):
        s += 10
    source = str((catalyst or {}).get("source") or "")
    if catalyst and source not in PRIMARY_NEWS_SOURCES:
        s += 15
    if change is None:
        s += 25
    elif change >= LATE_PCT:
        s += 25
    return max(0, min(100, s))


def build(discovery: dict[str, Any], enrichment: dict[str, Any], max_hours: float, now: datetime) -> dict[str, Any]:
    discovered = {str(r.get("Ticker") or "").upper() for r in discovery.get("rows", []) if r.get("Ticker")}
    rows = enrichment.get("rows") or {}
    out: list[dict[str, Any]] = []

    for ticker, row in rows.items():
        t = str(ticker).upper()
        catalyst, age_h = freshest_news(row.get("news") or [], now, max_hours)
        if not catalyst:
            continue
        price = row.get("price") or {}
        change = num(price.get("changePct"))
        st = stage(change)
        conf = confidence(row, catalyst)
        risk = risk_score(row, catalyst, change)
        missing = t not in discovered
        action = "TRACK_ONLY"
        if missing and st in {"DISCOVERY", "WAKE-UP", "PRE-IGNITION", "IGNITION"} and conf >= 55:
            action = "CHALLENGER_RESCUE"
        elif st == "LATE":
            action = "REPLAY_ONLY"

        out.append({
            "ticker": t,
            "missingFromDiscovery": missing,
            "stage": st,
            "changePct": change,
            "last": num(price.get("last")),
            "catalystAgeHours": None if age_h is None else round(age_h, 3),
            "catalystTimestamp": catalyst.get("published") or catalyst.get("timestamp") or catalyst.get("publishedAt"),
            "catalystSource": catalyst.get("source"),
            "catalystTitle": catalyst.get("title"),
            "dataConfidence": conf,
            "riskScore": risk,
            "action": action,
            "trace": {
                "raisedBy": ["FreshCatalyst", "PriceDislocation"] + (["DiscoveryGap"] if missing else []),
                "loweredBy": (["IdentityUnverified"] if not row.get("identity") else [])
                    + (["SourceError"] if row.get("errors") else [])
                    + (["LateMove"] if st == "LATE" else []),
                "productionEligible": False,
                "requiresShariaGate": True,
                "requiresFinalReconciliation": True,
            },
        })

    out.sort(key=lambda x: (
        x["action"] != "CHALLENGER_RESCUE",
        -(x["dataConfidence"] - x["riskScore"]),
        x["catalystAgeHours"] if x["catalystAgeHours"] is not None else 999,
    ))
    return {
        "schemaVersion": 1,
        "challenger": "catalyst-bridge-v1",
        "generatedAtUTC": now.isoformat(),
        "policy": {
            "productionEligible": False,
            "freshCatalystMaxHours": max_hours,
            "lateMovePct": LATE_PCT,
            "shariaGateRequiredBeforePromotion": True,
            "finalReconciliationRequiredBeforeTrainingTruth": True,
        },
        "stats": {
            "discoveryUniverse": len(discovered),
            "enrichmentRows": len(rows),
            "catalystRows": len(out),
            "missingFromDiscovery": sum(1 for x in out if x["missingFromDiscovery"]),
            "challengerRescues": sum(1 for x in out if x["action"] == "CHALLENGER_RESCUE"),
            "lateReplayOnly": sum(1 for x in out if x["action"] == "REPLAY_ONLY"),
        },
        "rows": out,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--discovery", default="tag/data/discovery.json")
    ap.add_argument("--enrichment", default="tag/data/enrichment.json")
    ap.add_argument("--output", default="tag/data/challenger-catalyst-bridge.json")
    ap.add_argument("--max-catalyst-hours", type=float, default=12.0)
    args = ap.parse_args()
    discovery = json.loads(Path(args.discovery).read_text())
    enrichment = json.loads(Path(args.enrichment).read_text())
    payload = build(discovery, enrichment, args.max_catalyst_hours, datetime.now(timezone.utc))
    p = Path(args.output)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(payload["stats"], separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
