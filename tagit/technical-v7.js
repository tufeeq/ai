(() => {
  if (typeof classify !== 'function' || typeof render !== 'function' || typeof renderDetail !== 'function') return;
  const baseClassify = classify;
  const baseRender = render;
  const baseRenderDetail = renderDetail;
  const baseLocalFallback = typeof localFallback === 'function' ? localFallback : null;
  const num = v => (v == null || v === '' || !Number.isFinite(+v)) ? null : +v;
  const f = (v,d=2) => num(v)==null ? '—' : num(v).toLocaleString('en-US',{maximumFractionDigits:d});
  const techReady = x => x?.technicalCoverage === true && num(x?.technicalScore)!=null && num(x?.rsi14)!=null && num(x?.macdHist)!=null && num(x?.ema9)!=null && num(x?.ema20)!=null && num(x?.fibSupport)!=null;
  const techHealthy = x => techReady(x) && num(x.technicalScore)>=58 && num(x.rsi14)>=42 && num(x.rsi14)<=78 && num(x.macdHist)>=0 && num(x.ema9)>=num(x.ema20) && (num(x.volume5mRatio)==null || num(x.volume5mRatio)>=0.85) && (num(x.price)==null || num(x.fibSupport)==null || num(x.price)>=num(x.fibSupport)*0.992);
  const techBearish = x => techReady(x) && (num(x.technicalScore)<38 || (num(x.macdHist)<0 && num(x.ema9)<num(x.ema20)) || num(x.rsi14)>=84);

  classify = function(x) {
    const b = baseClassify(x);
    const ready = techReady(x), healthy = techHealthy(x), bearish = techBearish(x);
    let state=b.state, risk=b.risk, quality=b.quality;
    const reasons=[b.reasons].filter(Boolean);
    if (!ready) {
      if (state==='CONFIRMED') state='VERIFY';
      risk=Math.min(100,risk+18);quality=Math.min(64,quality);
      reasons.push('Technical pending — لا تأكيد بدون RSI/MACD/Fib');
    } else {
      const ts=num(x.technicalScore),rsi=num(x.rsi14),mh=num(x.macdHist),vr=num(x.volume5mRatio);
      quality=Math.max(0,Math.min(100,Math.round(quality*.64+ts*.36)));
      if (state==='CONFIRMED' && !healthy) state=bearish?'COOLING':'VERIFY';
      if (bearish && state!=='EXTENDED') state='COOLING';
      if (rsi>=80) risk=Math.min(100,risk+12);
      if (ts<45) risk=Math.min(100,risk+10);
      reasons.push(`Tech ${f(ts,0)}/100 · RSI ${f(rsi,1)} · MACD ${mh>=0?'+':''}${f(mh,4)}`);
      reasons.push(`EMA9 ${f(x.ema9,3)} / EMA20 ${f(x.ema20,3)} · Vol5m ${f(vr,2)}x`);
      reasons.push(`Fib ${x.fibTrend||'—'} S $${f(x.fibSupport,3)} / R $${f(x.fibResistance,3)}`);
    }
    return {...b,state,risk,quality,technicalReady:ready,technicalHealthy:healthy,technicalScore:num(x.technicalScore),reasons:reasons.join(' · ')};
  };

  if (baseLocalFallback) {
    localFallback = function(x) {
      const parts=[baseLocalFallback(x)];
      if (techReady(x)) {
        parts.push(`القراءة الفنية ${f(x.technicalScore,0)}/100، RSI ${f(x.rsi14,1)}، MACD histogram ${num(x.macdHist)>=0?'موجب':'سالب'}، EMA9 ${num(x.ema9)>=num(x.ema20)?'فوق':'تحت'} EMA20`);
        parts.push(`الفوليوم 5 دقائق ${f(x.volume5mRatio,2)}x، ودعم/مقاومة Fibonacci عند $${f(x.fibSupport,3)} / $${f(x.fibResistance,3)}`);
      } else parts.push('التأكيد الفني RSI/MACD/EMA/Fibonacci لم يكتمل بعد؛ لا أرفع السهم إلى Confirmed.');
      return parts.filter(Boolean).join(' · ');
    };
  }

  function addStyles(){
    if(document.getElementById('tagit-tech-v7-style'))return;
    const s=document.createElement('style');s.id='tagit-tech-v7-style';s.textContent=`
      .tech-chip{border-color:rgba(88,211,255,.35)!important;background:rgba(35,168,210,.08)!important}
      .tech-chip.good{color:#5be0a0!important;border-color:rgba(91,224,160,.4)!important}
      .tech-chip.bad{color:#ff8b8b!important;border-color:rgba(255,107,107,.4)!important}
      .tech-panel{margin-top:12px;padding:12px;border:1px solid rgba(88,211,255,.2);border-radius:12px;background:rgba(10,42,61,.3)}
      .tech-panel h4{margin:0 0 10px;font-size:12px;color:#7fe7ff}.tech-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      .tech-grid div{padding:8px;border:1px solid rgba(255,255,255,.08);border-radius:9px}.tech-grid span{display:block;font-size:10px;opacity:.65}.tech-grid b{font-size:12px}
      .technical-pending{color:#ffbd66}
    `;document.head.appendChild(s);
  }
  function rowFor(symbol){return enriched().find(z=>z.ticker===symbol);}
  function patchCards(){
    document.querySelectorAll('.opp[data-symbol]').forEach(card=>{
      const x=rowFor(String(card.dataset.symbol||'').toUpperCase());if(!x)return;const chips=card.querySelector('.chips');if(!chips)return;
      chips.querySelectorAll('[data-tech-v7]').forEach(el=>el.remove());
      const mk=(txt,cls='')=>{const e=document.createElement('span');e.dataset.techV7='1';e.className=`tech-chip ${cls}`;e.textContent=txt;chips.appendChild(e)};
      if(!techReady(x)){mk('Tech pending','bad');return;}
      mk(`Tech ${f(x.technicalScore,0)}`,techHealthy(x)?'good':techBearish(x)?'bad':'');mk(`RSI ${f(x.rsi14,1)}`);mk(`Vol5 ${f(x.volume5mRatio,2)}x`);
    });
  }
  renderDetail = function(){
    baseRenderDetail();const host=document.querySelector('#detail');const x=enriched().find(z=>z.ticker===app.selected)||enriched()[0];if(!host||!x)return;
    host.querySelectorAll('.tech-panel').forEach(e=>e.remove());
    const p=document.createElement('section');p.className='tech-panel';
    if(!techReady(x)) p.innerHTML='<h4>TECHNICAL CONFIRMATION</h4><div class="technical-pending">بانتظار RSI / MACD / EMA / Fibonacci / 5m volume — لا يتم اعتماد Confirmed بدونها.</div>';
    else p.innerHTML=`<h4>TECHNICAL CONFIRMATION · ${f(x.technicalScore,0)}/100 · ${x.technicalBias||'—'}</h4><div class="tech-grid"><div><span>RSI(14)</span><b>${f(x.rsi14,1)}</b></div><div><span>MACD Hist</span><b>${num(x.macdHist)>=0?'+':''}${f(x.macdHist,4)}</b></div><div><span>EMA 9 / 20</span><b>${f(x.ema9,3)} / ${f(x.ema20,3)}</b></div><div><span>5m Relative Volume</span><b>${f(x.volume5mRatio,2)}x</b></div><div><span>Volume Trend</span><b>${f(x.volumeTrend,2)}x</b></div><div><span>Buy-volume proxy</span><b>${f(x.buyVolumePct,1)}%</b></div><div><span>Fibonacci Support</span><b>$${f(x.fibSupport,3)}</b></div><div><span>Fibonacci Resistance</span><b>$${f(x.fibResistance,3)}</b></div></div>`;
    const btn=host.querySelector('.analyze.wide');if(btn)host.insertBefore(p,btn);else host.appendChild(p);
  };
  render = function(){baseRender();patchCards();};
  addStyles();
  const hero=document.querySelector('.hero p');if(hero)hero.textContent='يرصد دخول السيولة والزخم، ويؤكد الفرصة عبر RSI وMACD وEMA والفوليوم 5m ومستويات Fibonacci قبل رفعها إلى Confirmed.';
  const hint=document.querySelector('.detail-panel .hint');if(hint)hint.textContent='الجودة والاستمرارية والمخاطر + RSI/MACD/EMA/Fibonacci والفوليوم الفني.';
  const footer=document.querySelector('.footer');if(footer)footer.textContent='TAGit Live 7 Technical Confirmation · 5s UI polling · RSI · MACD · EMA · 5m Volume · Fibonacci · AI research layer';
  setTimeout(()=>{try{render()}catch(e){console.warn('TAGit technical overlay render',e)}},0);
})();
