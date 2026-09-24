"""تنزيل البيانات وتخزينها محليًا (Parquet)، ثم تحميلها يومًا بيوم بصيغة DayData.

بنية المجلد:
  data/calendar.parquet   data/assets.parquet
  data/daily_raw.parquet  data/daily_split.parquet
  data/ctx/YYYY-MM-DD.parquet     (سياق كل رمز مرشّح في ذلك اليوم)
  data/minute/YYYY-MM-DD.parquet  (شموع الدقيقة للرموز المرشّحة فقط)
  data/filings.parquet    data/news/YYYY-MM-DD.parquet
  data/sec/...            (ذاكرة EDGAR)
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterator

import numpy as np
import pandas as pd

from .features import DayData

NY = "America/New_York"


def daily_half_spread_bps(d: pd.DataFrame) -> float:
    """Abdi–Ranaldo على آخر 20 شمعة يومية (الاستخدام الأصلي للمقدّر)."""
    if len(d) < 10:
        return float("nan")
    c = np.log(d["c"].to_numpy())
    eta = np.log(((d["h"] + d["l"]) / 2).to_numpy())
    s2 = 4 * np.mean((c[:-1] - eta[:-1]) * (c[:-1] - eta[1:]))
    return float(np.sqrt(max(s2, 0)) / 2 * 1e4)


def fetch(data_dir: str | Path, start: str, end: str, cfg: dict, with_news: bool = True,
          log=print) -> None:
    from .sources.alpaca import Alpaca
    from .sources.sec import SEC, shares_as_of

    root = Path(data_dir)
    (root / "minute").mkdir(parents=True, exist_ok=True)
    (root / "ctx").mkdir(exist_ok=True)
    (root / "news").mkdir(exist_ok=True)
    ap = Alpaca()
    sec = SEC(root / "sec")

    lookback_start = (pd.Timestamp(start) - pd.Timedelta(days=45)).strftime("%Y-%m-%d")
    cal = ap.calendar(lookback_start, end)
    cal.to_parquet(root / "calendar.parquet")
    assets = ap.assets()
    assets.to_parquet(root / "assets.parquet")
    syms = sorted(assets.loc[assets["exchange"] == cfg["universe"]["exchange"], "symbol"].tolist())
    log(f"رموز {cfg['universe']['exchange']} (نشطة ومشطوبة): {len(syms)}")

    end_ts = f"{end}T23:59:00Z"
    daily_raw = ap.bars(syms, "1Day", f"{lookback_start}T00:00:00Z", end_ts, "raw")
    daily_split = ap.bars(syms, "1Day", f"{lookback_start}T00:00:00Z", end_ts, "split")
    for df in (daily_raw, daily_split):
        df["date"] = df["ts"].dt.tz_convert(NY).dt.strftime("%Y-%m-%d")
    daily_raw.to_parquet(root / "daily_raw.parquet")
    daily_split.to_parquet(root / "daily_split.parquet")
    log(f"شموع يومية: {len(daily_raw):,}")

    # مرشّحو الشرط اللازم فقط: قيمة تداول اليوم ≥ الحد الأدنى
    dr = daily_raw.assign(dv=daily_raw["vw"] * daily_raw["v"])
    cand = dr[dr["dv"] >= cfg["universe"]["min_day_dollar_volume"]]
    tmap = sec.ticker_map().drop_duplicates("symbol").set_index("symbol")["cik"]
    ciks = {s: int(tmap[s]) for s in cand["symbol"].unique() if s in tmap.index}
    log(f"رموز مرشّحة: {cand['symbol'].nunique()} — لها CIK في EDGAR: {len(ciks)}")

    shares = {s: sec.shares_history(c) for s, c in ciks.items()}
    fil = []
    for s, c in ciks.items():
        df = sec.dilution_filings(c)
        if not df.empty:
            fil.append(df.assign(symbol=s))
    filings = pd.concat(fil) if fil else pd.DataFrame(columns=["form", "accepted", "items", "symbol"])
    filings.to_parquet(root / "filings.parquet")

    days = [d for d in cal["date"] if start <= d <= end]
    ds = daily_split.set_index(["symbol", "date"]).sort_index()
    for d in days:
        out_min = root / "minute" / f"{d}.parquet"
        if out_min.exists() and (root / "ctx" / f"{d}.parquet").exists():
            continue
        today = cand[cand["date"] == d]
        ctx_rows = []
        for _, row in today.iterrows():
            s = row["symbol"]
            try:
                hist = ds.loc[s]
            except KeyError:
                continue
            prior = hist[hist.index < d].tail(20)
            if len(prior) < 5 or d not in hist.index:
                continue
            split_today = hist.loc[d]
            basis = row["c"] / split_today["c"] if split_today["c"] > 0 else 1.0  # تحويل للأساس الخام لهذا اليوم
            prev_close = prior["c"].iloc[-1] * basis
            adv20 = prior["v"].mean() / basis
            sh = shares_as_of(shares.get(s), d)
            mc = prev_close * sh if sh else np.nan
            ctx_rows.append({"symbol": s, "prev_close": prev_close, "adv20": adv20, "market_cap": mc,
                             "shares": sh, "half_spread_bps": daily_half_spread_bps(prior)})
        ctx = pd.DataFrame(ctx_rows)
        if ctx.empty:
            pd.DataFrame(columns=["symbol", "prev_close", "adv20", "market_cap", "shares", "half_spread_bps"]).to_parquet(root / "ctx" / f"{d}.parquet")
            pd.DataFrame(columns=["symbol", "ts", "o", "h", "l", "c", "v", "n", "vw"]).to_parquet(out_min)
            continue
        keep = ctx["market_cap"].isna() | (ctx["market_cap"] < cfg["universe"]["max_market_cap"])
        ctx = ctx[keep]
        ctx.to_parquet(root / "ctx" / f"{d}.parquet")
        m = ap.bars(ctx["symbol"].tolist(), "1Min", f"{d}T13:00:00Z", f"{d}T21:30:00Z", "raw")
        m.to_parquet(out_min)
        if with_news:
            ap.news(ctx["symbol"].tolist(), f"{d}T00:00:00Z", f"{d}T21:00:00Z").to_parquet(root / "news" / f"{d}.parquet")
        log(f"{d}: {len(ctx)} رمز، {len(m):,} شمعة دقيقة")


def iter_days(data_dir: str | Path, start: str, end: str, skip_half_days: bool = True) -> Iterator[DayData]:
    root = Path(data_dir)
    cal = pd.read_parquet(root / "calendar.parquet")
    fil_path = root / "filings.parquet"
    filings = pd.read_parquet(fil_path) if fil_path.exists() else pd.DataFrame(columns=["symbol", "accepted"])
    for _, c in cal.iterrows():
        d = c["date"]
        if not (start <= d <= end):
            continue
        if skip_half_days and c["close"] != "16:00":
            continue  # أيام الإغلاق المبكر تُستبعد لأن الجلسة أقصر
        mp, cp = root / "minute" / f"{d}.parquet", root / "ctx" / f"{d}.parquet"
        if not mp.exists() or not cp.exists():
            continue
        bars = pd.read_parquet(mp)
        ctx = pd.read_parquet(cp).set_index("symbol")
        since = pd.Timestamp(d, tz=NY) - pd.Timedelta(days=60)
        f = filings[(filings["accepted"] >= since) & (filings["accepted"] < pd.Timestamp(d, tz=NY) + pd.Timedelta(days=1))]
        fd = {s: list(g["accepted"]) for s, g in f.groupby("symbol")}
        news = {}
        npth = root / "news" / f"{d}.parquet"
        if npth.exists():
            nw = pd.read_parquet(npth)
            news = {s: list(zip(g["ts"], g["headline"])) for s, g in nw.groupby("symbol")}
        yield DayData(date=d, bars=bars, ctx=ctx, filings=fd, news=news)
