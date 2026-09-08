#!/usr/bin/env python3
import json, subprocess, math
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'tag' / 'data'
FINVIZ = DATA / 'finviz.json'
OUT = DATA / 'tagit-top50-audit.json'


def load(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except Exception:
        return default


def parse_ts(v):
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace('Z', '+00:00'))
    except Exception:
        return None


def num(v):
    if v is None:
        return None
    try:
        s = str(v).strip().replace('%','').replace(',','').replace('$','')
        if not s or s.lower() in ('none','null','nan','-'):
            return None
        x = float(s)
        return x if math.isfinite(x) else None
    except Exception:
        return None


def sym(r):
    return str(r.get('Ticker') or r.get('ticker') or r.get('Symbol') or r.get('symbol') or '').strip().upper()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True, stderr=subprocess.DEVNULL)


def get_snapshot(sha):
    try:
        return json.loads(git('show', f'{sha}:tag/data/live-quotes.json'))
    except Exception:
        return None


def candidate_rows(fin):
    rows = fin.get('rows') or fin.get('data') or []
    lane = [r for r in rows if 'finviz_topgainers' in (r.get('_sourceTags') or [])]
    chosen = lane if len(lane) >= 50 else rows
    valid = []
    for r in chosen:
        t = sym(r); ch = num(r.get('Change') if r.get('Change') is not None else r.get('changePct'))
        if t and ch is not None:
            valid.append((t, ch, r))
    valid.sort(key=lambda x: x[1], reverse=True)
    out=[]; seen=set()
    for item in valid:
        if item[0] in seen: continue
        seen.add(item[0]); out.append(item)
        if len(out) == 50: break
    return out, ('finviz_topgainers' if len(lane) >= 50 else 'finviz_merged_rows')


def main():
    fin = load(FINVIZ, {}) or {}
    benchmark_ts = parse_ts(fin.get('updatedAt') or fin.get('updatedAtUTC') or fin.get('generatedAtUTC'))
    if benchmark_ts is None:
        raise SystemExit('Finviz benchmark timestamp unavailable')

    top50, benchmark_lane = candidate_rows(fin)
    if len(top50) < 50:
        raise SystemExit(f'Only {len(top50)} benchmark symbols available; need 50')
    top_set = {t for t,_,_ in top50}

    day_start = benchmark_ts.replace(hour=0, minute=0, second=0, microsecond=0)
    commits = git('log', '--format=%H', f'--since={day_start.isoformat()}', f'--until={benchmark_ts.isoformat()}', '--', 'tag/data/live-quotes.json').splitlines()

    detected = {}
    snapshots_used = 0
    for sha in reversed(commits):
        snap = get_snapshot(sha)
        if not snap: continue
        snap_ts = parse_ts(snap.get('updatedAtUTC'))
        if snap_ts is None or snap_ts > benchmark_ts or snap_ts.date() != benchmark_ts.date():
            continue
        snapshots_used += 1
        for channel_key, channel_name in (
            ('earlyCandidates','EARLY'),
            ('accumulationCandidates','ACCUMULATION'),
            ('emergingCandidates','EMERGING'),
        ):
            for r in (snap.get(channel_key) or []):
                t = sym(r)
                if not t: continue
                rec = detected.get(t)
                if rec is None:
                    rec = {
                        'symbol': t,
                        'firstDetectedAtUTC': snap_ts.isoformat(),
                        'firstDetectedChangePct': num(r.get('changePct')),
                        'firstChannel': channel_name,
                        'channels': [channel_name],
                        'lastDetectedAtUTC': snap_ts.isoformat(),
                        'detections': 1,
                    }
                    detected[t] = rec
                else:
                    rec['lastDetectedAtUTC'] = snap_ts.isoformat()
                    rec['detections'] += 1
                    if channel_name not in rec['channels']:
                        rec['channels'].append(channel_name)

    detected_set = set(detected)
    hit_set = top_set & detected_set
    unique_detected = len(detected_set)
    recall = 100.0 * len(hit_set) / 50.0
    precision = 100.0 * len(hit_set) / unique_detected if unique_detected else None

    early_hits = {t for t in hit_set if detected[t].get('firstDetectedChangePct') is not None and detected[t]['firstDetectedChangePct'] < 10.0}
    pre5_hits = {t for t in hit_set if detected[t].get('firstDetectedChangePct') is not None and detected[t]['firstDetectedChangePct'] < 5.0}
    early_detected_all = {t for t,r in detected.items() if r.get('firstDetectedChangePct') is not None and r['firstDetectedChangePct'] < 10.0}
    early_precision = 100.0 * len(early_hits) / len(early_detected_all) if early_detected_all else None

    early_lane_all = {t for t,r in detected.items() if 'EARLY' in (r.get('channels') or [])}
    early_lane_hits = top_set & early_lane_all
    early_lane_under10_hits = {t for t in early_lane_hits if detected[t].get('firstDetectedChangePct') is not None and detected[t]['firstDetectedChangePct'] < 10.0}
    early_lane_precision = 100.0 * len(early_lane_hits) / len(early_lane_all) if early_lane_all else None

    detected_top50=[]
    for rank,(t,ch,_) in enumerate(top50, start=1):
        if t in detected:
            x=dict(detected[t]); x['benchmarkChangePct']=ch; x['benchmarkRank']=rank; detected_top50.append(x)

    missed=[{'rank':i+1,'symbol':t,'benchmarkChangePct':ch} for i,(t,ch,_) in enumerate(top50) if t not in detected]
    false_pos=[dict(r, benchmarkTop50=False) for t,r in detected.items() if t not in top_set]
    false_pos.sort(key=lambda r:(r.get('firstDetectedAtUTC') or '', r.get('symbol') or ''))

    report = {
        'schemaVersion': 2,
        'generatedAtUTC': datetime.now(timezone.utc).isoformat(),
        'benchmark': {
            'source': fin.get('source') or 'Finviz',
            'timestampUTC': benchmark_ts.isoformat(),
            'lane': benchmark_lane,
            'universeRows': fin.get('rowCount') or len(fin.get('rows') or []),
            'definition': 'Top 50 symbols by Finviz Change at the benchmark snapshot',
        },
        'detectionDefinition': 'Backend TAGit appearance in EARLY, EMERGING, or ACCUMULATION at or before the benchmark timestamp',
        'snapshotsUsed': snapshots_used,
        'metrics': {
            'top50Count': 50,
            'detectedTop50Count': len(hit_set),
            'top50RecallPct': round(recall, 2),
            'uniqueDetectedCount': unique_detected,
            'precisionVsTop50Pct': round(precision, 2) if precision is not None else None,
            'earlyDetectedTop50Under10PctCount': len(early_hits),
            'earlyTop50RecallPct': round(100.0*len(early_hits)/50.0, 2),
            'earlyUniqueDetectedUnder10PctCount': len(early_detected_all),
            'earlyPrecisionVsTop50Pct': round(early_precision, 2) if early_precision is not None else None,
            'pre5DetectedTop50Count': len(pre5_hits),
            'pre5Top50RecallPct': round(100.0*len(pre5_hits)/50.0, 2),
            'earlyLaneUniqueCount': len(early_lane_all),
            'earlyLaneDetectedTop50Count': len(early_lane_hits),
            'earlyLaneTop50RecallPct': round(100.0*len(early_lane_hits)/50.0, 2),
            'earlyLanePrecisionVsTop50Pct': round(early_lane_precision, 2) if early_lane_precision is not None else None,
            'earlyLaneUnder10Top50Count': len(early_lane_under10_hits),
            'earlyLaneUnder10Top50RecallPct': round(100.0*len(early_lane_under10_hits)/50.0, 2),
            'missedTop50Count': len(missed),
        },
        'detectedTop50': detected_top50,
        'missedTop50': missed,
        'top50': [{'rank':i+1,'symbol':t,'benchmarkChangePct':ch,'detected':t in detected,'firstDetectedChangePct':detected.get(t,{}).get('firstDetectedChangePct'),'firstChannel':detected.get(t,{}).get('firstChannel'),'channels':detected.get(t,{}).get('channels',[])} for i,(t,ch,_) in enumerate(top50)],
        'falsePositiveDetections': false_pos,
        'notes': [
            'This is a point-in-time audit against the committed Finviz snapshot, not a claim of full-market final-close precision.',
            'Recall answers how many of the benchmark top 50 TAGit surfaced in any detection lane.',
            'Early-lane metrics separately measure the dedicated V9 pre-breakout lane.',
            'Strict early metrics require first TAGit detection while the stock was still below +10% on the day.'
        ]
    }
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report['metrics'], ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
