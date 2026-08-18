'use strict';
(function(){
  const BUILD='TAG535';
  const ENRICHMENT_MAX_LAG_MINUTES=20;
  const FINANCE_CTX=/\b(nasdaq|nyse|amex|stock|shares?|earnings|revenue|guidance|offering|merger|acquisition|sec|filing|quarter|q[1-4]|investor|company|corporation|inc\.?|ltd\.?|plc|biotech|pharma)\b/i;
  const PRIMARY=/\b(sec|investor relations|business wire|globenewswire|pr newswire)\b/i;
  const TIER1=/\b(reuters|bloomberg|wall street journal|wsj|cnbc|nasdaq|nyse)\b/i;
  const TIER2=/\b(marketwatch|yahoo finance|benzinga|stock titan|seeking alpha|tradingview|investing\.com)\b/i;
  const STOP=new Set(['group','holding','holdings','company','corporation','limited','inc','ltd','plc','technologies','technology','systems','health','medical','international','global','solutions','women']);
  function esc(s){return String(s||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
  function words(s){return String(s||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>=5&&!STOP.has(w));}
  function companyTokens(z){return [...new Set(words(z.company||z.companyName||z.name||z.description||''))].slice(0,6);}
  function relevance(z,n){
    const title=String(n?.title||'');
    const ticker=String(z?.ticker||'').toUpperCase();
    const exact=ticker&&new RegExp('(^|[^A-Z0-9])'+esc(ticker)+'([^A-Z0-9]|$)','i').test(title);
    const tokens=companyTokens(z);
    const tokenHits=tokens.filter(t=>title.toLowerCase().includes(t)).length;
    if(tokenHits>=2) return {ok:true,score:3,why:'company-entity'};
    if(tokenHits===1&&FINANCE_CTX.test(title)) return {ok:true,score:2,why:'company-token+finance-context'};
    if(exact&&FINANCE_CTX.test(title)) return {ok:true,score:2,why:'ticker+finance-context'};
    if(exact&&ticker.length>=5) return {ok:true,score:1,why:'distinct-ticker'};
    return {ok:false,score:0,why:exact?'ambiguous-ticker':'no-entity-match'};
  }
  function sourceQuality(source){
    const s=String(source||'');
    if(PRIMARY.test(s)) return {tier:0,label:'مصدر أولي/إفصاح',weight:0};
    if(TIER1.test(s)) return {tier:1,label:'مصدر مالي عالي الموثوقية',weight:1};
    if(TIER2.test(s)) return {tier:2,label:'مصدر مالي متخصص',weight:2};
    return {tier:3,label:'مصدر عام/غير مصنف',weight:3};
  }
  function enrichmentTimestamp(enrichment){
    const raw=enrichment?.updatedAt||enrichment?.snapshotTimestampUTC||enrichment?.timestampUTC||enrichment?.timestamp||null;
    const ts=Date.parse(raw||'');
    return Number.isFinite(ts)?ts:null;
  }
  const baseMerge=window.mergeEnrichment;
  if(typeof baseMerge==='function') window.mergeEnrichment=function(base,enrichment,marketTs){
    const out=baseMerge(base,enrichment,marketTs);
    const eTs=enrichmentTimestamp(enrichment);
    const mTs=Number.isFinite(Number(marketTs))?Number(marketTs):null;
    const lagMinutes=eTs!==null&&mTs!==null?Math.max(0,(mTs-eTs)/60000):null;
    const fresh=eTs!==null&&lagMinutes!==null&&lagMinutes<=ENRICHMENT_MAX_LAG_MINUTES;
    for(const x of out){
      x.enrichmentUpdatedAt=eTs;
      x.enrichmentLagMinutes=lagMinutes;
      x.enrichmentFresh=fresh;
      x.newsSweepVerified=Boolean(x.newsSweepVerified===true&&fresh);
      if(!fresh) x.newsSweepStatus='STALE_OR_UNTIMED_ENRICHMENT';
    }
    return out;
  };
  function classify(z){
    if(z.enrichmentFresh!==true){
      return {code:'ENRICHMENT_STALE',label:'Catalyst sweep قديم/غير متزامن',rank:6,attributionError:false,noNewsPath:false,candidate:null,sourceQuality:null,relevantCount:0,rejectedCount:0,enrichmentLagMinutes:z.enrichmentLagMinutes??null};
    }
    const signalTs=Date.parse(z.signalOrigin?.ts||'');
    const all=Array.isArray(z.catalystNewsTimeline)?z.catalystNewsTimeline:[];
    const tagged=all.map(n=>({...n,relevance:relevance(z,n),quality:sourceQuality(n.source)}));
    const relevant=tagged.filter(n=>n.relevance.ok);
    z.catalystRelevantTimeline=relevant;
    z.catalystRejectedNews=tagged.filter(n=>!n.relevance.ok);
    if(!Number.isFinite(signalTs)){
      const c=relevant[0]||null;
      return {code:c?'SIGNAL_TIME_UNKNOWN':'UNKNOWN',label:c?'خبر مرتبط · زمن الإشارة غير محسوم':'Catalyst غير محسوم',rank:5,attributionError:false,noNewsPath:false,candidate:c,sourceQuality:c?.quality||null,relevantCount:relevant.length,rejectedCount:z.catalystRejectedNews.length};
    }
    const cutoff=signalTs+15*60*1000;
    const pre=relevant.filter(n=>n.ts<=cutoff).sort((a,b)=>b.ts-a.ts);
    const post=relevant.filter(n=>n.ts>cutoff).sort((a,b)=>a.ts-b.ts);
    if(pre.length){
      const c=pre.sort((a,b)=>(a.quality.tier-b.quality.tier)||Math.abs(signalTs-a.ts)-Math.abs(signalTs-b.ts))[0];
      const age=Math.max(0,(signalTs-c.ts)/36e5);
      const stale=age>96;
      const base=age<=24?0:age<=96?1:4;
      return {code:stale?'STALE_PRE_SIGNAL':age<=24?'FRESH_PRE_SIGNAL':'RECENT_PRE_SIGNAL',label:stale?'خبر مرتبط لكنه قديم':age<=24?'محفز مرتبط قبل/مع الإشارة':'محفز مرتبط سابق للإشارة',rank:Math.min(5,base+c.quality.weight),attributionError:false,noNewsPath:false,candidate:c,ageAtSignalHours:age,sourceQuality:c.quality,relevantCount:relevant.length,rejectedCount:z.catalystRejectedNews.length};
    }
    if(post.length){
      const c=post.sort((a,b)=>(a.quality.tier-b.quality.tier)||(a.ts-b.ts))[0];
      return {code:'POST_SIGNAL_ONLY',label:'الأخبار المرتبطة جاءت بعد بداية الحركة',rank:4,attributionError:true,noNewsPath:false,candidate:c,sourceQuality:c.quality,relevantCount:relevant.length,rejectedCount:z.catalystRejectedNews.length};
    }
    if(relevant.length===0 && z.newsSweepVerified===true){
      const constructive=['ACCELERATING','BUILDING','STABLE'].includes(z.temporal?.trajectory);
      const early=['EARLY','FORMING'].includes(z.signalOrigin?.class);
      return {code:'NO_RELEVANT_NEWS_VERIFIED',label:'No-News Momentum · لا خبر مرتبط بعد sweep حديث',rank:constructive&&early?1:2,attributionError:false,noNewsPath:true,candidate:null,sourceQuality:null,relevantCount:0,rejectedCount:z.catalystRejectedNews.length};
    }
    return {code:'UNKNOWN',label:'Catalyst غير محسوم',rank:5,attributionError:false,noNewsPath:false,candidate:null,sourceQuality:null,relevantCount:relevant.length,rejectedCount:z.catalystRejectedNews.length};
  }
  const baseAnalyze=window.analyze;
  if(typeof baseAnalyze==='function') window.analyze=function(x){
    const z=baseAnalyze(x);
    z.catalystClock=classify(z);
    const c=z.catalystClock;
    if(c.code==='ENRICHMENT_STALE') z.reasons.push('Mandatory Fresh-Catalyst Sweep: enrichment قديم/غير مؤقت؛ Catalyst وNo-News محايدان');
    if(c.rejectedCount) z.reasons.push(`Catalyst Relevance: استبعاد ${c.rejectedCount} خبر غير مرتبط`);
    if(c.candidate&&c.sourceQuality) z.reasons.push(`Catalyst Source: ${c.sourceQuality.label} · ${c.candidate.source||'غير معروف'}`);
    return z;
  };
  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){
    baseRender();
    const log=document.querySelector('#integrityLog');
    if(log){
      const a=window.analyzed||[];
      const rejected=a.reduce((s,z)=>s+(z.catalystClock?.rejectedCount||0),0);
      const stale=a.filter(z=>z.catalystClock?.code==='ENRICHMENT_STALE').length;
      const q=[0,1,2,3].map(t=>a.filter(z=>z.catalystClock?.sourceQuality?.tier===t).length);
      const lag=a.find(z=>Number.isFinite(z.enrichmentLagMinutes))?.enrichmentLagMinutes;
      log.insertAdjacentHTML('beforeend',`<div class="log-item">Catalyst Quality ${BUILD}: enrichment=${stale?'STALE/BLOCKED':'fresh'}${Number.isFinite(lag)?` · lag=${lag.toFixed(1)}m / ${ENRICHMENT_MAX_LAG_MINUTES}m`:''} · rejected-irrelevant=${rejected} · primary=${q[0]} · tier1=${q[1]} · tier2=${q[2]} · general=${q[3]}. لا Catalyst/No-News credit من sweep قديم.</div>`);
    }
  };
  window.TAG500CatalystQuality={version:BUILD,maxLagMinutes:ENRICHMENT_MAX_LAG_MINUTES,classify,relevance,sourceQuality,enrichmentTimestamp};
})();