#!/usr/bin/env python3
import json, pathlib, re, time, urllib.request, datetime
from urllib.error import HTTPError, URLError

ROOT = pathlib.Path(__file__).resolve().parents[2]
LIVE = ROOT / 'tag/data/live-quotes.json'
OUT = ROOT / 'tag/data/sec-structural-risk.json'
UA = 'TAGX research bot github.com/tufeeq/ai contact: github-user-tufeeq'
RISK_FORMS = {'S-1','S-1/A','S-3','S-3/A','424B3','424B4','424B5','EFFECT','F-1','F-1/A','F-3','F-3/A'}
KEYWORDS = {
    'offering': r'\b(public offering|registered direct|private placement|at[- ]the[- ]market|\batm\b|securities purchase agreement)\b',
    'dilution': r'\b(dilution|dilutive|warrant exercise|convertible note|convertible preferred)\b',
    'financing': r'\b(pipe financing|financing condition|raise gross proceeds|capital raise)\b',
    'termination': r'\b(terminate(?:d|s|ion)?|merger agreement.*terminated|business combination.*terminated)\b',
}

def get_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Encoding': 'identity'})
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.loads(r.read().decode('utf-8'))

def get_text(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Encoding': 'identity'})
    with urllib.request.urlopen(req, timeout=8) as r:
        return r.read(400000).decode('utf-8', errors='ignore')

def load_live():
    return json.loads(LIVE.read_text(encoding='utf-8'))

def ticker_map():
    raw = get_json('https://www.sec.gov/files/company_tickers.json')
    return {str(v.get('ticker','')).upper(): str(v.get('cik_str','')).zfill(10) for v in raw.values()}

def filing_url(cik, acc, primary):
    cik_no_zero = str(int(cik))
    acc_compact = acc.replace('-','')
    return f'https://www.sec.gov/Archives/edgar/data/{cik_no_zero}/{acc_compact}/{primary}'

def inspect(ticker, cik, now):
    result = {'ticker': ticker, 'cik': cik, 'riskLevel': 'NONE', 'reasons': [], 'filings': [], 'checkedAtUTC': now.isoformat()}
    try:
        sub = get_json(f'https://data.sec.gov/submissions/CIK{cik}.json')
        recent = (sub.get('filings') or {}).get('recent') or {}
        forms = recent.get('form') or []; dates = recent.get('filingDate') or []; accs = recent.get('accessionNumber') or []; prim = recent.get('primaryDocument') or []
        cutoff = (now.date() - datetime.timedelta(days=35)).isoformat()
        for i, form in enumerate(forms[:80]):
            if i >= len(dates) or dates[i] < cutoff: continue
            acc = accs[i] if i < len(accs) else ''
            primary = prim[i] if i < len(prim) else ''
            item = {'form': form, 'filingDate': dates[i], 'accession': acc, 'primaryDocument': primary, 'flags': []}
            if form in RISK_FORMS:
                item['flags'].append('capital-markets-form')
                result['riskLevel'] = 'HIGH'
                result['reasons'].append(f'{form} filed {dates[i]}')
            if form == '8-K' and primary:
                try:
                    txt = re.sub(r'<[^>]+>', ' ', get_text(filing_url(cik, acc, primary))).lower()
                    for label, pat in KEYWORDS.items():
                        if re.search(pat, txt, flags=re.I|re.S): item['flags'].append(label)
                    if item['flags']:
                        result['riskLevel'] = 'HIGH' if any(x in item['flags'] for x in ('offering','dilution','termination')) else 'MEDIUM'
                        result['reasons'].append(f"8-K {dates[i]}: {','.join(item['flags'])}")
                except Exception as e:
                    item['parseError'] = type(e).__name__
            if item['flags']:
                result['filings'].append(item)
            time.sleep(0.11)
        result['reasons'] = list(dict.fromkeys(result['reasons']))[:8]
        result['filings'] = result['filings'][:8]
    except Exception as e:
        result['riskLevel'] = 'UNVERIFIED'
        result['error'] = type(e).__name__
    return result

def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    live = load_live()
    candidates = [str(x.get('ticker','')).upper() for x in (live.get('emergingCandidates') or []) if x.get('ticker')][:12]
    tmap = ticker_map()
    rows = {}
    for t in candidates:
        cik = tmap.get(t)
        if not cik:
            rows[t] = {'ticker': t, 'riskLevel': 'UNVERIFIED', 'reasons': ['No SEC CIK mapping'], 'checkedAtUTC': now.isoformat()}
            continue
        rows[t] = inspect(t, cik, now)
    high = sum(1 for r in rows.values() if r.get('riskLevel') == 'HIGH')
    out = {
        'schemaVersion': 1,
        'source': 'SEC EDGAR point-in-time structural-risk challenger',
        'updatedAtUTC': now.isoformat(),
        'sourceLiveSnapshotUTC': live.get('updatedAtUTC'),
        'productionDecisionActive': False,
        'lookAheadUsedForRanking': False,
        'candidateCount': len(candidates),
        'highRiskCount': high,
        'rows': rows,
        'policy': 'Challenger only. Recent capital-markets forms or risky 8-K text can veto future LAB promotion after multi-session validation.'
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'candidates': len(candidates), 'highRisk': high, 'output': str(OUT)}))

if __name__ == '__main__':
    main()
