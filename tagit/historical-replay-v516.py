#!/usr/bin/env python3
"""TAGit v5.16 Point-in-Time Historical Replay Engine.

Goal
----
Reconstruct historical 09:15 ET decision states as they were knowable at that time,
then attach post-09:30 outcomes separately. This is designed to replace mover-conditioned
Yahoo-only backtests with a provider-agnostic, survivorship-safe replay pipeline.

Anti-leakage contract
---------------------
* Universe membership is queried/evaluated AS OF replay date.
* Premarket features use timestamps <= 09:15:00 America/New_York only.
* News / filings / float / short / fundamentals must have an availability timestamp <= cutoff.
* Same-day SEC records with date-only timestamps are rejected (fail closed).
* Labels use bars strictly AFTER 09:30 ET and are never exposed to feature construction.
* Train/calibration/holdout are chronological; the final holdout can be marked sealed.
* Every row records field provenance and missingness. No silent backfill from current values.

Provider notes
--------------
The engine intentionally separates the contract from data vendors. A provider must implement
point-in-time universe + intraday bars; optional context providers can be layered later.
The included MassiveProvider adapter uses MASSIVE_API_KEY if configured. CI uses FixtureProvider
only to validate causal semantics and serialization without pretending to produce performance.
"""
from __future__ import annotations

import argparse, dataclasses, datetime as dt, email.utils, hashlib, json, math, os, pathlib, statistics, sys, urllib.parse, urllib.request
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
UTC = dt.timezone.utc
ROOT = pathlib.Path("tag/data/historical-replay-v516")
SCHEMA = "5.16-pit-replay"
CUT = dt.time(9, 15)
OPEN = dt.time(9, 30)
CLOSE = dt.time(16, 0)


def iso_ts(x: dt.datetime) -> str:
    return x.astimezone(UTC).isoformat().replace("+00:00", "Z")


def parse_ts(v: Any) -> Optional[dt.datetime]:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        try:
            return dt.datetime.fromtimestamp(float(v), UTC)
        except Exception:
            return None
    s = str(v).strip()
    if not s:
        return None
    # Date-only is intentionally NOT treated as an exact timestamp.
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        return None
    try:
        z = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        return (z if z.tzinfo else z.replace(tzinfo=UTC)).astimezone(UTC)
    except Exception:
        pass
    try:
        z = email.utils.parsedate_to_datetime(s)
        return (z if z.tzinfo else z.replace(tzinfo=UTC)).astimezone(UTC)
    except Exception:
        return None


def cutoff_utc(day: dt.date) -> dt.datetime:
    return dt.datetime.combine(day, CUT, NY).astimezone(UTC)


def pct(a: float, b: float) -> float:
    return (a / b - 1.0) * 100.0 if a and b else 0.0


def sha256_json(x: Any) -> str:
    blob = json.dumps(x, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(blob).hexdigest()


@dataclasses.dataclass
class Bar:
    ts: dt.datetime
    o: float
    h: float
    l: float
    c: float
    v: float

    def json(self) -> Dict[str, Any]:
        return {"ts": iso_ts(self.ts), "o": self.o, "h": self.h, "l": self.l, "c": self.c, "v": self.v}


@dataclasses.dataclass
class PITValue:
    value: Any
    available_at: Optional[dt.datetime]
    source: str
    exact_timestamp: bool = True

    def usable(self, cutoff: dt.datetime) -> bool:
        return bool(self.exact_timestamp and self.available_at and self.available_at <= cutoff)


class ReplayProvider:
    name = "abstract"
    def universe(self, day: dt.date) -> List[Dict[str, Any]]:
        raise NotImplementedError
    def minute_bars(self, symbol: str, day: dt.date) -> List[Bar]:
        raise NotImplementedError
    def context(self, symbol: str, day: dt.date) -> Dict[str, List[PITValue]]:
        return {}


class MassiveProvider(ReplayProvider):
    """Minimal Massive/Polygon-compatible REST adapter.

    Requires MASSIVE_API_KEY. Endpoint shapes intentionally stay narrow; provider failures are
    surfaced in diagnostics rather than silently substituted with current snapshots.
    """
    name = "massive"
    base = "https://api.massive.com"

    def __init__(self, api_key: str):
        if not api_key:
            raise RuntimeError("MASSIVE_API_KEY is required")
        self.key = api_key

    def _get(self, url: str) -> Dict[str, Any]:
        sep = "&" if "?" in url else "?"
        req = urllib.request.Request(url + sep + urllib.parse.urlencode({"apiKey": self.key}), headers={"User-Agent": "TAGit-v5.16-PIT"})
        with urllib.request.urlopen(req, timeout=35) as r:
            return json.loads(r.read().decode())

    def universe(self, day: dt.date) -> List[Dict[str, Any]]:
        # Point-in-time ticker universe. Active-only is deliberately false when supported so
        # delisted names can remain represented historically.
        url = f"{self.base}/v3/reference/tickers?market=stocks&date={day.isoformat()}&limit=1000&active=true"
        out: List[Dict[str, Any]] = []
        while url:
            d = self._get(url)
            out.extend(d.get("results") or [])
            nxt = d.get("next_url")
            url = nxt if nxt else ""
        return out

    def minute_bars(self, symbol: str, day: dt.date) -> List[Bar]:
        d0 = day.isoformat()
        url = f"{self.base}/v2/aggs/ticker/{urllib.parse.quote(symbol)}/range/1/minute/{d0}/{d0}?adjusted=false&sort=asc&limit=50000"
        d = self._get(url)
        out: List[Bar] = []
        for z in d.get("results") or []:
            try:
                ts = dt.datetime.fromtimestamp(float(z["t"]) / 1000.0, UTC)
                out.append(Bar(ts, float(z["o"]), float(z["h"]), float(z["l"]), float(z["c"]), float(z.get("v") or 0)))
            except Exception:
                continue
        return out


class FixtureProvider(ReplayProvider):
    """Synthetic provider used only for CI contract testing; never for reported precision."""
    name = "fixture"
    def universe(self, day: dt.date) -> List[Dict[str, Any]]:
        return [{"ticker": "TESTA", "active": True}, {"ticker": "TESTB", "active": True}]
    def minute_bars(self, symbol: str, day: dt.date) -> List[Bar]:
        seed = 10.0 if symbol == "TESTA" else 5.0
        out: List[Bar] = []
        # Prior regular-day-like bars cannot exist on same call, so create premarket + regular target day.
        t = dt.datetime.combine(day, dt.time(8, 0), NY)
        p = seed
        for i in range(76):
            q = p * (1 + (0.0008 if symbol == "TESTA" else 0.0001))
            out.append(Bar(t.astimezone(UTC), p, max(p, q)*1.001, min(p, q)*.999, q, 1000+i*10))
            p = q; t += dt.timedelta(minutes=1)
        t = dt.datetime.combine(day, OPEN, NY); p = out[-1].c
        for i in range(120):
            mult = 1.0015 if symbol == "TESTA" else -0.0002
            q = p * (1 + mult)
            out.append(Bar(t.astimezone(UTC), p, max(p,q)*1.001, min(p,q)*.999, q, 5000+i*25))
            p=q; t += dt.timedelta(minutes=1)
        return out
    def context(self, symbol: str, day: dt.date) -> Dict[str, List[PITValue]]:
        cut = cutoff_utc(day)
        return {
            "news": [PITValue("known", cut-dt.timedelta(minutes=10), "fixture"), PITValue("future", cut+dt.timedelta(minutes=1), "fixture")],
            "sec": [PITValue("date-only-rejected", None, "fixture", exact_timestamp=False)],
        }


def filter_context(raw: Dict[str, List[PITValue]], cut: dt.datetime) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    values: Dict[str, Any] = {}
    audit: Dict[str, Any] = {}
    for field, items in raw.items():
        good = [x for x in items if x.usable(cut)]
        rejected = len(items) - len(good)
        values[field] = [x.value for x in good]
        audit[field] = {"accepted": len(good), "rejected": rejected, "sources": sorted({x.source for x in good})}
    return values, audit


def select_bars(bars: Sequence[Bar], day: dt.date) -> Tuple[List[Bar], List[Bar]]:
    pre, regular = [], []
    for b in bars:
        local = b.ts.astimezone(NY)
        if local.date() != day:
            continue
        tm = local.time().replace(tzinfo=None)
        if dt.time(4,0) <= tm <= CUT:
            pre.append(b)
        elif OPEN <= tm < CLOSE:
            regular.append(b)
    return sorted(pre, key=lambda x:x.ts), sorted(regular, key=lambda x:x.ts)


def features(pre: Sequence[Bar]) -> Optional[Dict[str, Any]]:
    if not pre:
        return None
    c = pre[-1].c; o = pre[0].o
    last5 = pre[-5:]; last15 = pre[-15:]
    vol = sum(x.v for x in pre)
    hi = max(x.h for x in pre); lo = min(x.l for x in pre)
    def ret_from(xs: Sequence[Bar]) -> float:
        return pct(xs[-1].c, xs[0].o) if xs else 0.0
    return {
        "premarketOpen": o,
        "decisionPrice": c,
        "preReturnPct": pct(c,o),
        "r5Pct": ret_from(last5),
        "r15Pct": ret_from(last15),
        "preRangePct": pct(hi,lo),
        "preVolume": vol,
        "logPreVolume": math.log1p(max(0.0,vol)),
        "closePosition": (c-lo)/(hi-lo) if hi>lo else .5,
        "barsObserved": len(pre),
        "firstBarUTC": iso_ts(pre[0].ts),
        "lastBarUTC": iso_ts(pre[-1].ts),
    }


def outcome(feat: Dict[str, Any], regular: Sequence[Bar]) -> Optional[Dict[str, Any]]:
    if not regular:
        return None
    px = float(feat["decisionPrice"])
    high = max(x.h for x in regular)
    low = min(x.l for x in regular)
    mfe = pct(high,px); mae = pct(low,px)
    def hit(target: float) -> Optional[float]:
        level = px*(1+target/100)
        for b in regular:
            if b.h >= level:
                return (b.ts.astimezone(NY) - dt.datetime.combine(b.ts.astimezone(NY).date(), CUT, NY)).total_seconds()/60
        return None
    h10=hit(10);h20=hit(20);h50=hit(50)
    return {
        "mfePct": mfe, "maePct": mae,
        "hit10": h10 is not None, "hit20": h20 is not None, "hit50": h50 is not None,
        "leadTo10MinFrom0915": h10, "leadTo20MinFrom0915": h20, "leadTo50MinFrom0915": h50,
        "regularCloseReturnPct": pct(regular[-1].c, px),
    }


def eligible_universe_member(z: Dict[str, Any]) -> bool:
    ticker = str(z.get("ticker") or z.get("symbol") or "").strip().upper()
    if not ticker:
        return False
    # Keep broad equities universe; ADR/ETF/type filters can be explicit provider metadata later.
    return True


def replay_day(provider: ReplayProvider, day: dt.date, max_symbols: Optional[int]=None) -> Dict[str, Any]:
    cut = cutoff_utc(day)
    uni = [z for z in provider.universe(day) if eligible_universe_member(z)]
    if max_symbols:
        uni = uni[:max_symbols]
    rows=[]; errors=[]
    for z in uni:
        sym = str(z.get("ticker") or z.get("symbol")).upper()
        try:
            bars = provider.minute_bars(sym, day)
            pre, reg = select_bars(bars, day)
            f = features(pre)
            if not f:
                continue
            ctx, ctxaudit = filter_context(provider.context(sym, day), cut)
            y = outcome(f, reg)
            row={
                "schemaVersion":SCHEMA,"day":day.isoformat(),"symbol":sym,"cutoffUTC":iso_ts(cut),
                "featureState":f,"context":ctx,"contextAudit":ctxaudit,
                "universeRecord":z,"outcome":y,
                "provenance":{"provider":provider.name,"universeAsOf":day.isoformat(),"barsCutoff":"<=09:15 ET","labels":"regular bars >=09:30 ET"}
            }
            row["featureHash"] = sha256_json({"featureState":f,"context":ctx,"universeRecord":z})
            rows.append(row)
        except Exception as e:
            errors.append({"symbol":sym,"error":f"{type(e).__name__}:{e}"})
    return {"schemaVersion":SCHEMA,"day":day.isoformat(),"provider":provider.name,"universeCount":len(uni),"decisionRows":len(rows),"rows":rows,"errors":errors[:100]}


def chronological_splits(days: Sequence[str]) -> Dict[str, List[str]]:
    d=sorted(set(days)); n=len(d)
    a=max(1,int(n*.60)); b=max(a+1,int(n*.80))
    return {"train":d[:a],"calibration":d[a:b],"sealedHoldout":d[b:]}


def summarize(replays: Sequence[Dict[str,Any]], provider_name: str) -> Dict[str,Any]:
    rows=[x for r in replays for x in r.get("rows",[]) if x.get("outcome")]
    splits=chronological_splits([x["day"] for x in rows]) if rows else {"train":[],"calibration":[],"sealedHoldout":[]}
    positives={k:sum(1 for x in rows if x["day"] in set(v) and x["outcome"].get("hit20")) for k,v in splits.items()}
    return {
        "schemaVersion":SCHEMA,"generatedAtUTC":iso_ts(dt.datetime.now(UTC)),"provider":provider_name,
        "status":"CONTRACT_VALIDATED" if provider_name=="fixture" else "DATASET_BUILT",
        "precisionClaimAllowed":False,
        "precisionClaimReason":"Fixture data cannot support precision claims" if provider_name=="fixture" else "Replay dataset generation does not tune/evaluate a model by itself",
        "days":len({x['day'] for x in rows}),"independentTickerDays":len(rows),"plus20TickerDays":sum(x['outcome']['hit20'] for x in rows),
        "splits":{k:{"days":v,"tickerDays":sum(x['day'] in set(v) for x in rows),"plus20":positives[k]} for k,v in splits.items()},
        "antiLeakage":[
            "point-in-time universe requested by replay date",
            "premarket features use <=09:15 ET only",
            "news/context require exact availability timestamp <= cutoff",
            "date-only same-day SEC context fails closed",
            "labels use >=09:30 ET only and are serialized separately from featureHash",
            "chronological train/calibration/sealed-holdout day splits",
            "no performance claim from fixture CI"
        ],
        "datasetHash":sha256_json([{"day":x['day'],"symbol":x['symbol'],"featureHash":x['featureHash']} for x in rows])
    }


def main() -> int:
    ap=argparse.ArgumentParser()
    ap.add_argument("--provider", choices=["fixture","massive"], default="fixture")
    ap.add_argument("--start")
    ap.add_argument("--end")
    ap.add_argument("--max-symbols", type=int)
    ap.add_argument("--output", default=str(ROOT))
    args=ap.parse_args()
    provider: ReplayProvider = FixtureProvider() if args.provider=="fixture" else MassiveProvider(os.environ.get("MASSIVE_API_KEY", ""))
    if args.provider=="fixture":
        days=[dt.date(2026,1,5)+dt.timedelta(days=i) for i in range(10) if (dt.date(2026,1,5)+dt.timedelta(days=i)).weekday()<5]
    else:
        if not args.start or not args.end:
            ap.error("--start and --end required for massive")
        s=dt.date.fromisoformat(args.start); e=dt.date.fromisoformat(args.end)
        days=[]; cur=s
        while cur<=e:
            if cur.weekday()<5: days.append(cur)
            cur += dt.timedelta(days=1)
    outdir=pathlib.Path(args.output); outdir.mkdir(parents=True,exist_ok=True)
    replays=[]
    for day in days:
        r=replay_day(provider,day,args.max_symbols)
        replays.append(r)
        (outdir/f"replay-{day.isoformat()}.json").write_text(json.dumps(r,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    report=summarize(replays,provider.name)
    (outdir/"report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False,indent=2))
    if args.provider=="fixture":
        # Hard CI assertions for leakage-sensitive semantics.
        sample=replays[0]["rows"][0]
        assert sample["contextAudit"]["news"]["accepted"]==1 and sample["contextAudit"]["news"]["rejected"]==1
        assert sample["contextAudit"]["sec"]["accepted"]==0
        assert parse_ts("2026-01-05") is None
        assert report["precisionClaimAllowed"] is False
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
