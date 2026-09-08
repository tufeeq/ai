#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / 'tag' / 'data' / 'live-quotes.json'
x = json.loads(PATH.read_text(encoding='utf-8'))

clamped = 0

def fix_row(row):
    global clamped
    if not isinstance(row, dict):
        return
    age = row.get('quoteAgeMin')
    try:
        if age is not None and float(age) < 0:
            row['quoteAgeMin'] = 0.0
            clamped += 1
    except Exception:
        pass

quotes = x.get('quotes') or {}
if isinstance(quotes, dict):
    for row in quotes.values():
        fix_row(row)
elif isinstance(quotes, list):
    for row in quotes:
        fix_row(row)

for lane in ('earlyCandidates', 'emergingCandidates', 'accumulationCandidates'):
    for row in x.get(lane) or []:
        fix_row(row)

if x.get('schemaVersion') != 9:
    raise SystemExit('unexpected live schema')
if not x.get('updatedAtUTC') or not isinstance(x.get('quotes'), (dict, list)):
    raise SystemExit('invalid live feed contract')

x['ageClampCount'] = clamped
PATH.write_text(json.dumps(x, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'ageClampCount': clamped, 'quotes': len(quotes)}, ensure_ascii=False))
