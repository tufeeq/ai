"""تقرير عربي (HTML مستقل) + ملف summary.json تقرؤه واجهة TAGit NEXT."""
from __future__ import annotations

import html
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

AR_DIGITS = str.maketrans("0123456789.-", "٠١٢٣٤٥٦٧٨٩٫−")


def ar(x, pct=False, digits=2) -> str:
    if x is None or (isinstance(x, float) and not math.isfinite(x)):
        return "—"
    s = f"{x * 100:.{digits}f}٪" if pct else (f"{x:,.{digits}f}" if isinstance(x, float) else f"{x:,}")
    return f'<span class="n">{s.translate(AR_DIGITS).replace(",", "٬")}</span>'


VARIANT_AR = {
    "baseline": "القاعدة الحالية",
    "no_extended": "استبعاد الحركة الممتدة",
    "rvol_tod": "حجم نسبي حسب توقيت اليوم ≥ ٣",
    "price_ge_1": "سعر ≥ ١ دولار",
    "spread_cap": "نصف فرق ≤ ٧٥ نقطة أساس",
    "no_dilution": "استبعاد إيداعات الطرح (٣٠ يومًا)",
    "skip_open_15": "تجاهل أول ١٥ دقيقة",
    "target_1r": "هدف ١R",
    "hold_15": "احتفاظ أقصى ١٥ دقيقة",
    "window_low_stop": "وقف تحت أدنى النافذة",
    "quality_combo": "مزيج فلاتر الجودة",
    "wide_stop": "وقف أدنى ٣٪ (يراعي التكلفة)",
}

STATUS_AR = {"supported": ("مدعومة إحصائيًا", "ok"), "inconclusive": ("غير حاسمة", "warn"),
             "rejected": ("مرفوضة", "bad"), "insufficient": ("عينة غير كافية", "warn"),
             "abstain": ("امتناع في كل الفترات", "bad")}


def equity_svg(trades: pd.DataFrame, w=640, h=180) -> str:
    if trades is None or trades.empty:
        return ""
    t = trades.sort_values(["date", "signal_i"])
    eq = np.cumsum(t["ret"].to_numpy()) * 100
    y0, y1 = min(0, eq.min()), max(0, eq.max())
    span = (y1 - y0) or 1
    xs = np.linspace(8, w - 8, len(eq))
    ys = h - 16 - (eq - y0) / span * (h - 32)
    zero = h - 16 - (0 - y0) / span * (h - 32)
    pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in zip(xs, ys))
    color = "var(--pos)" if eq[-1] > 0 else "var(--neg)"
    return (f'<svg viewBox="0 0 {w} {h}" class="eq" role="img" aria-label="العائد التراكمي">'
            f'<line x1="8" x2="{w-8}" y1="{zero:.1f}" y2="{zero:.1f}" class="zero"/>'
            f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2"/>'
            f'<text x="{w-8}" y="14" text-anchor="end">مجموع العوائد: {ar(eq[-1] / 100, pct=True)}</text></svg>')


def _variant_table(cmp: pd.DataFrame) -> str:
    rows = []
    for v, r in cmp.sort_values("mean_ret", ascending=False).iterrows():
        ci = r["mean_ret_ci"]
        rows.append(
            f"<tr><td>{html.escape(VARIANT_AR.get(v, v))}</td><td>{ar(int(r['n']))}</td>"
            f"<td>{ar(r['win_rate'], True, 1)}</td><td class='{'pos' if r['mean_ret'] > 0 else 'neg'}'>{ar(r['mean_ret'], True)}</td>"
            f"<td>{ar(ci[0], True)} إلى {ar(ci[1], True)}</td><td>{ar(r['profit_factor'])}</td>"
            f"<td>{ar(r['deflated_sharpe_prob'], True, 0)}</td><td>{'✓' if r['passes_bh'] else '×'}</td></tr>")
    return ("<table><thead><tr><th>المتغيّر</th><th>الصفقات</th><th>نسبة الربح</th><th>متوسط العائد</th>"
            "<th>فاصل ثقة ٩٥٪</th><th>معامل الربح</th><th>شارب مخفّض</th><th>يجتاز BH</th></tr></thead>"
            f"<tbody>{''.join(rows)}</tbody></table>")


def _folds_table(folds: list[dict]) -> str:
    rows = []
    for f in folds:
        chosen = VARIANT_AR.get(f["chosen"], f["chosen"] or "—")
        act = "تداول" if f["active"] else "امتناع"
        rows.append(f"<tr><td><span class='n'>{f['test']}</span></td><td>{html.escape(chosen)}</td><td>{act}</td>"
                    f"<td>{ar(f['train_score'], True) if f['train_score'] is not None else '—'}</td>"
                    f"<td>{ar(f['test_n'])}</td><td>{ar(f['test_mean_ret'], True) if f['test_mean_ret'] is not None else '—'}</td></tr>")
    return ("<table><thead><tr><th>شهر الاختبار</th><th>المتغيّر المختار</th><th>القرار</th>"
            "<th>حد الثقة الأدنى (تدريب)</th><th>صفقات الاختبار</th><th>متوسط الاختبار</th></tr></thead>"
            f"<tbody>{''.join(rows)}</tbody></table>")


def _summary_cards(s: dict, v: dict) -> str:
    label, cls = STATUS_AR.get(v["status"], (v["status"], "warn"))
    if not s.get("n"):
        return f"<div class='verdict {cls}'><b>{label}</b><p>{v['ar']}</p></div>"
    ci = s["mean_ret_ci"]
    return (f"<div class='verdict {cls}'><b>{label}</b><p>{v['ar']}</p></div>"
            "<div class='cards'>"
            f"<div><span>الصفقات</span><b>{ar(s['n'])}</b><small>{ar(s['days'])} يومًا · {ar(s['symbols'])} سهمًا</small></div>"
            f"<div><span>متوسط العائد بعد التكلفة</span><b>{ar(s['mean_ret'], True)}</b><small>فاصل الثقة: {ar(ci[0], True)} إلى {ar(ci[1], True)}</small></div>"
            f"<div><span>نسبة الصفقات الرابحة</span><b>{ar(s['win_rate'], True, 1)}</b><small>ربح {ar(s['avg_win'], True)} · خسارة {ar(s['avg_loss'], True)}</small></div>"
            f"<div><span>معامل الربح</span><b>{ar(s['profit_factor'])}</b><small>متوسط {ar(s['mean_r'])}R</small></div>"
            "</div>")


CSS = """
:root{--bg:#f4f6f8;--card:#fff;--ink:#14202b;--mute:#5b6b78;--line:#dfe5ea;--pos:#0f7b55;--neg:#b3261e;--warn:#9a6700;--acc:#0b5cab}
@media (prefers-color-scheme:dark){:root{--bg:#0e141a;--card:#151d25;--ink:#e6edf3;--mute:#97a6b3;--line:#26323d;--pos:#3fb68b;--neg:#f07167;--warn:#e3b341;--acc:#5aa9ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.7 "IBM Plex Sans Arabic","Noto Sans Arabic",Tahoma,sans-serif}
main{max-width:1000px;margin:auto;padding:24px 16px 60px}h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:32px 0 10px;border-bottom:1px solid var(--line);padding-bottom:6px}
.sub{color:var(--mute);margin:0 0 18px}.banner{background:#fff4d6;color:#5c4200;border:1px solid #e9c46a;padding:10px 14px;border-radius:8px;margin:12px 0}
@media (prefers-color-scheme:dark){.banner{background:#3a2e0b;color:#f3dc9a;border-color:#6b5415}}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden;font-variant-numeric:tabular-nums}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}th{color:var(--mute);font-weight:600;font-size:13px}
.tw{overflow-x:auto}.pos{color:var(--pos)}.neg{color:var(--neg)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin:10px 0}
.cards div{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px}.cards span{display:block;color:var(--mute);font-size:13px}
.cards b{font-size:22px}.cards small{display:block;color:var(--mute)}
.verdict{border-radius:8px;padding:10px 14px;margin:10px 0;border:1px solid var(--line);background:var(--card)}.verdict p{margin:2px 0 0}
.verdict.ok{border-color:var(--pos)}.verdict.ok b{color:var(--pos)}.verdict.bad{border-color:var(--neg)}.verdict.bad b{color:var(--neg)}.verdict.warn{border-color:var(--warn)}.verdict.warn b{color:var(--warn)}
.eq{width:100%;height:auto;background:var(--card);border:1px solid var(--line);border-radius:8px}.eq .zero{stroke:var(--line)}.eq text{fill:var(--mute);font-size:12px}
.n{unicode-bidi:isolate;direction:ltr;display:inline-block}ul{padding-inline-start:20px}li{margin:4px 0}code{background:var(--card);border:1px solid var(--line);padding:0 4px;border-radius:4px}
"""


def build_report(results_dir: str | Path, cfg: dict, synthetic: bool = False) -> Path:
    from .validation import verdict
    rd = Path(results_dir)
    parts = []
    if synthetic:
        parts.append("<div class='banner'><b>بيانات مصطنعة.</b> هذا التقرير ناتج عن سوق محاكى لاختبار المحرك فقط، "
                     "ولا يقول شيئًا عن السوق الحقيقي. شغّل الأوامر على بيانات Alpaca للحصول على نتائج فعلية.</div>")

    cmp_p = rd / "dev_compare.json"
    if cmp_p.exists():
        cmp = pd.read_json(cmp_p, orient="index")
        parts.append("<h2>١. مقارنة المتغيّرات على فترة التطوير</h2>"
                     f"<p class='sub'>عدد المتغيّرات المختبرة: {ar(len(cmp))}، وهذا العدد محسوب في تصحيح تعدد الفرضيات "
                     "(Benjamini–Hochberg ونسبة شارب المخفّضة). فواصل الثقة بإعادة معاينة الأيام لا الصفقات.</p>"
                     f"<div class='tw'>{_variant_table(cmp)}</div>")

    wf_p = rd / "walkforward.json"
    if wf_p.exists():
        wf = json.loads(wf_p.read_text(encoding="utf-8"))
        oos = wf["oos"]
        parts.append("<h2>٢. الاختبار المتدحرج خارج العينة (Walk-Forward)</h2>"
                     "<p class='sub'>كل شهر يُختار المتغيّر بناءً على الأشهر السابقة فقط، ويُمتنع عن التداول إذا لم يكن "
                     "الحد الأدنى لفاصل الثقة موجبًا. هذه أقرب محاكاة لما كان سيحدث فعلًا.</p>")
        parts.append(_summary_cards(oos, wf.get("verdict") or verdict(oos, cfg)))
        oos_p = rd / "walkforward_trades.parquet"
        if oos_p.exists():
            parts.append(equity_svg(pd.read_parquet(oos_p)))
        parts.append(f"<div class='tw'>{_folds_table(wf['folds'])}</div>")

    st_p = rd / "cost_stress.json"
    if st_p.exists():
        st = json.loads(st_p.read_text(encoding="utf-8"))
        rows = "".join(f"<tr><td>×{ar(float(k), digits=1)}</td><td>{ar(v['n'])}</td><td class='{'pos' if v.get('mean_ret', 0) > 0 else 'neg'}'>{ar(v.get('mean_ret'), True)}</td></tr>" for k, v in st["results"].items())
        parts.append(f"<h2>٣. حساسية التكلفة — {html.escape(VARIANT_AR.get(st['variant'], st['variant']))}</h2>"
                     "<p class='sub'>إن اختفت الربحية بمضاعفة التكلفة فهي هشة على الأرجح.</p>"
                     f"<table><thead><tr><th>مضاعف التكلفة</th><th>الصفقات</th><th>متوسط العائد</th></tr></thead><tbody>{rows}</tbody></table>")

    ho_p = rd / "holdout.json"
    if ho_p.exists():
        ho = json.loads(ho_p.read_text(encoding="utf-8"))
        parts.append(f"<h2>٤. العينة المختومة (Holdout) — {html.escape(VARIANT_AR.get(ho['variant'], ho['variant']))}</h2>"
                     f"<p class='sub'>فُتحت بإعدادات مجمّدة (بصمة <code>{ho['config_hash']}</code>) في <span class='n'>{ho['opened_at'][:10]}</span>.</p>")
        parts.append(_summary_cards(ho["summary"], ho["verdict"]))

    fw_p = rd / "forward" / "summary.json"
    if fw_p.exists():
        fw = json.loads(fw_p.read_text(encoding="utf-8"))
        parts.append(f"<h2>٥. المتابعة الحية (Paper Tracking)</h2><p class='sub'>من <span class='n'>{fw.get('since', '—')}</span> حتى <span class='n'>{fw.get('last_date', '—')}</span>؛ "
                     "إشارات حقيقية تُقيَّم آليًا بعد الإغلاق دون أي تعديل على القواعد.</p>")
        parts.append(_summary_cards(fw["summary"], fw["verdict"]))

    parts.append("""<h2>المنهجية وحدود المعلومات</h2><ul>
<li><b>البيانات:</b> شموع دقيقة SIP موحّدة من Alpaca (كل البورصات، مجانًا لما هو أقدم من ١٥ دقيقة)، والأسهم القائمة وإيداعات الطرح من SEC EDGAR بحسب تاريخ إيداعها.</li>
<li><b>الإشارة:</b> تُتخذ بعد اكتمال الدقيقة، والدخول عند افتتاح أول دقيقة تالية فيها تداول، مع نصف الفرق والانزلاق.</li>
<li><b>الخروج:</b> أول ما يحدث من: وقف (افتراضيًا ١٫٥×ATR)، هدف (مضاعف R)، أو حد زمني. إن لُمس الوقف والهدف في الدقيقة نفسها يُحتسب الوقف.</li>
<li><b>التكلفة:</b> نصف الفرق مقدّر بطريقة Abdi–Ranaldo من الشموع اليومية بحد أدنى ١٠ نقاط أساس، إضافة إلى ١٠ نقاط انزلاق لكل اتجاه.</li>
<li><b>الحدود:</b> البورصة المدرجة حسب القائمة الحالية لا التاريخية؛ الرموز بلا CIK تُستبعد؛ القيمة السوقية قد تنحرف إن حدث تقسيم أسهم بين الإيداع والتاريخ؛ أيام الإغلاق المبكر مستبعدة.</li>
<li>لا شيء هنا توصية استثمارية أو ضمان لنتيجة مستقبلية.</li></ul>""")

    doc = (f"<!doctype html><html lang='ar' dir='rtl'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
           f"<title>TAGit Lab تقرير التحقق</title><style>{CSS}</style></head><body><main>"
           f"<h1>تقرير التحقق من منهجية TAGit NEXT</h1><p class='sub'>أُنشئ في <span class='n'>{datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC</span></p>"
           f"{''.join(parts)}</main></body></html>")
    out = rd / "report.html"
    out.write_text(doc, encoding="utf-8")
    return out
