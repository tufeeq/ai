'use strict';
(function(){
  const BUILD='TAG515';
  const PRE_SIGNAL_TOLERANCE_MS=15*60*1000;
  const baseMerge=window.mergeEnrichment;
  if(typeof baseMerge==='function') window.mergeEnrichment=function(base,enrichment,nowTs){
    const out=baseMerge(base,enrichment,nowTs);
    const map=enrichment&&enrichment.rows&&typeof enrichment.rows==='object'?enrichment.rows:{};
    const newsStatus=String(enrichment?.sourceStatus?.News||'').toUpperCase();
    const sweepVerified=newsStatus.startsWith('OK:');
    for(const x of out){
      const news=Array.isArray(map[x.ticker]?.news)?map[x.ticker].news:[];
      const parsed=news.map(n=>({ts:Date.parse(n.published||''),title:n.title||null,source:n.source||null}))
        .filter(n=>Number.isFinite(n.ts)).sort((a,b)=>b.ts-a.ts);
      x.catalystNewsTimeline=parsed;
      x.latestNewsTimestamp=parsed[0]?.ts||null;
      x.latestNewsTitle=parsed[0]?.title||x.latestNews||null;
      x.newsSweepVerified=sweepVerified;
      x.newsSweepStatus=newsStatus||'UNKNOWN';
    }
    return out;
  };

  function classify(z){
    const signalTs=Date.parse(z.signalOrigin?.ts||'');
    const timeline=Array.isArray(z.catalystNewsTimeline)?z.catalystNewsTimeline:[];
    const hasNews=timeline.length>0||(z.newsCount||0)>0;
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
      if(post.length) return {code:'POST_SIGNAL_ONLY',label:'الأخبار المتاحة جاءت بعد بداية الحركة',rank:3,attributionError:true,noNewsPath:false,candidate:post[0],ageAtSignalHours:null,postSignalCount:post.length};
    }
    if(!Number.isFinite(signalTs)&&timeline.length){
      return {code:'SIGNAL_TIME_UNKNOWN',label:'خبر موجود · زمن الإشارة غير محسوم',rank:5,attributionError:false,noNewsPath:false,candidate:timeline[0],ageAtSignalHours:null,postSignalCount:0};
    }
    if(!hasNews&&z.newsSweepVerified===true){
      const constructive=['ACCELERATING','BUILDING','STABLE'].includes(z.temporal?.trajectory);
      const early=['EARLY','FORMING'].includes(z.signalOrigin?.class);
      return {code:'NO_NEWS_VERIFIED',label:'No-News Momentum · sweep مكتمل',rank:constructive&&early?1:2,attributionError:false,noNewsPath:true,candidate:null,ageAtSignalHours:null,postSignalCount:0};
    }
    return {code:'UNKNOWN',label:'Catalyst غير محسوم',rank:5,attributionError:false,noNewsPath:false,candidate:null,ageAtSignalHours:null,postSignalCount:0};
  }

  const baseAnalyze=window.analyze;
  if(typeof baseAnalyze==='function') window.analyze=function(x){
    const z=baseAnalyze(x);
    z.catalystClock=classify(z);
    const c=z.catalystClock;
    if(c.attributionError){
      z.catalystAttributionError=true;
      z.reasons.push('Catalyst Attribution Error: لا يوجد خبر سابق مؤهل؛ الأخبار المتاحة جاءت بعد الإشارة');
    }else if(c.code==='FRESH_PRE_SIGNAL'){
      z.reasons.push(`Catalyst Clock: محفز سبق الإشارة بـ ${c.ageAtSignalHours.toFixed(1)}س`);
    }else if(c.code==='RECENT_PRE_SIGNAL'){
      z.reasons.push(`Catalyst Clock: خبر سابق بـ ${c.ageAtSignalHours.toFixed(1)}س`);
    }else if(c.noNewsPath){
      z.reasons.push('No-News Momentum Path بعد sweep إخباري مكتمل');
    }
    return z;
  };

  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){
    baseRender();
    const head=document.querySelector('.table-panel thead tr');
    if(head&&!head.querySelector('[data-cat515]')){
      const th=document.createElement('th');th.dataset.cat515='1';th.textContent='Catalyst Clock';
      const origin=[...head.children].find(el=>el.textContent.trim()==='أصل الإشارة');
      if(origin) origin.after(th); else head.appendChild(th);
    }
    const map=new Map((window.analyzed||[]).map(z=>[z.ticker,z]));
    for(const tr of document.querySelectorAll('#scannerBody tr[data-ticker]')){
      const z=map.get(tr.dataset.ticker);if(!z?.catalystClock)continue;
      const old=tr.querySelector('[data-cat514]');if(old)old.remove();
      if(tr.querySelector('[data-cat515]'))continue;
      const origin=tr.querySelector('[data-origin512]');
      const td=document.createElement('td');td.dataset.cat515='1';
      const c=z.catalystClock;
      const detail=c.attributionError?'لا يوجد محفز سابق مؤهل':c.noNewsPath?'لا خبر بعد sweep مكتمل':Number.isFinite(c.ageAtSignalHours)?`قبل الإشارة بـ ${c.ageAtSignalHours.toFixed(1)}س${c.postSignalCount?` · ${c.postSignalCount} خبر لاحق لم يلغِ المحفز السابق`:''}`:'توقيت الخبر غير مكتمل';
      td.innerHTML=`<strong>${c.label}</strong><small style="display:block;color:#8fa9bd;font-size:10px;margin-top:3px">${detail}</small>`;
      if(origin) origin.after(td); else tr.appendChild(td);
    }
    const log=document.querySelector('#integrityLog');
    if(log){
      const a=window.analyzed||[];
      const fresh=a.filter(z=>z.catalystClock?.code==='FRESH_PRE_SIGNAL').length;
      const recent=a.filter(z=>z.catalystClock?.code==='RECENT_PRE_SIGNAL').length;
      const postOnly=a.filter(z=>z.catalystClock?.code==='POST_SIGNAL_ONLY').length;
      const noNews=a.filter(z=>z.catalystClock?.code==='NO_NEWS_VERIFIED').length;
      log.insertAdjacentHTML('beforeend',`<div class="log-item">Catalyst Timeline ${BUILD}: fresh-pre=${fresh} · recent-pre=${recent} · post-signal-only=${postOnly} · no-news=${noNews}. يتم فحص كامل timeline؛ الخبر اللاحق لا يلغي محفزًا سابقًا صالحًا.</div>`);
    }
  };
})();