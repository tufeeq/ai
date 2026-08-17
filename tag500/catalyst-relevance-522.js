'use strict';
(function(){
  const BUILD='TAG522';
  const PRE_SIGNAL_TOLERANCE_MS=15*60*1000;
  const GENERIC_STOP=new Set(['inc','corp','corporation','ltd','limited','plc','holdings','holding','group','company','co','the','and','strategy','technologies','technology','systems','system','international']);
  function words(s){return String(s||'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').split(/\s+/).filter(w=>w.length>=3&&!GENERIC_STOP.has(w));}
  function companyOf(z){return z?.raw?.Company||z?.raw?.company||z?.company||'';}
  function tickerRelevant(title,ticker){
    const t=String(ticker||'').trim(); if(!t)return false;
    const safe=t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return new RegExp(`(^|[^A-Za-z0-9])${safe}([^A-Za-z0-9]|$)`,'i').test(String(title||''));
  }
  function companyRelevant(title,company){
    const tw=new Set(words(title)),cw=words(company); if(!cw.length)return false;
    const hits=cw.filter(w=>tw.has(w));
    if(cw.filter(w=>w.length>=5).some(w=>tw.has(w))) return true;
    return hits.length>=Math.min(2,cw.length);
  }
  function relevant(n,z){return tickerRelevant(n?.title,z?.ticker)||companyRelevant(n?.title,companyOf(z));}
  function classify(z,timeline){
    const signalTs=Date.parse(z.signalOrigin?.ts||'');
    const hasNews=timeline.length>0;
    if(Number.isFinite(signalTs)&&timeline.length){
      const cutoff=signalTs+PRE_SIGNAL_TOLERANCE_MS;
      const pre=timeline.filter(n=>n.ts<=cutoff).sort((a,b)=>b.ts-a.ts);
      const post=timeline.filter(n=>n.ts>cutoff).sort((a,b)=>a.ts-b.ts);
      const candidate=pre[0]||null;
      if(candidate){
        const ageAtSignal=Math.max(0,(signalTs-candidate.ts)/36e5);
        if(ageAtSignal<=24) return {code:'FRESH_PRE_SIGNAL',label:'محفز حديث قبل/مع الإشارة',rank:0,attributionError:false,noNewsPath:false,candidate,ageAtSignalHours:ageAtSignal,postSignalCount:post.length};
        if(ageAtSignal<=96) return {code:'RECENT_PRE_SIGNAL',label:'محفز قريب سابق للإشارة',rank:1,attributionError:false,noNewsPath:false,candidate,ageAtSignalHours:ageAtSignal,postSignalCount:post.length};
        return {code:'STALE_PRE_SIGNAL',label:'خبر سابق قديم — لا Catalyst credit',rank:4,attributionError:false,noNewsPath:false,candidate,ageAtSignalHours:ageAtSignal,postSignalCount:post.length};
      }
      if(post.length) return {code:'POST_SIGNAL_ONLY',label:'الأخبار المرتبطة جاءت بعد بداية الحركة',rank:3,attributionError:true,noNewsPath:false,candidate:post[0],ageAtSignalHours:null,postSignalCount:post.length};
    }
    if(!Number.isFinite(signalTs)&&timeline.length) return {code:'SIGNAL_TIME_UNKNOWN',label:'خبر مرتبط موجود · زمن الإشارة غير محسوم',rank:5,attributionError:false,noNewsPath:false,candidate:timeline[0],ageAtSignalHours:null,postSignalCount:0};
    if(!hasNews&&z.newsSweepVerified===true){
      const constructive=['ACCELERATING','BUILDING','STABLE'].includes(z.temporal?.trajectory);
      const early=['EARLY','FORMING'].includes(z.signalOrigin?.class);
      return {code:'NO_RELEVANT_NEWS_VERIFIED',label:'No-News Momentum · لا خبر مرتبط بعد sweep',rank:constructive&&early?1:2,attributionError:false,noNewsPath:true,candidate:null,ageAtSignalHours:null,postSignalCount:0};
    }
    return {code:'UNKNOWN',label:'Catalyst غير محسوم',rank:5,attributionError:false,noNewsPath:false,candidate:null,ageAtSignalHours:null,postSignalCount:0};
  }

  const baseAnalyze=window.analyze;
  if(typeof baseAnalyze==='function') window.analyze=function(x){
    const z=baseAnalyze(x);
    const all=Array.isArray(z.catalystNewsTimeline)?z.catalystNewsTimeline:[];
    const kept=all.filter(n=>relevant(n,z));
    const rejected=all.length-kept.length;
    z.catalystNewsTimelineRawCount=all.length;
    z.catalystNewsRejectedCount=rejected;
    z.catalystNewsTimeline=kept;
    z.newsCount=kept.length;
    z.catalystClock=classify(z,kept);
    z.newsRelevanceGate={build:BUILD,raw:all.length,relevant:kept.length,rejected,company:companyOf(z)||null};
    if(rejected>0) z.reasons.push(`Catalyst Relevance: استبعاد ${rejected} خبر غير مرتبط بالكيان`);
    if(all.length>0&&kept.length===0) z.reasons.push('Catalyst Relevance: نتائج البحث الإخباري غير مرتبطة بالشركة؛ لا Catalyst credit');
    return z;
  };

  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){
    baseRender();
    const log=document.querySelector('#integrityLog');
    if(log){
      const a=window.analyzed||[];
      const raw=a.reduce((s,z)=>s+(z.catalystNewsTimelineRawCount||0),0);
      const rejected=a.reduce((s,z)=>s+(z.catalystNewsRejectedCount||0),0);
      const zeroed=a.filter(z=>(z.catalystNewsTimelineRawCount||0)>0&&(z.catalystNewsTimeline||[]).length===0).length;
      log.insertAdjacentHTML('beforeend',`<div class="log-item">Catalyst Relevance ${BUILD}: raw=${raw} · rejected=${rejected} · all-irrelevant=${zeroed}. الأخبار غير المرتبطة بالرمز/اسم الشركة لا تدخل Catalyst Clock ولا تحصل على Catalyst credit.</div>`);
    }
  };
})();