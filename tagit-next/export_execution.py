"""Publish the exact frozen diagnostic, retaining every scenario and unknown."""
import argparse
from pathlib import Path
ROOT = Path(__file__).resolve().parent
source = ROOT / 'data/execution-latency-report.json'
target = ROOT / 'web/execution-latency.json'
if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.check:
        if not target.exists() or target.read_bytes() != source.read_bytes():
            raise SystemExit('Public execution report differs from frozen diagnostic')
    else:
        target.write_bytes(source.read_bytes())
