'use strict';
(function(){
  const BUILD='TAG550';
  const KEY='tag500.temporal.v509';
  const LEGACY='tag500.temporal.v508';
  const TZ='America/New_York';
  const n=v=>Number.isFinite(+v)?+v:null;
  function read(){
    try{
      let raw=localStorage.getItem(KEY);
      if(!raw) raw=localStorage.getItem(LEGACY);
      const x=JSON.parse(raw||'{}');
      return x&&typeof x==='object'?x:{};
    }catch{return {};}
  }
  function etParts(ts){
    try{
      const p=new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ts));
      const m=Object.fromEntries(p.map(x=>[x.type,x.value]));
      return {date:`${m.year}-${m.month}-${m.day}`,minutes:(+m.hour)*60+(+m.minute)};
    }catch{return null;}
  }
  function session(ts){
    const p=etParts(ts); if(!p) return null;
    const x=p.minutes;
    const code=x>=240&&x<570?'PRE':x>=570&&x<960?'RTH':x>=960&&x<1200?'AH':'CLOSED';
    return {...p,code};
  }
  function metrics(ticker,currentChange,anchorTs){
    const anchor=session(anchorTs);
    if(!anchor||anchor.code==='CLOSED') return {count:0,firstSeen:null,delta:null,slope:null,retention:null,trajectory:'NO_HISTORY',source:'LOCAL_SESSION_SCOPED',scope:null,discarded:0};
    const db=read();
    const all=Array.isArray(db[ticker])?db[ticker]:[];
    const scoped=[]; let discarded=0;
    for(const o of all){
      const ts=n(o?.ts),change=n(o?.change),s=Number.isFinite(ts)?session(ts):null;
      if(!s||!Number.isFinite(change)){discarded++;continue;}
      if(s.date===anchor.date&&s.code===anchor.code) scoped.push({ts,change}); else discarded++;
    }
    scoped.sort((a,b)=>a.ts-b.ts);
    if(!scoped.length) return {count:0,firstSeen:null,delta:null,slope:null,retention:null,trajectory:'NO_HISTORY',source:'LOCAL_SESSION_SCOPED',scope:`${anchor.date}/${anchor.code}`,discarded};
    const first=scoped[0];
    const points=scoped.slice();
    if(Number.isFinite(currentChange)&&!points.some(o=>o.ts===anchorTs)) points.push({ts:anchorTs,change:currentChange});
    const peak=Math.max(...points.map(o=>o.change));
    const retention=peak>0&&Number.isFinite(currentChange)?Math.max(0,Math.min(1,currentChange/peak)):null;
    let slope=null;
    if(points.length>=2){
      const t0=points[0].ts,xs=points.map(o=>(o.ts-t0)/36e5),ys=points.map(o=>o.change);
      const xm=xs.reduce((a,b)=>a+b,0)/xs.length,ym=ys.reduce((a,b)=>a+b,0)/ys.length;
      let num=0,den=0; for(let i=0;i<xs.length;i++){num+=(xs[i]-xm)*(ys[i]-ym);den+=(xs[i]-xm)**2;} if(den>0)slope=num/den;
    }
    let trajectory='STABLE';
    if(!Number.isFinite(slope)||!Number.isFinite(retention)) trajectory='NO_HISTORY';
    else if(slope>=3&&retention>=.75) trajectory='ACCELERATING';
    else if(slope>=.5&&retention>=.65) trajectory='BUILDING';
    else if(slope<=-2||retention<.55) trajectory='FADING';
    return {count:scoped.length,firstSeen:first.ts,delta:Number.isFinite(currentChange)?currentChange-first.change:null,slope,retention,trajectory,source:'LOCAL_SESSION_SCOPED',scope:`${anchor.date}/${anchor.code}`,discarded};
  }
  const baseAnalyze=window.analyze;
  if(typeof baseAnalyze==='function') window.analyze=function(x){
    const z=baseAnalyze(x);
    if(z?.temporal?.source==='CENTRAL_PIPELINE') return z;
    const anchor=Date.parse(window.sourceMeta?.updated||window.sourceMeta?.snapshotTimestampUTC||'');
    if(!Number.isFinite(anchor)) return z;
    const m=metrics(z.ticker,z.changePct,anchor);
    z.temporal=m;
    z.centralPersistence=false;
    z.localTemporalSessionScope=m.scope;
    z.localTemporalDiscarded=m.discarded;
    if(m.discarded>0){
      z.reasons=z.reasons||[];
      z.reasons.push(`Local temporal scoped to ${m.scope||'current session'} · ${m.discarded} نقطة من جلسة/تاريخ آخر مستبعدة`);
    }
    return z;
  };
  const baseRender=window.render;
  if(typeof baseRender==='function') window.render=function(){
    baseRender();
    const a=window.analyzed||[];
    const scoped=a.filter(z=>z.localTemporalSessionScope).length;
    const discarded=a.reduce((s,z)=>s+(Number.isFinite(z.localTemporalDiscarded)?z.localTemporalDiscarded:0),0);
    const log=document.querySelector('#integrityLog');
    if(log) log.insertAdjacentHTML('beforeend',`<div class="log-item">Session-Scoped Local Temporal ${BUILD}: ${scoped} سهم بذاكرة محلية مقيدة بتاريخ الجلسة ونوعها PRE/RTH/AH · ${discarded} نقطة قديمة/عابرة للجلسة مستبعدة. السجل المحلي Research Only ولا يغيّر score أو Actionability.</div>`);
  };
  window.TAG500SessionTemporalScope={build:BUILD,metrics,session};
  window.dispatchEvent(new CustomEvent('tag500:runtime-ready',{detail:{layer:'sessionTemporalScope',build:BUILD}}));
})();
