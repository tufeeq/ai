"""Free broad US equity reference (replaces the paid Finviz Elite export, whose token now returns 401).

Writes tag/data/universe-broad.json in the same schema the quote service reads
(schemaVersion 1, rows with Ticker / Company / Industry / 'Market Cap' in USD millions / Float /
'Short Float' as 'x.xx%' / _snapshotTimestampUTC), so no backend change is needed.

Sources (all free, no key):
  - Nasdaq.com stock screener (unofficial): every US-listed stock with market cap, industry, price.
  - SEC XBRL frames: dei:EntityCommonStockSharesOutstanding for every filer (shares outstanding).
  - FINRA consolidated short interest: latest settlement (short % of shares outstanding).
Float is not published free, so it is left empty rather than guessed; the service treats it as unknown.
"""
import argparse
import datetime
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from enrich import BROWSER_UA, SEC_UA, fetch, finra_short_interest  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'tag/data/universe-broad.json'
SCREENER = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true'
TICKERS = 'https://www.sec.gov/files/company_tickers.json'
FRAME = 'https://data.sec.gov/api/xbrl/frames/dei/EntityCommonStockSharesOutstanding/shares/CY{y}Q{q}I.json'
SYMBOL = re.compile(r'^[A-Z][A-Z0-9.-]{0,9}$')
NOT_COMMON = re.compile(r'\b(warrants?|rights?|units?|preferred|depositary shares|notes due|debentures?|subordinated)\b', re.I)
MIN_ROWS = 2000


def number(text):
    try:
        return float(str(text).replace('$', '').replace(',', '').replace('%', '').strip())
    except ValueError:
        return None


def ticker(raw):
    return str(raw or '').strip().upper().replace('/', '-').replace('^', '-P')


def industry_of(r):
    ind = (r.get('industry') or '').strip()
    if re.search(r'blank check', ind, re.I):
        return 'Shell Companies'
    return ind or (r.get('sector') or '').strip() or 'Unclassified'


def build_rows(screener_rows, shares_by_symbol, short_by_symbol, now):
    rows = []
    for r in screener_rows:
        sym = ticker(r.get('symbol'))
        name = (r.get('name') or '').strip()
        cap = number(r.get('marketCap'))
        if not SYMBOL.match(sym) or NOT_COMMON.search(name) or not cap or cap <= 0:
            continue
        shares = shares_by_symbol.get(sym)
        short = short_by_symbol.get(sym)
        short_pct = f"{short / shares * 100:.2f}%" if short and shares else ''
        rows.append({
            'Ticker': sym, 'Company': name, 'Sector': (r.get('sector') or '').strip(), 'Industry': industry_of(r),
            'Country': (r.get('country') or '').strip(), 'Market Cap': f'{cap / 1e6:.2f}',
            'Price': f"{number(r.get('lastsale')):g}" if number(r.get('lastsale')) else '',
            'Change': (r.get('pctchange') or '').strip(), 'Volume': str(r.get('volume') or ''),
            'Avg Volume': '', 'Float': '', 'Outstanding': f'{shares / 1e6:.2f}' if shares else '',
            'Short Float': short_pct, '_snapshotTimestampUTC': now,
            '_source': 'Nasdaq.com screener + SEC XBRL + FINRA', '_discoveryOnly': True,
        })
    rows.sort(key=lambda x: x['Ticker'])
    return rows


def shares_outstanding(today):
    """Newest shares-outstanding fact per CIK across the last four quarterly frames, mapped to tickers."""
    headers = {'User-Agent': SEC_UA}
    tickers = json.loads(fetch(TICKERS, headers))
    by_cik = {}
    for back in range(4, -1, -1):  # oldest first so newer frames overwrite
        y, q = today.year, (today.month - 1) // 3 + 1
        q -= back
        while q <= 0:
            q += 4
            y -= 1
        try:
            frame = json.loads(fetch(FRAME.format(y=y, q=q), headers))
        except Exception as e:  # a future/unpublished frame is normal
            print(f'frame CY{y}Q{q}I unavailable: {e}')
            continue
        for d in frame.get('data', []):
            if isinstance(d.get('val'), (int, float)) and d['val'] > 0:
                by_cik[int(d['cik'])] = d['val']
    return {ticker(t['ticker']): by_cik[int(t['cik_str'])] for t in tickers.values() if int(t['cik_str']) in by_cik}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(OUT))
    args = ap.parse_args()
    now_dt = datetime.datetime.now(datetime.timezone.utc)
    now = now_dt.isoformat()
    body = json.loads(fetch(SCREENER, {'User-Agent': BROWSER_UA, 'Accept': 'application/json'}))
    screener_rows = (body.get('data') or {}).get('rows') or []
    print('screener rows', len(screener_rows))
    try:
        shares = shares_outstanding(now_dt.date())
    except Exception as e:
        print('SEC shares unavailable:', e)
        shares = {}
    print('shares outstanding', len(shares))
    try:
        si, settlement = finra_short_interest({ticker(r.get('symbol')) for r in screener_rows})
        short = {s: v.get('shares_short') for s, v in si.items()}
        print('short interest', len(short), 'settlement', settlement)
    except Exception as e:
        print('FINRA unavailable:', e)
        short, settlement = {}, None
    rows = build_rows(screener_rows, shares, short, now)
    print('universe rows', len(rows), 'under $100M', sum(float(r['Market Cap']) < 100 for r in rows))
    if len(rows) < MIN_ROWS:
        raise SystemExit(f'Broad universe unexpectedly below {MIN_ROWS} symbols; fail closed')
    payload = {
        'schemaVersion': 1, 'source': 'Nasdaq.com screener + SEC XBRL shares + FINRA short interest (free)',
        'sourceType': 'BROAD_RESEARCH_UNIVERSE', 'filter': ['all US-listed common stocks with a market cap'],
        'updatedAt': now, 'count': len(rows), 'shortInterestSettlement': settlement,
        'floatAvailable': False, 'executionEligibility': 'SEPARATE_SHARIA_AND_DATA_GATES_REQUIRED',
        'trainingEligible': False, 'rows': rows,
    }
    Path(args.out).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
