"""Does Nasdaq.com publish real-time trades with sizes, and how much volume do they cover versus SIP?"""
import json, sys, time, urllib.request
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
      'Accept': 'application/json', 'Origin': 'https://www.nasdaq.com', 'Referer': 'https://www.nasdaq.com/'}
SERVICE = 'https://tagit-next-quotes.onrender.com'
def get(url, headers=UA):
    t = time.monotonic()
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=40) as r:
        return json.loads(r.read()), time.monotonic() - t
for sym in sys.argv[1:] or ['IPDN', 'NIVF', 'SENS']:
    for url in (f'https://api.nasdaq.com/api/quote/{sym}/realtime-trades?&limit=99999&fromTime=00:00',
                f'https://api.nasdaq.com/api/quote/{sym}/realtime-trades?&limit=20'):
        try:
            body, secs = get(url)
            data = body.get('data') or {}
            rows = data.get('rows') or []
            vol = sum(int(str(r.get('nlsShareVolume', '0')).replace(',', '') or 0) for r in rows)
            print(f'{sym} {secs:.1f}s keys={list(data)[:8]} rows={len(rows)} total={data.get("totalRecords")} volume_sum={vol} first={rows[:2]} last={rows[-1:]} top={json.dumps({k: v for k, v in data.items() if k not in ("rows",)})[:400]}', flush=True)
        except Exception as e:
            print(f'{sym} {url[-40:]} ERROR {e}', flush=True)
    try:
        info, _ = get(f'https://api.nasdaq.com/api/quote/{sym}/info?assetclass=stocks')
        print(f'{sym} consolidated day volume (quote): {(info.get("data") or {}).get("primaryData", {}).get("volume")}', flush=True)
    except Exception as e:
        print(f'{sym} info ERROR {e}')
