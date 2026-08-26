'use strict';
(function(){
  const RELEASE='TAGX 1.5';
  const style=document.createElement('style');
  style.textContent='.session15{margin-top:8px;padding:8px 10px;border-radius:10px;font-size:12px;font-weight:800;background:#f1f5f9;color:#334155}.session15.good{background:#ecfdf5;color:#047857}.session15.warn{background:#fff7ed;color:#b45309}.session15.bad{background:#fef2f2;color:#b91c1c}';
  document.head.appendChild(style);
  function et(){const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false,weekday:'short'}).formatToParts(new Date());const g=k=>parts.find(p=>p.type===k)?.value;return{day:g('weekday'),m:(+g('hour'))*60+(+g('minute'))}}
  function session(){const z=et();if(['Sat','Sun'].includes(z.day))return'CLOSED';if(z.m>=240&&z.m<570)return'PREMARKET';if(z.m>=570&&z.m<960)return'RTH';if(z.m>=960&&z.m<1200)return'AFTER_HOURS';return'CLOSED'}
  function live(x){const e=enrichment?.rows?.[x.Ticker]||{};const p=e.price||{};const ch=N(p.changePct),last=N(p.last),base=N(x.Change),basePrice=N(x.Price);return{ch:ch!=null?ch:base,last:last!=null?last:basePrice,baseCh:base,basePrice,ts:p.timestampUTC||null,delta:ch!=null&&base!=null?ch-base:null}}
  function state(x){const s=session(),l=live(x);let penalty=0,blocked=false,why='';if(s==='PREMARKET'||s==='AFTER_HOURS'){
    if(l.delta!=null&&l.delta<=-30){penalty=70;blocked=true;why='انهيار ممتد ≥30 نقطة عن لقطة الأساس'}
    else if(l.delta!=null&&l.delta<=-20){penalty=55;blocked=true;why='تراجع ممتد ≥20 نقطة'}
    else if(l.delta!=null&&l.delta<=-12){penalty=40;blocked=true;why='تراجع ممتد ≥12 نقطة'}
    else if(l.delta!=null&&l.delta<=-7){penalty=22;why='ضعف واضح في الساعات الممتدة'}
    else if(l.delta!=null&&l.delta>=8){penalty=-6;why='استمرار إيجابي في الساعات الممتدة'}
    if(l.ch!=null&&l.ch<=-8){penalty=Math.max(penalty,45);blocked=true;why='السعر الحي سلبي بقوة في الساعات الممتدة'}
  }
  return{s,l,penalty,blocked,why};}
  const oldTrace=trace;
  trace=function(x){const t=oldTrace(x),q=state(x);let score=Math.max(0,Math.min(100,Math.round(t.score-q.penalty)));const up=[...(t.up||[])],down=[...(t.down||[])];if(q.penalty<0)up.push('Extended-hours continuation');if(q.penalty>0)down.push(q.why);if(q.blocked)down.push('Extended-Hours Gate: BLOCKED');return{...t,score,up,down,extended:q}}
  const oldStage=stage;
  stage=function(x){const q=state(x);if(q.blocked)return'EXHAUSTION';if((q.s==='PREMARKET'||q.s==='AFTER_HOURS')&&q.l.ch!=null)return oldStage({...x,Change:q.l.ch,Price:q.l.last});return oldStage(x)}
  const oldRender=render;
  render=function(){oldRender();const s=session();const st=document.querySelector('#status');if(st&&!st.querySelector('[data-session15]'))st.insertAdjacentHTML('beforeend','<span class="chip" data-session15="1">'+({PREMARKET:'قبل الافتتاح',RTH:'الجلسة النظامية',AFTER_HOURS:'بعد الإغلاق',CLOSED:'السوق مغلق'}[s])+'</span>');document.querySelectorAll('#topOpps .opp[data-ticker]').forEach(card=>{const x=rowMap.get(card.dataset.ticker);if(!x)return;const q=state(x),t=trace(x);if(q.blocked){card.remove();return}let d=card.querySelector('.session15');if(!d){d=document.createElement('div');d.className='session15';card.appendChild(d)}d.className='session15 '+(q.penalty<0?'good':q.penalty>=22?'warn':'');d.textContent=(q.s==='PREMARKET'?'قبل الافتتاح':q.s==='AFTER_HOURS'?'بعد الإغلاق':'الجلسة')+' · حي '+F(q.l.ch)+' · أثر ممتد '+(q.l.delta==null?'—':F(q.l.delta))+' · TAGX '+t.score});document.querySelectorAll('#radarRows tr[data-ticker]').forEach(tr=>{const x=rowMap.get(tr.dataset.ticker);if(!x)return;const q=state(x);if(q.blocked)tr.style.opacity='.48'})}
  window.TAGXExtendedHoursV15={release:RELEASE,session,state};
  document.title='TAGX 1.5 — Session-Aware Early Intelligence';const ey=document.querySelector('.ey');if(ey)ey.textContent='TAGX 1.5 · SESSION-AWARE EARLY INTELLIGENCE';
  try{render()}catch(e){console.error('TAGX 1.5 extended-hours layer',e)}
})();