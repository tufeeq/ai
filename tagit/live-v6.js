const LIVE_URL='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/live-quotes.json';
const VALIDATION_URL='https://raw.githubusercontent.com/tufeeq/ai/main/tag/data/tagit-v531-free-pit-training.json';
const POLL_MS=5000, FRESH_MS=4*60*1000, STALE_MS=10*60*1000, RETAIN_MS=30*60*1000, MEM='tagit_v6_memory';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const n=v=>v==null||v===''||!Number.isFinite(+v)?null:+v;
const fmt=(v,d=2)=>n(v)==null?'—':n(v).toLocaleString('en-US',{maximumFractionDigits:d});
const pct=v=>n(v)==null?'—':`${n(v)>=0?'+':''}${fmt(v)}%`;
const esc=s=>String(s??'—').replace(/[&<>\'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const age=v=>{const t=Date.parse(v||'');return Number.isFinite(t)?Date.now()-t:Infinity};
const active=s=>['pre-market','regular','after-hours'].includes(String(s||'').toLowerCase());
let app={live:null,filter:'ALL',selected:null,countdown:5,lastSnapshot:null,memory:{},lastGoodAt:0,fetchError:null};
try{app.memory=JSON.parse(localStorage.getItem(MEM)||'{}')}catch{}
function save(){try{localStorage.setItem(MEM,JSON.stringify(app.memory))}catch{}}
async function getJson(u){const r=await fetch(`${u}?t=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}
function updateMemory(live){
 const snap=live?.updatedAtUTC||live?.updatedAtET;if(!snap)return;
 const now=Date.now();
 for(const [k,v] of Object.entries(app.memory))if(now-(v.seenAt||0)>RETAIN_MS)delete app.memory[k];
 if(snap===app.lastSnapshot)return;app.lastSnapshot=snap;
 for(const x of live.emergingCandidates||[]){const k=String(x.ticker||'').toUpperCase();if(!k)continue;const m=app.memory[k]||{hits:0,prev:null,last:null,seenAt:0,row:null};m.prev=m.last;m.last={price:n(x.price),score:n(x.earlyRegimeShiftScore),v5:n(x.priceVelocity5mPct),v15:n(x.priceVelocity15mPct),snap};m.row={...x};m.hits++;m.seenAt=now;app.memory[k]=m}
 save();
}
function classify(x){
 const m=app.memory[x.ticker]||{},v5=n(x.priceVelocity5mPct),v15=n(x.priceVelocity15mPct),score=n(x.earlyRegimeShiftScore),a5=x.volumeAccelerationComparable5m===true?n(x.volumeAcceleration5m):null,turn=n(x.turnover5mPctFloat),ch=n(x.changePct),price=n(x.price);let reasons=[];
 const independent=(v15!=null&&v15>=1.2)||(a5!=null&&a5>=1.8)||(turn!=null&&turn>=1);
 const core=v5!=null&&v5>=0.8&&score!=null&&score>=65&&independent;
 const deterioration=m.prev&&m.last&&((m.prev.price&&m.last.price<m.prev.price*.97)||(m.prev.score!=null&&m.last.score!=null&&m.last.score<m.prev.score-12));
 const overheated=ch!=null&&ch>=18,micro=price!=null&&price<1;
 let state='VERIFY';if(core&&(m.hits||0)>=2&&!deterioration&&!overheated)state='CONFIRMED';if(deterioration||(v5!=null&&v5<0))state='COOLING';if(overheated)state='EXTENDED';
 let risk=0;if(micro)risk+=25;if(overheated)risk+=25;if(a5==null&&turn==null)risk+=15;if(n(x.quoteAgeMin)>2)risk+=10;if(deterioration)risk+=30;
 const persistence=Math.max(0,Math.min(100,Math.round(((m.hits||0)>=2?35:10)+(v15||0)*5+(a5?Math.min(20,a5*3):0)+(turn?Math.min(20,turn*2):0)-(deterioration?35:0))));
 const quality=Math.max(0,Math.min(100,Math.round((score||0)*.55+(n(x.ignitionScore)||0)*.2+persistence*.25-risk*.35)));
 if(v5!=null)reasons.push(`5m ${pct(v5)}`);if(v15!=null)reasons.push(`15m ${pct(v15)}`);if(a5!=null)reasons.push(`Vol ${fmt(a5,1)}x`);if(turn!=null)reasons.push(`Turn ${fmt(turn,1)}%`);
 return{state,risk,persistence,quality,hits:m.hits||0,reasons:reasons.join(' · ')};
}
function freshness(live){const a=age(live?.updatedAtUTC||live?.updatedAtET);if(!live||!active(live.marketClockSession))return{state:'OFFLINE',ok:false,display:false,age:a};if(a<=FRESH_MS)return{state:'LIVE',ok:true,display:true,age:a};if(a<=STALE_MS)return{state:'DELAYED',ok:false,display:true,age:a};return{state:'STALE',ok:false,display:true,age:a}}
function currentRows(){
 const now=Date.now(),map=new Map();
 for(const x of app.live?.emergingCandidates||[]){if(x?.ticker)map.set(String(x.ticker).toUpperCase(),{...x,retained:false})}
 for(const [ticker,m] of Object.entries(app.memory)){if(!m?.row||now-(m.seenAt||0)>RETAIN_MS||map.has(ticker))continue;map.set(ticker,{...m.row,ticker,retained:true,retainedAgeMs:now-(m.seenAt||0)})}
 return [...map.values()];
}
function enriched(){return currentRows().map(x=>({...x,...classify(x)})).sort((a,b)=>{const sw=s=>s==='CONFIRMED'?3:s==='VERIFY'?2:s==='COOLING'?1:0;return sw(b.state)-sw(a.state)||b.quality-a.quality})}
function visible(){let xs=enriched();if(app.filter!=='ALL')xs=xs.filter(x=>x.state===app.filter);return xs}
function statusText(f){if(f.state==='LIVE')return'LIVE · AUTO REFRESH 5s';if(f.state==='DELAYED')return'DELAYED · BACKEND REFRESHING';if(f.state==='STALE')return'DATA STALE · LAST VALID OPPORTUNITIES';return'MARKET CLOSED / OFFLINE'}
function render(){
 const live=app.live,f=freshness(live),all=enriched(),confirmed=all.filter(x=>x.state==='CONFIRMED'),verify=all.filter(x=>x.state==='VERIFY'),cool=all.filter(x=>x.state==='COOLING'||x.state==='EXTENDED');
 $('#status').textContent=statusText(f);$('#status').dataset.state=f.state;$('#session').textContent=String(live?.marketClockSession||'unknown').toUpperCase();$('#asof').textContent=live?.updatedAtET?new Date(live.updatedAtET).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',second:'2-digit'})+' ET':'—';$('#age').textContent=Number.isFinite(f.age)?`${(f.age/60000).toFixed(1)}m`:'—';$('#coverage').textContent=`${live?.freshCount||0}/${live?.requested||0}`;$('#confidence').textContent=live?.dataConfidence||'—';$('#confirmedCount').textContent=confirmed.length;$('#verifyCount').textContent=verify.length;$('#coolCount').textContent=cool.length;$('#next').textContent=`${app.countdown}s`;
 const list=$('#opportunities'),xs=visible();
 if(!xs.length){list.innerHTML=`<div class="empty"><b>لا توجد فرص نشطة الآن</b><span>${app.fetchError?'تعذر جلب آخر snapshot، وسيعاد المحاولة كل 5 ثوانٍ.':'الرادار يعمل ولم تظهر فرصة مجتازة حتى الآن.'}</span></div>`}
 else{let rank=0;list.innerHTML=xs.map(x=>{const ranked=x.state==='CONFIRMED'&&f.ok&&!x.retained;if(ranked)rank++;const cls=x.state.toLowerCase(),held=x.retained?`<span class="state verify">LAST VALID</span>`:'';return `<button class="opp ${cls}" data-symbol="${esc(x.ticker)}"><div class="opp-top"><div><span class="ticker">${esc(x.ticker)}</span><span class="state ${cls}">${x.state}</span>${held}</div><span class="rank">${ranked?'#'+rank:'—'}</span></div><div class="price-row"><b>$${fmt(x.price,4)}</b><span class="${n(x.changePct)>=0?'pos':'neg'}">${pct(x.changePct)}</span></div><div class="bars"><label>Quality <i>${x.quality}</i><span><em style="width:${x.quality}%"></em></span></label><label>Persistence <i>${x.persistence}</i><span><em style="width:${x.persistence}%"></em></span></label></div><div class="chips"><span>5m ${pct(x.priceVelocity5mPct)}</span><span>15m ${pct(x.priceVelocity15mPct)}</span><span>Risk ${x.risk}</span><span>${x.hits} snapshots</span></div><small>${esc(x.reasons)}${x.retained?' · محفوظ من آخر لقطة صالحة':''}</small></button>`}).join('')}
 $$('.opp').forEach(el=>el.onclick=()=>{app.selected=el.dataset.symbol;renderDetail()});renderDetail();$$('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===app.filter));
}
function renderDetail(){const host=$('#detail'),x=enriched().find(z=>z.ticker===app.selected)||enriched()[0];if(!x){host.innerHTML='<div class="empty"><b>لا توجد فرصة محددة</b><span>اختر فرصة من الرادار عند ظهورها.</span></div>';return}app.selected=x.ticker;host.innerHTML=`<div class="detail-head"><div><span class="ticker big">${esc(x.ticker)}</span><span class="state ${x.state.toLowerCase()}">${x.state}</span>${x.retained?'<span class="state verify">LAST VALID</span>':''}</div><b>${x.state==='CONFIRMED'?x.quality:'—'}</b></div><div class="detail-price">$${fmt(x.price,4)} <span class="${n(x.changePct)>=0?'pos':'neg'}">${pct(x.changePct)}</span></div><div class="detail-grid"><div><span>Quality</span><b>${x.quality}</b></div><div><span>Persistence</span><b>${x.persistence}</b></div><div><span>Risk</span><b>${x.risk}</b></div><div><span>Snapshots</span><b>${x.hits}</b></div><div><span>5m</span><b>${pct(x.priceVelocity5mPct)}</b></div><div><span>15m</span><b>${pct(x.priceVelocity15mPct)}</b></div></div><p>${esc(x.reasons)}</p><div class="notice">${x.retained?'هذه فرصة محفوظة من آخر لقطة صالحة لضمان استمرارية العرض، ولا يعاد ترتيبها حتى تصل لقطة حديثة.':x.state==='CONFIRMED'?'اجتاز التأكيد متعدد اللقطات، لكنه يظل مرشحًا بحثيًا وليس ضمانًا للربح.':'لا يوجد ترتيب تنفيذي قبل اكتمال التأكيد والاستمرارية.'}</div>`}
async function refresh(){app.countdown=5;try{const base=await getJson(LIVE_URL);app.live=base;app.fetchError=null;app.lastGoodAt=Date.now();updateMemory(base);render()}catch(e){app.fetchError=String(e);console.warn('TAGit feed refresh',e);render()}}
async function validation(){try{const r=await getJson(VALIDATION_URL),h=r.researchHoldout||{};$('#research').innerHTML=`<span>v5.31 research</span><b>${fmt(h.precision20Pct)}%</b><small>${h.tp20||0}/${h.count||0} · Wilson90 ${fmt(h.wilsonLower90Pct)}% · Top3 ${fmt(h.top3DailyPrecisionPct)}%</small>`}catch{}}
$$('[data-filter]').forEach(b=>b.onclick=()=>{app.filter=b.dataset.filter;render()});$('#refresh').onclick=refresh;
setInterval(()=>{app.countdown=Math.max(0,app.countdown-1);$('#next').textContent=`${app.countdown}s`;if(app.countdown===0)refresh()},1000);
setInterval(()=>{if(app.live)render()},5000);
refresh();validation();