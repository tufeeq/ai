#!/usr/bin/env python3
import json, pathlib, urllib.request, xml.etree.ElementTree as ET, re, datetime as dt

UA='TAGX research contact tagx@example.com'

def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept-Encoding':'identity'})
    with urllib.request.urlopen(req,timeout=30) as r:return r.read()

def load_json(url): return json.loads(get(url).decode('utf-8'))

def institutional():
    src=load_json('https://raw.githubusercontent.com/Sunny-1991/13F-Tracker/main/data/sec-13f-latest.json')
    by={}
    for m in src.get('managers',[]):
        filing=m.get('latest_filing') or {}
        for h in filing.get('holdings',[]):
            t=str(h.get('ticker') or '').upper().strip()
            if not t: continue
            z=by.setdefault(t,{'managers':[],'aggregateWeight':0.0,'aggregateValueUSD':0})
            z['managers'].append({'name':m.get('org') or m.get('name'),'weight':h.get('weight'),'valueUSD':h.get('value_usd'),'shares':h.get('shares'),'quarter':filing.get('quarter'),'filedDate':filing.get('filed_date')})
            z['aggregateWeight']+=float(h.get('weight') or 0);z['aggregateValueUSD']+=int(h.get('value_usd') or 0)
    for t,z in by.items():
        z['managerCount']=len(z['managers']);z['institutionalScore']=min(100,20*z['managerCount']+min(40,z['aggregateWeight']*100))
    return by,src.get('generated_at_utc')

def tickers_by_cik():
    x=load_json('https://www.sec.gov/files/company_tickers.json');return {str(v['cik_str']):v['ticker'].upper() for v in x.values()}

def insider_activity():
    cmap=tickers_by_cik();url='https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&owner=include&count=100&output=atom'
    root=ET.fromstring(get(url));ns={'a':'http://www.w3.org/2005/Atom'};out={}
    for e in root.findall('a:entry',ns):
        title=e.findtext('a:title',default='',namespaces=ns);updated=e.findtext('a:updated',default='',namespaces=ns)
        ids=re.findall(r'\((\d{5,10})\)',title);ticker=None
        for cik in ids:
            ticker=cmap.get(str(int(cik)))
            if ticker:break
        if not ticker:continue
        z=out.setdefault(ticker,{'recentForm4Count':0,'latestForm4':updated,'titles':[]});z['recentForm4Count']+=1;z['titles'].append(title[:180])
        if updated>z['latestForm4']:z['latestForm4']=updated
    for z in out.values():z['insiderScore']=min(70,20+z['recentForm4Count']*12)
    return out

def main():
    inst,inst_ts=institutional();ins=insider_activity();now=dt.datetime.now(dt.timezone.utc).isoformat()
    tickers=sorted(set(inst)|set(ins));rows={}
    for t in tickers:
        a=inst.get(t,{});b=ins.get(t,{})
        rows[t]={'institutionalScore':a.get('institutionalScore',0),'institutional':a,'insiderScore':b.get('insiderScore',0),'insider':b,'dataConfidence':85 if a and b else 70}
    payload={'schemaVersion':1,'updatedAt':now,'sources':{'institutional':'SEC EDGAR via 13F-Tracker','insider':'SEC current Form 4 Atom feed','orderFlow':'TAGX internal microstructure proxy inspired by orderflow/DaxAlgo patterns','prediction':'TAGX fusion layer; shadow probability, not investment advice'},'institutionalSourceUpdatedAt':inst_ts,'tickerCount':len(rows),'tickers':rows}
    p=pathlib.Path('tag/data/smart-money.json');p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    print('smart-money tickers',len(rows))
if __name__=='__main__':main()
