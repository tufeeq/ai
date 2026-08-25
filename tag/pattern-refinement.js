'use strict';

(function(){
  const state={ledger:null,loaded:false};
  const baseAnalyze=typeof analyze==='function'?analyze:null;
  const baseRender=typeof render==='function'?render:null;

  function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
  function cap(v,a=0,b=100){return Math.max(a,Math.min(b,v));}

  function enrichRow(row,rec){
    if(!rec) return row;
    row.firstSeenET=rec.firstSeenET||null;
    row.firstChangePct=n(rec.firstChangePct);
    row.firstVolume=n(rec.firstVolume);
    row.firstPrice=n(rec.firstPrice);
    row.maxObservedChangePct=n(rec.maxChangePct);
    row.maxObservedVolume=n(rec.maxVolume);
    row.discoveryObservations=n(rec.observations);
    row.originClass=rec.originClass||null;
    return row;
  }

  function patternMetrics(x){
    const fv=n(x.firstVolume), fp=n(x.firstPrice), fc=n(x.firstChangePct);
    const cv=n(x.volume), cp=n(x.price), obs=n(x.discoveryObservations);
    const volumeExpansion=fv!==null&&fv>0&&cv!==null?cv/fv:null;
    const moveFromFirst=fp!==null&&fp>0&&cp!==null?(cp-fp)/fp*100:null;
    const quietBase=fc!==null&&Math.abs(fc)<=4;
    const participation=volumeExpansion!==null?cap(Math.log10(1+volumeExpansion)*35):null;
    const displacement=moveFromFirst!==null?cap(Math.max(0,moveFromFirst)*3.1):null;
    const persistence=obs!==null?cap(obs*8):null;
    const quietScore=quietBase?88:(fc!==null&&Math.abs(fc)<=8?58:25);
    const vals=[[participation,.45],[displacement,.28],[quietScore,.17],[persistence,.10]].filter(([v])=>v!==null);
    const patternScore=vals.length?vals.reduce((s,[v,w])=>s+v*w,0)/vals.reduce((s,[,w])=>s+w,0):null;
    const priceHolding=moveFromFirst===null||(moveFromFirst>=-2&&moveFromFirst<18);
    const currentHolding=n(x.changePct)===null||n(x.changePct)>-4;
    const latentIgnition=quietBase&&volumeExpansion!==null&&volumeExpansion>=4&&cv>=2500&&priceHolding&&currentHolding;
    return {volumeExpansion,moveFromFirst,quietBase,participation,displacement,persistence,patternScore,latentIgnition};
  }

  if(baseAnalyze){
    analyze=function(x){
      const b=baseAnalyze(x);
      const p=patternMetrics(b);
      let score=b.score,early=b.early,ignition=b.ignition,stage=b.stage;
      if(Number.isFinite(p.patternScore)){
        if(Number.isFinite(early)) early=cap(early*.72+p.patternScore*.28);
        if(Number.isFinite(ignition)) ignition=cap(ignition*.68+p.patternScore*.32);
        if(Number.isFinite(score)) score=cap(score*.78+p.patternScore*.22);
      }
      if(p.latentIgnition&&b.valid&&!['LATE','EXHAUSTION'].includes(stage)){
        ignition=Math.max(Number.isFinite(ignition)?ignition:0,66);
        score=Math.max(Number.isFinite(score)?score:0,60);
        stage='IGNITION';
      }
      const reasons=[...(b.reasons||[])];
      if(p.quietBase&&Number.isFinite(p.volumeExpansion)&&p.volumeExpansion>=4) reasons.unshift('تسارع مشاركة من قاعدة هادئة');
      if(Number.isFinite(p.volumeExpansion)&&p.volumeExpansion>=3) reasons.push(`الحجم منذ أول رصد ${p.volumeExpansion.toFixed(1)}×`);
      if(Number.isFinite(p.moveFromFirst)&&Math.abs(p.moveFromFirst)>=3) reasons.push(`من أول رصد ${p.moveFromFirst>=0?'+':''}${p.moveFromFirst.toFixed(1)}%`);
      return {...b,...p,early,ignition,score,stage,reasons};
    };
  }

  function decoratePatternUI(){
    if(!Array.isArray(analyzed)) return;
    const byTicker=new Map(analyzed.map(x=>[x.ticker,x]));
    document.querySelectorAll('#scannerBody tr[data-ticker]').forEach(tr=>{
      const x=byTicker.get(tr.dataset.ticker); if(!x) return;
      tr.classList.toggle('pattern-ignition',!!x.latentIgnition);
      const tickerCell=tr.querySelector('td.ticker');
      if(tickerCell&&x.latentIgnition&&!tickerCell.querySelector('.pattern-dot')) tickerCell.insertAdjacentHTML('beforeend',' <span class="pattern-dot" title="تسارع مبكر">●</span>');
    });
    const top=document.querySelector('#topOpportunity');
    const best=analyzed.filter(x=>x.valid&&Number.isFinite(x.patternScore)).sort((a,b)=>b.patternScore-a.patternScore)[0];
    if(top){
      top.querySelector('.pattern-note')?.remove();
      if(best&&best.patternScore>=55) top.insertAdjacentHTML('beforeend',`<div class="pattern-note"><b>بصمة الحركة المبكرة</b><span>${best.patternScore.toFixed(0)}/100</span><small>${best.quietBase?'قاعدة هادئة · ':''}${Number.isFinite(best.volumeExpansion)?'توسع حجم '+best.volumeExpansion.toFixed(1)+'× · ':''}${Number.isFinite(best.moveFromFirst)?'من أول رصد '+(best.moveFromFirst>=0?'+':'')+best.moveFromFirst.toFixed(1)+'%':''}</small></div>`);
    }
  }

  if(baseRender){
    render=function(){
      const v=baseRender.apply(this,arguments);
      queueMicrotask(decoratePatternUI);
      return v;
    };
  }

  async function loadLedger(){
    try{
      const r=await fetch(`./data/discovery-ledger.json?v=${Date.now()}`,{cache:'no-store'});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const payload=await r.json();
      const tickers=payload&&payload.tickers?payload.tickers:{};
      if(Array.isArray(rows)){
        for(const row of rows) enrichRow(row,tickers[row.ticker]);
        state.ledger=payload;state.loaded=true;
        if(typeof render==='function') render();
      }
    }catch(e){console.warn('TAGX pattern ledger unavailable',e);}
  }

  function boot(){setTimeout(loadLedger,1600);setInterval(loadLedger,5*60*1000);}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();