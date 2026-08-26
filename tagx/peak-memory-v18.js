'use strict';
(function(){
  const RELEASE='TAGX 1.6 · PEAK-MEMORY CHALLENGER';
  const oldStage=stage, oldTrace=trace, oldEligible=eligible, oldReason=reason, oldRender=render;
  let ledger={tickers:{},sessionDateET:null};

  const qnum=v=>{const n=parseFloat(v);return Number.isFinite(n)?n:null};

  function applyLedger(){
    const lm=ledger?.tickers||{};
    for(const x of rows){
      const z=lm[x.Ticker]; if(!z) continue;
      const peak=qnum(z.maxChangePct), first=qnum(z.firstChangePct), last=qnum(z.lastChangePct), current=N(x.Change);
      x._tagxLedgerFirstChangePct=first;
      x._tagxLedgerPeakChangePct=peak;
      x._tagxLedgerLastChangePct=last;
      x._tagxLedgerOriginClass=String(z.originClass||'').toUpperCase();
      x._tagxLedgerFirstSeenET=z.firstSeenET||null;
      x._tagxLedgerLastSeenET=z.lastSeenET||null;
      x._tagxPeakGivebackPts=(peak!=null&&current!=null)?peak-current:null;
      x._tagxPeakRetention=(peak!=null&&peak>0&&current!=null)?current/peak:null;
    }
    rowMap=new Map(rows.map(x=>[x.Ticker,x]));
  }

  stage=function(x){
    const c=N(x.Change), peak=qnum(x._tagxLedgerPeakChangePct), give=qnum(x._tagxPeakGivebackPts), origin=String(x._tagxLedgerOriginClass||'');
    // Immutable origin protection: a stock first seen late can never reset to Early later in the session.
    if(origin==='LATE'){
      if(give!=null&&give>=8)return'EXHAUSTION';
      return'LATE';
    }
    // Session-peak memory: once a stock has already been a major runner, preserve that context.
    if(peak!=null&&peak>=50)return'EXHAUSTION';
    if(peak!=null&&peak>=25){
      if(give!=null&&give>=8)return'EXHAUSTION';
      return'LATE';
    }
    if(peak!=null&&peak>=15&&give!=null&&give>=8&&c!=null&&c>=5)return'EXHAUSTION';
    return oldStage(x);
  };

  trace=function(x){
    const t=oldTrace(x),peak=qnum(x._tagxLedgerPeakChangePct),give=qnum(x._tagxPeakGivebackPts),ret=qnum(x._tagxPeakRetention),origin=String(x._tagxLedgerOriginClass||''),fi=firstInfo(x);
    let s=t.score,up=[...(t.up||[])],down=[...(t.down||[])];
    if(origin==='LATE'){s-=24;down.push('Immutable late origin -24')}
    if(peak!=null&&peak>=25){s-=20;down.push('Session peak already ≥25% -20')}
    if(give!=null&&give>=15){s-=30;down.push('Peak giveback ≥15pt -30')}
    else if(give!=null&&give>=10){s-=22;down.push('Peak giveback ≥10pt -22')}
    else if(give!=null&&give>=8){s-=16;down.push('Peak giveback ≥8pt -16')}
    else if(give!=null&&give>=5){s-=7;down.push('Peak retention weakening -7')}
    if(peak!=null&&peak>=8&&peak<20&&ret!=null&&ret>=0.8&&fi.ch!=null&&fi.ch<10){s+=5;up.push('Strong session-peak retention +5')}
    return{...t,score:Math.max(0,Math.min(100,Math.round(s))),up,down};
  };

  eligible=function(x){
    const st=stage(x);
    if(st==='LATE'||st==='EXHAUSTION')return false;
    return oldEligible(x);
  };

  reason=function(x){
    const base=oldReason(x),peak=qnum(x._tagxLedgerPeakChangePct),give=qnum(x._tagxPeakGivebackPts),origin=String(x._tagxLedgerOriginClass||'');
    if(origin==='LATE')return'رصد أولي متأخر · '+base;
    if(peak!=null&&give!=null&&give>=8)return'فقد من قمة الجلسة · '+base;
    return base;
  };

  render=function(){
    applyLedger();
    oldRender();
    const st=document.querySelector('#status');
    if(st&&!st.querySelector('[data-peakmemory]')){
      const e=document.createElement('span');e.className='chip';e.dataset.peakmemory='1';e.textContent='Peak-memory gate';st.appendChild(e);
    }
    document.querySelectorAll('#topOpps .opp[data-ticker]').forEach(card=>{
      const x=rowMap.get(card.dataset.ticker);if(!x)return;
      const peak=qnum(x._tagxLedgerPeakChangePct),give=qnum(x._tagxPeakGivebackPts);
      if(peak==null)return;
      let n=card.querySelector('.pm18');if(!n){n=document.createElement('div');n.className='meta pm18';card.appendChild(n)}
      n.textContent='Session peak '+F(peak)+(give!=null?' · Giveback '+F(-give):'');
    });
  };

  async function refreshLedger(){
    try{
      const r=await fetch('https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/discovery-ledger.json?v='+Date.now(),{cache:'no-store'});
      if(!r.ok)return;const j=await r.json();
      if(j?.tickers){ledger=j;applyLedger();render()}
    }catch(e){console.warn('TAGX peak-memory challenger',e)}
  }

  window.TAGXPeakMemoryV18={release:RELEASE,getLedger:()=>ledger};
  refreshLedger();
  setInterval(refreshLedger,120000);
})();
