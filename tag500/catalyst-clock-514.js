'use strict';
(function(){
  const BUILD='TAG514';
  const baseMerge=window.mergeEnrichment;
  if(typeof baseMerge==='function') window.mergeEnrichment=function(base,enrichment,nowTs){
    const out=baseMerge(base,enrichment,nowTs);
    const map=enrichment&&enrichment.rows&&typeof enrichment.rows==='object'?enrichment.rows:{};
    const newsStatus=String(enrichment?.sourceStatus?.News||'').toUpperCase();
    const sweepVerified=newsStatus.startsWith('OK:');
    for(const x of out){
      const news=Array.isArray(map[x.ticker]?.news)?map[x.ticker].news:[];
      const parsed=news.map(n=>({ts:Date.parse(n.published||''),title:n.title||null})).filter(n=>Number.isFinite(n.ts)).sort((a,b)=>b.ts-a.ts);
      x.latestNewsTimestamp=parsed[0]?.ts||null;
      x.latestNewsTitle=parsed[0]?.title||x.latestNews||null;
      x.newsSweepVerified=sweepVerified;
      x.newsSweepStatus=newsStatus||'UNKNOWN';
    }
    return out;
  };

  function classify(z){
    const newsTs=Number.isFinite(z.latestNewsTimestamp)?z.latestNewsTimestamp:null;
    const signalTs=Date.parse(z.signalOrigin?.ts||'');
    const age=Number.isFinite(z.catalystAgeHours)?z.catalystAgeHours:null;
    const hasNews=(z.newsCount||0)>0;
    if(newsTs!==null){
      if(Number.isFinite(signalTs)&&newsTs>signalTs+15*60000){
        return {code:'POST_SIGNAL',label:'خبر بعد بداية الحركة',rank:3,attributionError:true,noNewsPath:false};
      }
      if(age!==null&&age<=24) return {code:'FRESH_PRE_SIGNAL',label:'محفز حديث قبل/مع الإشارة',rank:0,attributionError:false,noNewsPath:false};
      if(age!==null&&age<=96) return {code:'RECENT_PRE_SIGNAL',label:'محفز قريب سابق للإشارة',rank:1,attributionError:false,noNewsPath:false};
      return {code:'STALE',label:'خبر قديم — لا يُنسب إليه التحرك',rank:4,attributionError:false,noNewsPath:false};
    }
    if(!hasNews&&z.newsSweepVerified===true){
      const constructive=['ACCELERATING','BUILDING','STABLE'].includes(z.temporal?.trajectory);
      const early=['EARLY','FORMING'].includes(z.signalOrigin?.class);
      return {code:'NO_NEWS_VERIFIED',label:'No-News Momentum · sweep مكتمل',rank:constructive&&early?1:2,attributionError:false,noNewsPath:true};
    }
    return {code:'UNKNOWN',label:'Catalyst غير محسوم',rank:5,attributionError:false,noNewsPath:false};
  }

  const baseAnalyze=window.analyze;
  if(typeof baseAnalyze==='function') window.analyze=function(x){
    const z=baseAnalyze(x);
    z.catalystClock=classify(z);
    if(z.catalystClock.attributionError){
      z.catalystAttributionError=true;
      z.reasons.push('Catalyst Attribution Error: الخبر أحدث من بداية الإشارة');
    }else if(z.catalystClock.code==='FRESH_PRE_SIGNAL'){
      z.reasons.push('Catalyst Clock: محفز حديث يسبق/يتزامن مع الإشارة');
    }else if(z.catalystClock.noNewsPath){
      z.reasons.push('No-News Momentum Path بعد sweep إخباري مكتمل');
    }
    return z;
  };

  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){
    baseRender();
    const head=document.querySelector('.table-panel thead tr');
    if(head&&!head.querySelector('[data-cat514]')){
      const th=document.createElement('th');th.dataset.cat514='1';th.textContent='Catalyst Clock';
      const origin=[...head.children].find(el=>el.textContent.trim()==='أصل الإشارة');
      if(origin) origin.after(th); else head.appendChild(th);
    }
    const map=new Map((window.analyzed||[]).map(z=>[z.ticker,z]));
    for(const tr of document.querySelectorAll('#scannerBody tr[data-ticker]')){
      const z=map.get(tr.dataset.ticker);if(!z?.catalystClock)continue;
      if(tr.querySelector('[data-cat514]'))continue;
      const origin=tr.querySelector('[data-origin512]');
      const td=document.createElement('td');td.dataset.cat514='1';
      const c=z.catalystClock;
      td.innerHTML=`<strong>${c.label}</strong><small style="display:block;color:#8fa9bd;font-size:10px;margin-top:3px">${c.attributionError?'لا تنسب بداية الحركة للخبر':c.noNewsPath?'المسار السعري مستقل عن خبر موثق':'توقيت الخبر محسوب مقابل أول إشارة'}</small>`;
      if(origin) origin.after(td); else tr.appendChild(td);
    }
    const log=document.querySelector('#integrityLog');
    if(log){
      const a=window.analyzed||[];
      const post=a.filter(z=>z.catalystClock?.code==='POST_SIGNAL').length;
      const fresh=a.filter(z=>z.catalystClock?.code==='FRESH_PRE_SIGNAL').length;
      const noNews=a.filter(z=>z.catalystClock?.code==='NO_NEWS_VERIFIED').length;
      log.insertAdjacentHTML('beforeend',`<div class="log-item">Catalyst Clock ${BUILD}: fresh-pre-signal=${fresh} · no-news-verified=${noNews} · attribution-errors=${post}. لا يُستخدم خبر نُشر بعد أول إشارة لتفسير بداية الحركة.</div>`);
    }
  };
})();