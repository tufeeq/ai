"""يتحقق أن نسخة JavaScript في الواجهة تُنتج الإشارات نفسها التي اختُبرت في Python."""
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from tagit_lab.config import load_config, variant_params
from tagit_lab.features import IntradayCurve, compute_features, to_grid
from tagit_lab.rules import signal_mask
from tagit_lab.synthetic import generate

ROOT = Path(__file__).resolve().parents[1]
CFG = load_config()
FEATS = ["ret_w", "vol_w", "dvol_w", "trades_w", "conc_w", "vwap_w", "vol_ratio_intraday", "vol_ratio_tod", "day_chg", "atr"]
VARIANTS = ["baseline", "rvol_tod", "quality_combo", "skip_open_15", "spread_cap"]


def _clean(a):
    return [None if not np.isfinite(x) else float(x) for x in np.asarray(a, dtype=float)]


@pytest.mark.skipif(shutil.which("node") is None, reason="node غير متوفر")
def test_js_matches_python(tmp_path):
    days = generate(n_symbols=12, n_days=2, burst_rate=4, seed=9)
    cur = IntradayCurve.default_curve()
    cases = []
    for day in days:
        for sym, sb in day.bars.groupby("symbol"):
            ctx = day.ctx.loc[sym].to_dict()
            g = to_grid(sb, day.date)
            f = compute_features(g, ctx, cur)
            exp = {v: signal_mask(f, variant_params(CFG, v)[0], ctx, CFG["session"]).astype(int).tolist() for v in VARIANTS}
            cases.append({
                "grid": {k: _clean(g[k]) for k in ["o", "h", "l", "c", "vw", "v", "n"]} | {"traded": g["traded"].tolist()},
                "ctx": {k: float(ctx[k]) for k in ["prev_close", "adv20", "half_spread_bps"]},
                "feats": {k: _clean(f[k]) for k in FEATS},
                "masks": exp,
            })
    payload = {"curve": cur.tolist(), "session": CFG["session"],
               "sigs": {v: variant_params(CFG, v)[0] for v in VARIANTS}, "cases": cases}
    (tmp_path / "in.json").write_text(json.dumps(payload))
    script = f"""
const T = require({json.dumps(str(ROOT / 'js' / 'tagit-signal.js'))});
const P = JSON.parse(require('fs').readFileSync({json.dumps(str(tmp_path / 'in.json'))}));
let featErr = 0, maskErr = 0, signals = 0;
const num = (a) => a.map((x) => (x === null ? NaN : x));
for (const cs of P.cases) {{
  const g = {{}}; for (const k of ['o','h','l','c','vw','v','n']) g[k] = num(cs.grid[k]); g.traded = cs.grid.traded;
  const f = T.computeFeatures(g, cs.ctx, P.curve);
  for (const [k, exp] of Object.entries(cs.feats)) exp.forEach((e, i) => {{
    const a = f[k][i];
    if (e === null ? Number.isFinite(a) : !(Math.abs(a - e) <= 1e-9 * Math.max(1, Math.abs(e)))) featErr++;
  }});
  for (const [v, exp] of Object.entries(cs.masks)) exp.forEach((e, i) => {{
    const r = T.evaluate(f, i, P.sigs[v], cs.ctx, P.session).pass ? 1 : 0;
    if (r !== e) maskErr++; signals += e;
  }});
}}
console.log(JSON.stringify({{featErr, maskErr, signals}}));
"""
    out = subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout
    res = json.loads(out)
    assert res["signals"] > 20, "الاختبار يحتاج إشارات فعلية ليكون ذا معنى"
    assert res["featErr"] == 0 and res["maskErr"] == 0, res
