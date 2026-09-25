"""Reproducible diagnostic, explicitly not an out-of-sample strategy validation."""
import argparse
import hashlib
import json
import gzip
from collections import Counter
from dataclasses import asdict
from datetime import timedelta
from pathlib import Path
from engine import Config, Detector, simulate, timestamp, ET


def run(data):
    cfg = Config()
    engine = Detector(data['metadata'], cfg, retrospective_metadata=True)
    events = sorted((timestamp(b['timestamp']), s, b) for s, bars in data['bars'].items() for b in bars)
    signals, rejections = [], Counter()
    for start, symbol, bar in events:
        signal = engine.on_bar(symbol, bar, (start+timedelta(minutes=1)).isoformat())
        if signal:
            signals.append(simulate(signal, data['bars'][symbol], cfg))
        else:
            rejections[engine.decisions[symbol]['reason']] += 1
    days = sorted({start.astimezone(ET).date().isoformat() for start, _, _ in events})
    daily = []
    for day in days:
        rows = [s for s in signals if timestamp(s['at']).astimezone(ET).date().isoformat() == day]
        outcomes = Counter(s['outcome'] for s in rows)
        resolved = [s['net_pct'] for s in rows if s['net_pct'] is not None]
        daily.append(dict(date=day, setups=len(rows), symbols=len({s['symbol'] for s in rows}),
                          outcomes=dict(outcomes), resolved=len(resolved),
                          mean_net_pct=round(sum(resolved)/len(resolved),4) if resolved else None,
                          positive_net=len([x for x in resolved if x>0])))
    return dict(version='NEXT-0.1', mode='HISTORICAL_DIAGNOSTIC', approved_for_live=False,
                model_status='UNVALIDATED_HYPOTHESES', source=data['source'], feed=data['feed'],
                data_end=data['end'], selection=data['selection'], metadata_source=data['metadata_source'],
                limitations=['Outcome-selected sample; cannot estimate market-wide precision or recall.',
                             'Final historical bars may contain revisions unavailable in real time.',
                             'Current metadata is retrospective, not historical point-in-time membership.',
                             'No historical bid/ask replay; fills are approximations, not executable trade evidence.',
                             'September 14 ends before the closing bell; incomplete outcomes remain unresolved.',
                             'No parameters fitted or selected from these results; no training claimed.'],
                config=asdict(cfg), input_sha256=hashlib.sha256(json.dumps(data,sort_keys=True).encode()).hexdigest(),
                symbols=len(data['bars']), bars=len(events), days=daily,
                rejection_counts=dict(rejections), signals=signals)


if __name__ == '__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--input',default='data/diagnostic-input.json.gz')
    p.add_argument('--output',default='data/report.json')
    a=p.parse_args()
    raw=gzip.decompress(Path(a.input).read_bytes()).decode() if a.input.endswith('.gz') else Path(a.input).read_text()
    report=run(json.loads(raw))
    Path(a.output).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ['bars','symbols','days','rejection_counts']},indent=2))
