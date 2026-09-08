#!/usr/bin/env python3
"""Normalize human-formatted discovery inputs inside the Actions workspace.

The source files themselves are not committed by the live workflow; this only makes
Volume/Float numeric before live-engine-v9.py consumes them.
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'tag' / 'data'
FILES = [
    DATA / 'finviz.json',
    DATA / 'discovery-fast.json',
    DATA / 'discovery.json',
    DATA / 'premarket-hot.json',
]


def scaled(v):
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        x = float(v)
        return x if math.isfinite(x) else None
    s = str(v).strip().replace(',', '').replace('$', '').replace('%', '')
    if not s or s.lower() in {'none', 'null', 'nan', '-'}:
        return None
    mult = 1.0
    if s[-1:].upper() in {'K', 'M', 'B', 'T'}:
        mult = {'K': 1e3, 'M': 1e6, 'B': 1e9, 'T': 1e12}[s[-1].upper()]
        s = s[:-1]
    try:
        x = float(s) * mult
        return x if math.isfinite(x) else None
    except Exception:
        return None


def float_millions(v):
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        x = float(v)
        return x if math.isfinite(x) else None
    s = str(v).strip().replace(',', '').replace('$', '').replace('%', '')
    if not s or s.lower() in {'none', 'null', 'nan', '-'}:
        return None
    unit = s[-1:].upper()
    try:
        if unit == 'K':
            return float(s[:-1]) / 1_000.0
        if unit == 'M':
            return float(s[:-1])
        if unit == 'B':
            return float(s[:-1]) * 1_000.0
        if unit == 'T':
            return float(s[:-1]) * 1_000_000.0
        return float(s)
    except Exception:
        return None


def rows_of(obj):
    if not isinstance(obj, dict):
        return []
    rows = obj.get('rows') or obj.get('data') or []
    if isinstance(rows, dict):
        return list(rows.values())
    return rows if isinstance(rows, list) else []


stats = {'files': 0, 'volumeNormalized': 0, 'floatNormalized': 0}
for path in FILES:
    if not path.exists():
        continue
    try:
        obj = json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        continue
    touched = False
    for row in rows_of(obj):
        if not isinstance(row, dict):
            continue
        if row.get('Volume') is not None:
            x = scaled(row.get('Volume'))
            if x is not None and row.get('Volume') != x:
                row['Volume'] = x
                stats['volumeNormalized'] += 1
                touched = True
        if row.get('Float') is not None:
            x = float_millions(row.get('Float'))
            if x is not None and row.get('Float') != x:
                row['Float'] = x
                stats['floatNormalized'] += 1
                touched = True
        if row.get('floatM') is not None:
            x = float_millions(row.get('floatM'))
            if x is not None and row.get('floatM') != x:
                row['floatM'] = x
                stats['floatNormalized'] += 1
                touched = True
    if touched:
        path.write_text(json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    stats['files'] += 1

print(json.dumps(stats, ensure_ascii=False))
