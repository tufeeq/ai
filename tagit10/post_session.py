#!/usr/bin/env python3
import csv, io, json, os, urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ET=ZoneInfo('America/New_York'); TOKEN=os.getenv('FINVIZ_TOKEN','').strip(); ROOT=Path(__file__).resolve().parents[1]
STATE=ROOT/'tagit10-state.json'; OUT=ROOT/'tag/data/tagit10-post-session.json'

def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 TAGit10'}); return urllib.request.urlopen(req,timeout=20).read()
def num(v):
    try:return float(str(v).replace('%','').replace(',','').replace('$','').strip())
    except:return None

def top50():
    if not TOKEN: raise SystemExit('FINVIZ_TOKEN missing')
    raw=get(f'https://elite.finviz.com/export/screener?s=ta_topgainers&v=152&auth={TOKEN}').decode('utf-8-sig','ignore')
    rows=[]
    for r in csv.DictReader(io.StringIO(raw)):
        s=(r.get('Ticker') or '').strip().upper(); ch=num(r.get('Change'))
        if s and ch is not None: rows.append((s,ch))
    rows.sort(key=lambda x:x[1],reverse=True); return rows[:50]

def classify(sym, rec):
    if not rec:return 'UNIVERSE_MISS','لم يدخل السهم الرادار المحفوظ قبل نهاية الحركة','وسّع sweep واحتفظ بمرشحي unusual volume قبل تحرك السعر.'
    best=rec.get('bestStage','WATCH'); fc=rec.get('stageFirstChangePct'); score=rec.get('maxScore',0)
    if best=='WATCH' and score<36:return 'EARLY_SIGNAL_MISS','كان السهم تحت المراقبة لكن خصائص السيولة/التماسك لم تتجاوز بوابة EARLY','عاير threshold على Winners vs Controls وارفَع وزن volume acceleration/compression إن تكرر النمط.'
    if fc is not None and fc>=10:return 'THRESHOLD_TOO_LATE',f'أول ترقية حدثت بعد +{fc:.1f}%','خفّض الاعتماد على الزخم السعري المتحقق وكافئ lead-time قبل +5%/+10%.'
    if best in ('EARLY','ACTIONABLE','CONFIRMED') and (fc is None or fc<10):return 'CAPTURED_EARLY','تمت مشاهدة السهم مبكرًا','استخدم الحالة كعينة موجبة Forward PIT ولا تغيّر القواعد من حالة واحدة.'
    return 'FILTERED_OUT','ظهر السهم لكن لم يصل إلى طبقة مناسبة في الوقت المطلوب','افحص البوابة التي أوقفته وقارنها بعينات التحكم قبل تعديلها.'

def main():
    et=datetime.now(timezone.utc).astimezone(ET)
    if et.weekday()>=5 or (et.hour,et.minute)<(16,15): raise SystemExit('Not after 16:15 ET; final audit refused')
    state=json.loads(STATE.read_text()) if STATE.exists() else {'symbols':{}}
    t50=top50(); syms=state.get('symbols',{})
    cases=[]
    for rank,(s,ch) in enumerate(t50,1):
        rec=syms.get(s); cause,why,lesson=classify(s,rec)
        cases.append({'rank':rank,'symbol':s,'closeChangePct':ch,'cause':cause,'why':why,'lesson':lesson,'bestStage':rec.get('bestStage') if rec else None,'firstStageChangePct':rec.get('stageFirstChangePct') if rec else None,'maxScore':rec.get('maxScore') if rec else None})
    early=[c for c in cases if c['cause']=='CAPTURED_EARLY']; detected=[c for c in cases if c.get('bestStage') in ('EARLY','ACTIONABLE','CONFIRMED')]
    causes=Counter(c['cause'] for c in cases if c['cause']!='CAPTURED_EARLY')
    priorities=[]
    for cause,count in causes.most_common():
        lesson=next(c['lesson'] for c in cases if c['cause']==cause)
        priorities.append({'cause':cause,'misses':count,'shareOfTop50Pct':round(count/50*100,1),'recommendedChange':lesson})
    report={'schemaVersion':10,'status':'FINAL_AFTER_CLOSE','generatedAtUTC':datetime.now(timezone.utc).isoformat(),'sessionDateET':et.date().isoformat(),'target':{'earlyTop50RecallPct':70,'claimedAchieved':False},'metrics':{'top50':50,'earlyCaptured':len(early),'earlyRecallPct':round(len(early)/50*100,1),'detectedAnyEarlyStage':len(detected),'detectedRecallPct':round(len(detected)/50*100,1),'missed':50-len(early)},'rootCauseCounts':dict(causes),'improvementPriorities':priorities,'cases':cases,'method':'Forward state only; close outcome is label, never a feature.'}
    OUT.parent.mkdir(parents=True,exist_ok=True); OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report['metrics']))
if __name__=='__main__':main()
