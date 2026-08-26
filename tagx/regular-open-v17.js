'use strict';
(function(){
  const RELEASE='TAGX 1.6 · FIRST-HOUR PATCH';
  const oldStage=stage, oldTrace=trace, oldEligible=eligible, oldReason=reason, oldRender=render;
  let handoff={quotes:{},updatedAtUTC:null,updatedAtET:null};

  const ageMin=v=>{const t=Date.parse(v||'');return Number.isFinite(t)?(Date.now()-t)/60000:1e9};
  const qnum=v=>{const n=parseFloat(v);return Number.isFinite(n)?n:null};

  function decorate(){
    const qm=handoff?.quotes||{};
    for(const x of rows){
      const q=qm[x.Ticker]; if(!q) continue;
      const pm=qnum(q.preMarketChangePct), reg=qnum(q.changePct), qa=ageMin(q.timestampET||handoff.updatedAtUTC||handoff.updatedAtET);
      x._tagxPreMarketChangePct=pm;
      x._tagxOpenQuoteChangePct=reg;
      x._tagxOpenQuoteAgeMin=qa;
      if(pm!=null&&N(x.Change)!=null){
        x._tagxPmGivebackPts=pm-N(x.Change);
        x._tagxPmRetention=pm>0?N(x.Change)/pm:null;
      }
      // Current regular quote may replace Discovery only while genuinely fresh.
      if(q.session==='regular'&&qa<=10&&qnum(q.price)!=null&&reg!=null){
        x.Price=String(qnum(q.price));
        x.Change=reg.toFixed(2)+'%';
        x._tagxRegularLive=true;
      }
    }
    rowMap=new Map(rows.map(x=>[x.Ticker,x]));
  }

  stage=function(x){
    const c=N(x.Change),pm=qnum(x._tagxPreMarketChangePct),give=qnum(x._tagxPmGivebackPts);
    // Do not let a stock that was already late in pre-market reset into an actionable stage after fading.
    if(pm!=null&&pm>=50)return'EXHAUSTION';
    if(pm!=null&&pm>=25){
      if(give!=null&&give>=8)return'EXHAUSTION';
      return'LATE';
    }
    // Strong pre-market move that loses >=8 percentage points by/after open = distribution warning.
    if(pm!=null&&pm>=15&&give!=null&&give>=8&&c!=null&&c>=5)return'EXHAUSTION';
    return oldStage(x);
  };

  trace=function(x){
    const t=oldTrace(x),pm=qnum(x._tagxPreMarketChangePct),give=qnum(x._tagxPmGivebackPts),ret=qnum(x._tagxPmRetention),c=N(x.Change),fi=firstInfo(x);
    let s=t.score,up=[...(t.up||[])],down=[...(t.down||[])];
    if(pm!=null&&pm>=25){s-=24;down.push('كان Late قبل الافتتاح -24')}
    if(give!=null&&give>=10){s-=22;down.push('توزيع بعد premarket -22')}
    else if(give!=null&&give>=8){s-=16;down.push('فقد مكاسب premarket -16')}
    else if(give!=null&&give>=5){s-=8;down.push('Retention ضعيف -8')}
    if(pm!=null&&pm>=8&&pm<20&&ret!=null&&ret>=0.65&&c!=null&&c>=5&&fi.ch!=null&&fi.ch<10){s+=7;up.push('احتفاظ جيد من premarket +7')}
    return{...t,score:Math.max(0,Math.min(100,Math.round(s))),up,down};
  };

  eligible=function(x){
    const st=stage(x);
    if(st==='LATE'||st==='EXHAUSTION')return false;
    return oldEligible(x);
  };

  reason=function(x){
    const base=oldReason(x),pm=qnum(x._tagxPreMarketChangePct),give=qnum(x._tagxPmGivebackPts),ret=qnum(x._tagxPmRetention);
    if(pm!=null&&give!=null&&give>=8)return'فقد مكاسب premarket · '+base;
    if(pm!=null&&ret!=null&&ret>=0.65&&pm>=8)return'احتفاظ جيد من premarket · '+base;
    return base;
  };

  render=function(){
    decorate();
    oldRender();
    const st=document.querySelector('#status');
    if(st&&!st.querySelector('[data-firsthour]')){
      const e=document.createElement('span');e.className='chip';e.dataset.firsthour='1';e.textContent='First-hour retention gate';st.appendChild(e);
    }
    document.querySelectorAll('#topOpps .opp[data-ticker]').forEach(card=>{
      const x=rowMap.get(card.dataset.ticker);if(!x)return;
      const pm=qnum(x._tagxPreMarketChangePct),give=qnum(x._tagxPmGivebackPts);
      if(pm==null)return;
      let n=card.querySelector('.fh17');if(!n){n=document.createElement('div');n.className='meta fh17';card.appendChild(n)}
      n.textContent='PM '+F(pm)+(give!=null?' · Giveback '+F(-give):'');
    });
  };

  async function refreshHandoff(){
    try{
      const r=await fetch('https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/live-quotes.json?v='+Date.now(),{cache:'no-store'});
      if(!r.ok)return; const j=await r.json();
      if(j?.quotes){handoff=j;decorate();render()}
    }catch(e){console.warn('TAGX first-hour handoff',e)}
  }

  window.TAGXFirstHourPatch={release:RELEASE,getHandoff:()=>handoff};
  refreshHandoff();
  setInterval(refreshHandoff,60000);
})();