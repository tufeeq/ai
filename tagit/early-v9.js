(() => {
  if (typeof app==='undefined' || typeof updateMemory!=='function' || typeof currentRows!=='function' || typeof classify!=='function' || typeof render!=='function') return;
  const baseUpdateMemory=updateMemory, baseCurrentRows=currentRows, baseClassify=classify, baseVisible=typeof visible==='function'?visible:null, baseRender=render;
  const num=v=>(v==null||v===''||!Number.isFinite(+v))?null:+v;
  const fmt=(v,d=0)=>num(v)==null?'—':num(v).toFixed(d);

  updateMemory=function(live){
    baseUpdateMemory(live);
    const snap=live?.updatedAtUTC||live?.updatedAtET;
    if(!snap)return;
    const now=Date.now();
    for(const x of live?.earlyCandidates||[]){
      const k=String(x?.ticker||'').toUpperCase(); if(!k)continue;
      const m=app.memory[k]||{hits:0,prev:null,last:null,seenAt:0,row:null};
      if(m.last?.snap===snap){m.row={...(m.row||{}),...x,preBreakout:true};m.seenAt=now;app.memory[k]=m;continue;}
      m.prev=m.last;
      m.last={price:num(x.price),score:num(x.earlyBreakoutScore)??num(x.earlyRegimeShiftScore),v5:num(x.priceVelocity5mPct),v15:num(x.priceVelocity15mPct),snap};
      m.row={...(m.row||{}),...x,preBreakout:true};m.hits++;m.seenAt=now;app.memory[k]=m;
    }
    try{save()}catch{}
  };

  currentRows=function(){
    const rows=baseCurrentRows(); const map=new Map(rows.map(x=>[String(x.ticker||'').toUpperCase(),x]));
    for(const x of app.live?.earlyCandidates||[]){
      const t=String(x?.ticker||'').toUpperCase();if(!t)continue;
      map.set(t,{...(map.get(t)||{}),...x,ticker:t,preBreakout:true,retained:false});
    }
    return [...map.values()];
  };

  classify=function(x){
    const b=baseClassify(x), early=x?.preBreakout===true || num(x?.earlyBreakoutScore)>=68;
    if(!early)return b;
    const es=num(x.earlyBreakoutScore)||0, tech=num(x.technicalScore), ch=num(x.changePct), buy=num(x.buyVolumePct), r15=num(x.range15mPct);
    let state=b.state, risk=b.risk, quality=b.quality, persistence=b.persistence;
    if(state==='EXTENDED' && ch!=null && ch<10) state='VERIFY';
    if(state==='COOLING' && num(x.priceVelocity5mPct)!=null && num(x.priceVelocity5mPct)>=-.4) state='VERIFY';
    quality=Math.max(quality,Math.min(88,Math.round(es*.72+(tech||50)*.28)));
    persistence=Math.max(persistence,Math.min(90,Math.round(es*.62+(buy||50)*.18+((r15!=null&&r15<=3)?18:8))));
    if((app.memory[x.ticker]?.hits||0)<2) state='VERIFY';
    if(ch!=null && ch>=10) state=b.state;
    risk=Math.max(0,risk-(tech!=null&&tech>=60?8:0));
    const extra=`EARLY ${fmt(es)} · Range15 ${r15==null?'—':fmt(r15,2)+'%'} · BuyVol ${buy==null?'—':fmt(buy,1)+'%'}`;
    return {...b,state,risk,quality,persistence,preBreakout:true,earlyBreakoutScore:es,reasons:[b.reasons,extra].filter(Boolean).join(' · ')};
  };

  if(baseVisible){
    visible=function(){
      let xs=enriched();
      if(app.filter==='EARLY') xs=xs.filter(x=>x.preBreakout===true || num(x.earlyBreakoutScore)>=68);
      else if(app.filter==='ACCUMULATION') xs=xs.filter(x=>x.accumulation);
      else if(app.filter!=='ALL') xs=xs.filter(x=>x.state===app.filter);
      return xs;
    };
  }

  function patch(){
    document.querySelectorAll('.opp[data-symbol]').forEach(card=>{
      const t=String(card.dataset.symbol||'').toUpperCase(); const x=enriched().find(z=>z.ticker===t); if(!x?.preBreakout)return;
      const top=card.querySelector('.opp-top>div'); if(top && !top.querySelector('.state.early')){const s=document.createElement('span');s.className='state early';s.textContent=`EARLY ${Math.round(num(x.earlyBreakoutScore)||0)}`;top.appendChild(s)}
    });
  }
  render=function(){baseRender();patch();};

  if(!document.getElementById('tagit-early-v9-style')){
    const s=document.createElement('style');s.id='tagit-early-v9-style';s.textContent='.state.early{color:#7ff0ff;border-color:rgba(127,240,255,.45);background:rgba(127,240,255,.08)}.opp:has(.state.early){box-shadow:inset 0 0 0 1px rgba(127,240,255,.05)}';document.head.appendChild(s);
  }
  setTimeout(()=>{try{updateMemory(app.live||{});render()}catch(e){console.warn('TAGit early v9 overlay',e)}},0);
})();
