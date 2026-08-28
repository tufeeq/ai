#!/usr/bin/env python3
"""TAGX extended-hours baseline reconciliation.

Repairs a causal data-integrity error where Yahoo chart `previousClose` / `chartPreviousClose`
can refer to the close *before* the immediately preceding regular session during pre-market.
For extended hours, the only admissible comparison baseline is the most recent regular
market price already known at signal time.

No future data is fetched or inferred here. The script only reconciles point-in-time fields
already present in TAGX feeds. Premarket first-observation labels created under a disputed
baseline are fail-closed rather than retrospectively invented.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import pathlib
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[1]
LIVE = ROOT / "tag" / "data" / "live-quotes.json"
PRE = ROOT / "tag" / "data" / "premarket-hot.json"
AUDIT = ROOT / "tag" / "data" / "tagx-extended-baseline-audit.json"


def fnum(v: Any) -> float | None:
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def pct(price: Any, base: Any) -> float | None:
    p, b = fnum(price), fnum(base)
    if p is None or b in (None, 0):
        return None
    return (p - b) / b * 100.0


def load(path: pathlib.Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def dump(path: pathlib.Path, obj: dict) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def recompute_scores(q: dict, change_pct: float | None) -> tuple[int, int]:
    v5 = fnum(q.get("priceVelocity5mPct"))
    v15 = fnum(q.get("priceVelocity15mPct"))
    acc5 = fnum(q.get("volumeAcceleration5m"))
    turn5 = fnum(q.get("turnover5mPctFloat"))
    regime = 0.0
    if v5 is not None:
        regime += max(-12, min(22, v5 * 4.0))
    if v15 is not None:
        regime += max(-8, min(18, v15 * 1.8))
    if acc5 is not None:
        regime += max(-5, min(20, (acc5 - 1) * 8))
    if turn5 is not None:
        regime += min(20, turn5 * 4)
    if change_pct is not None and 2 <= change_pct < 15:
        regime += 12
    if change_pct is not None and change_pct >= 25:
        regime -= 35
    if v5 is not None and v5 < 0:
        regime -= 10
    ers = max(0, min(100, round(40 + regime)))
    ignition = max(
        0,
        min(
            100,
            round(
                ers
                + (8 if v5 is not None and v5 >= 2 else 0)
                + (6 if acc5 is not None and acc5 >= 2 else 0)
                - (20 if change_pct is not None and change_pct >= 20 else 0)
            ),
        ),
    )
    return ers, ignition


def extended_liquidity_verified(q: dict) -> bool:
    vol5 = fnum(q.get("volume5m")) or 0.0
    vol15 = fnum(q.get("volume15m")) or 0.0
    acc5 = fnum(q.get("volumeAcceleration5m"))
    turn5 = fnum(q.get("turnover5mPctFloat"))
    return vol5 > 0 and (
        (acc5 is not None and acc5 >= 1.8)
        or (turn5 is not None and turn5 >= 0.25)
        or vol15 >= 1000
    )


def rebuild_emerging(live: dict) -> list[dict]:
    session = live.get("marketClockSession")
    out: list[dict] = []
    for q in (live.get("quotes") or {}).values():
        ch = fnum(q.get("changePct"))
        v5 = fnum(q.get("priceVelocity5mPct"))
        v15 = fnum(q.get("priceVelocity15mPct"))
        a5 = fnum(q.get("volumeAcceleration5m"))
        turn = fnum(q.get("turnover5mPctFloat"))
        score = fnum(q.get("earlyRegimeShiftScore")) or 0
        if (fnum(q.get("quoteAgeMin")) or 999) > 10 or q.get("session") != session:
            continue
        if ch is None or ch < 1.5 or ch >= 20 or score < 65:
            continue
        if session in ("pre-market", "after-hours"):
            # Extended-hours actionability must not be created by price velocity alone.
            price_persistence = v5 is not None and v5 >= 0.8 and v15 is not None and v15 >= 0.8
            if not price_persistence or not extended_liquidity_verified(q):
                continue
        else:
            if not (
                (v5 is not None and v5 >= 0.8)
                or (a5 is not None and a5 >= 1.8)
                or (turn is not None and turn >= 1.0)
            ):
                continue
        out.append(
            {
                "ticker": q.get("ticker"),
                "price": q.get("price"),
                "changePct": round(ch, 3),
                "priceVelocity5mPct": q.get("priceVelocity5mPct"),
                "priceVelocity15mPct": q.get("priceVelocity15mPct"),
                "volumeAcceleration5m": q.get("volumeAcceleration5m"),
                "turnover5mPctFloat": q.get("turnover5mPctFloat"),
                "earlyRegimeShiftScore": q.get("earlyRegimeShiftScore"),
                "ignitionScore": q.get("ignitionScore"),
                "universeLane": q.get("universeLane"),
                "timestampET": q.get("timestampET"),
                "baselineIntegrity": q.get("baselineIntegrity"),
                "extendedLiquidityVerified": extended_liquidity_verified(q),
            }
        )
    out.sort(key=lambda x: (x.get("earlyRegimeShiftScore") or 0, x.get("ignitionScore") or 0), reverse=True)
    return out[:40]


def reconcile() -> dict:
    live = load(LIVE)
    pre = load(PRE)
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    legacy_candidates = [x.get("ticker") for x in (live.get("emergingCandidates") or [])]
    corrected_live = 0
    material_live = 0
    examples: list[dict] = []

    for ticker, q in (live.get("quotes") or {}).items():
        session = q.get("session")
        if session not in ("pre-market", "after-hours"):
            continue
        baseline = fnum(q.get("regularMarketPrice"))
        px = fnum(q.get("preMarketPrice" if session == "pre-market" else "afterHoursPrice")) or fnum(q.get("price"))
        legacy_base = fnum(q.get("previousClose"))
        if baseline in (None, 0) or px is None:
            q["baselineIntegrity"] = "UNVERIFIED_NO_REGULAR_BASELINE"
            continue
        legacy_change = fnum(q.get("changePct"))
        corrected = pct(px, baseline)
        disagreement = pct(baseline, legacy_base)
        q["sourceReportedPreviousClose"] = legacy_base
        q["baselinePreviousRegularClose"] = baseline
        q["baselineDisagreementPct"] = round(disagreement, 4) if disagreement is not None else None
        q["baselinePolicy"] = "IMMEDIATELY_PRECEDING_REGULAR_SESSION_CLOSE"
        q["baselineIntegrity"] = "VERIFIED_POINT_IN_TIME"
        q["changePct"] = corrected
        if session == "pre-market":
            q["preMarketChangePct"] = corrected
        else:
            q["afterHoursChangePct"] = corrected
        ers, ign = recompute_scores(q, corrected)
        q["earlyRegimeShiftScore"] = ers
        q["ignitionScore"] = ign
        corrected_live += 1
        if legacy_change is not None and corrected is not None and abs(legacy_change - corrected) >= 1.0:
            material_live += 1
            if len(examples) < 12:
                examples.append(
                    {
                        "ticker": ticker,
                        "legacyChangePct": round(legacy_change, 3),
                        "correctedChangePct": round(corrected, 3),
                        "sourcePreviousClose": legacy_base,
                        "previousRegularClose": baseline,
                    }
                )

    live["baselineReconciliation"] = {
        "version": 1,
        "updatedAtUTC": now,
        "policy": "extended-hours uses immediately preceding regular close; no look-ahead",
        "correctedQuoteCount": corrected_live,
        "materialDisagreementCount": material_live,
        "extendedLiquidityGate": "price persistence AND independently observed volume/liquidity evidence",
    }
    rebuilt = rebuild_emerging(live)
    live["emergingCandidates"] = rebuilt
    live["emergingCount"] = len(rebuilt)
    live["challengerPolicy"] = str(live.get("challengerPolicy") or "") + "+CAUSAL_EXTENDED_BASELINE_V1+INDEPENDENT_EXTENDED_LIQUIDITY"

    # Premarket heartbeat v2.3 did not preserve regularMarketPrice. Cross-map the
    # point-in-time regular baseline from live quotes where possible. We correct the
    # current change but invalidate legacy first-observation labels if the baseline
    # disagreement is material; inventing a retroactive crossing time is prohibited.
    pre_corrected = 0
    pre_invalidated = 0
    live_quotes = live.get("quotes") or {}
    for ticker, r in (pre.get("rows") or {}).items():
        lq = live_quotes.get(ticker) or {}
        baseline = fnum(lq.get("regularMarketPrice"))
        px = fnum(r.get("last"))
        legacy_base = fnum(r.get("previousClose"))
        if baseline in (None, 0) or px is None:
            r["baselineIntegrity"] = "UNVERIFIED_NO_MATCHED_REGULAR_BASELINE"
            r["earlyCaptureEligibleAtFirstObservation"] = False
            r["firstObservationUnverified"] = True
            continue
        corrected = pct(px, baseline)
        legacy_ch = fnum(r.get("sessionChangePct"))
        disagreement = pct(baseline, legacy_base)
        r["sourceReportedPreviousClose"] = legacy_base
        r["baselinePreviousRegularClose"] = baseline
        r["baselineDisagreementPct"] = round(disagreement, 4) if disagreement is not None else None
        r["previousClose"] = baseline
        r["sessionChangePct"] = round(corrected, 3) if corrected is not None else None
        r["changeVsPreviousClosePct"] = r["sessionChangePct"]
        r["baselineIntegrity"] = "VERIFIED_CURRENT_OBSERVATION"
        pre_corrected += 1
        if legacy_ch is not None and corrected is not None and abs(legacy_ch - corrected) >= 1.0:
            r["earlyCaptureEligibleAtFirstObservation"] = False
            r["firstObservationUnverified"] = True
            r["firstObservationBand"] = "DATA_UNVERIFIED_LEGACY_BASELINE"
            for key in ("firstCross2UTC", "firstCross5UTC", "firstCross10UTC", "firstCross20UTC"):
                r[key] = None
            r["crossingCensoredBeforeFirstObservation"] = []
            pre_invalidated += 1

    if pre:
        pre.setdefault("causalIntegrity", {})["baselineReconciliationVersion"] = 1
        pre["causalIntegrity"]["legacyFirstObservationsInvalidated"] = pre_invalidated
        pre["causalIntegrity"]["baselinePolicy"] = "IMMEDIATELY_PRECEDING_REGULAR_SESSION_CLOSE"
        pre["causalIntegrity"]["retroactiveCrossingInferenceProhibited"] = True

    new_candidates = [x.get("ticker") for x in rebuilt]
    audit = {
        "schemaVersion": 1,
        "updatedAtUTC": now,
        "status": "APPLIED",
        "rootCause": "Extended-hours change could be computed against Yahoo chartPreviousClose/previousClose from two regular sessions back instead of immediately preceding regular close.",
        "live": {
            "correctedQuoteCount": corrected_live,
            "materialDisagreementCount": material_live,
            "legacyEmerging": legacy_candidates,
            "reconciledEmerging": new_candidates,
            "suppressedEmerging": sorted(set(legacy_candidates) - set(new_candidates)),
            "examples": examples,
        },
        "premarketHeartbeat": {
            "currentObservationsCorrected": pre_corrected,
            "legacyFirstObservationsInvalidated": pre_invalidated,
            "policy": "fail closed on causal first-observation labels when original baseline was materially wrong",
        },
        "lookAhead": "NONE: only point-in-time regularMarketPrice already present in current feed is used.",
    }
    dump(LIVE, live)
    if pre:
        dump(PRE, pre)
    dump(AUDIT, audit)
    return audit


def self_test() -> None:
    # These mirror the observed Aug-28 discrepancy class without using future data.
    assert round(pct(2.9705, 2.94) or 0, 3) == 1.037
    assert round(pct(2.9705, 2.77) or 0, 3) == 7.238
    assert round(pct(7.3585, 7.51) or 0, 3) == -2.017
    assert round(pct(1.24, 1.27) or 0, 3) == -2.362
    q = {"volume5m": 0, "volume15m": 0, "volumeAcceleration5m": None, "turnover5mPctFloat": 0}
    assert extended_liquidity_verified(q) is False
    q2 = {"volume5m": 600, "volume15m": 1500, "volumeAcceleration5m": 2.1, "turnover5mPctFloat": 0.1}
    assert extended_liquidity_verified(q2) is True
    print("TAGX extended baseline reconciliation self-test: PASS")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        self_test()
        return
    print(json.dumps(reconcile(), ensure_ascii=False))


if __name__ == "__main__":
    main()
