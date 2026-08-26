'use strict';
(function(){
 const URL='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/extended-hot.json';
 const MAX_WATCH_AGE=45;
 const LIVE_AGE=15;
 function mins(t){const x=t?new Date(t).getTime():NaN;return Number.isFinite(x)?(Date.now()-x)/60000:1e9}
 function N(v){const x=parseFloat(v);return Number.isFinite(x)?x:null}
 function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
 function money(v){return v==null?'—':'$'+(+v).toFixed(v<1?3:2)}
 function pct(v){return v==null?'—':(v>=0?'+':'')+(+v).toFixed(1)+'%'}
 function score(r){const ch=N(r.sessionChangePct)||0,v15=N(r.priceVelocity15mPct)||0,v5=N(r.priceVelocity5mPct)||0;let s=54+Math.min(28,ch*2.1)+Math.max(-10,Math.min(10,v15*1.45))+Math.max(-4,Math.min(4,v5*.7));if(ch>=8&&v15>=0)s+=5;if(ch>=5&&v15>=2)s+=4;if(v15<=-3)s-=12;if(ch>=25&&v15<=1)s-=8;return Math.max(0,Math.min(98,Math.round(s)))}
 function stage(r){const ch=N(r.sessionChangePct)||0,v15=N(r.priceVelocity15mPct)||0;if(ch>=35)return'EXHAUSTION';if(ch>=20&&v15<1)return'LATE';if(ch>=12&&v15>=0)return'BREAKOUT';if(ch>=7&&v15>=-1)return'EARLY';if(ch>=3&&v15>=0)return'BUILDING';if(v15>=3)return'ACCEL';return'WATCH'}
 async function sync(){
  try{
   const r=await fetch(URL+'?v='+Date.now(),{cache:'no-store'});if(!r.ok)return;
   const j=await r.json(),age=mins(j.updatedAtUTC);if(j.session!=='after-hours'||age>MAX_WATCH_AGE)return;
   const host=document.querySelector('#topOpps'),status=document.querySelector('#status');if(!host)return;
   const rows=Object.values(j.rows||{}).filter(x=>{const ch=N(x.sessionChangePct),v=N(x.priceVelocity15mPct),ts=x.timestampUTC;if(ch==null||ch<3||!ts)return false;if(mins(ts)>MAX_WATCH_AGE)return false;if(v!=null&&v<=-5)return false;return score(x)>=65}).sort((a,b)=>score(b)-score(a)).slice(0,10);
   if(!rows.length)return;
   const live=age<=LIVE_AGE;
   // Only replace an empty/stale-gated opportunity area. Never overwrite a fresher native render.
   const text=(host.textContent||'');const hasFreshCards=host.querySelector('.ah-opportunity')&&!text.includes('تم إيقاف التوصيات');
   if(!live&&hasFreshCards)return;
   host.innerHTML=rows.map((x,i)=>{const t=String(x.ticker||'').toUpperCase(),sc=score(x),st=stage(x);return '<article class="opp ah-opportunity '+(i===0?'best':'extra')+'" data-ticker="'+esc(t)+'"><div class="rank">'+(live?'EXTENDED LIVE':'DELAYED WATCH')+' · '+esc(st)+'</div><div class="ticker">'+esc(t)+'</div><div class="move">'+pct(N(x.sessionChangePct))+'</div><div class="score">TAGX '+sc+'/100</div><div class="meta">'+money(N(x.last))+' · سرعة 15د '+pct(N(x.priceVelocity15mPct))+' · عمر اللقطة '+Math.round(mins(x.timestampUTC))+'د</div><div class="why">'+(live?'بيانات ممتدة حديثة':'عرض متابعة فقط — لا دخول LAB حتى تتحدث البيانات')+'</div></article>'}).join('');
   if(status){let c=status.querySelector('[data-fallback24]');if(!c){c=document.createElement('span');c.dataset.fallback24='1';status.appendChild(c)}c.className='chip '+(live?'ok':'warn');c.textContent=(live?'Live feed ':'Delayed watch ')+Math.round(age)+'د · '+rows.length+' نتائج'}
  }catch(e){console.warn('TAGX freshness fallback',e)}
 }
 window.TAGXFreshnessFallbackV24={sync};sync();setInterval(sync,30000);
})();