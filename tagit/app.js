import{enrich,marketRegime}from'./core.js';

const MARKET_FEED='../tag/data/finviz.json';
const $=s=>document.querySelector(s);
const fmt=n=>Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2});
const pct=n=>`${Number(n)>=0?'+':''}${fmt(n)}%`;
const mf=(v,s='')=>(v===null||v===undefined||!Number.isFinite(Number(v)))?'—':`${fmt(v)}${s}`;
const plain=v=>{if(v===null||v===undefined||v==='')return null;const x=parseFloat(String(v).replace(/[$,%x,]/g,''));return Number.isFinite(x)?x:null};
const millions=v=>{if(v===null||v===undefined||v==='')return null;const s=String(v).trim().toUpperCase().replace(/,/g,'');const x=parseFloat(s);if(!Number.isFinite(x))return null;if(s.endsWith('B'))return x*1000;if(s.endsWith('M'))return x;if(s.endsWith('K'))return x/1000;return x>1e5?x/1e6:x};
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const labels={ANOMALY:'Anomaly',IGNITION:'Ignition',ACCELERATION:'Acceleration',BREAKOUT:'Breakout',EXPANSION:'Expansion',EXHAUSTION:'Exhaustion',FAILED:'Failed'};
const activeSession=s=>['pre-market','regular','after-hours'].includes(String(s||'').toLowerCase());

let state={feed:{asOf:new Date().toISOString(),session:'loading',market:{},symbols:[]},items:[],filter:'ALL',selected:null,feedState:'loading',url:MARKET_FEED};

function sourceGate(payload,session,ageMin){
  const extended=['pre-market','after-hours'].includes(session);
  const integrity=String(payload.extendedHoursFieldIntegrity||'');
  if(activeSession(session)&&ageMin>20)return{status:'REJECT',reason:`بيانات المصدر متأخرة ${Math.round(ageMin)} دقيقة أثناء الجلسة`};
  if(String(payload.cadenceStatus)==='GAP_ERROR'||String(payload.bucketContinuityStatus)==='BUCKET_GAP_ERROR')return{status:'REJECT',reason:'فجوة في تسلسل snapshots؛ الإشارة غير مؤهلة'};
  if(extended&&integrity!=='CROSS_SNAPSHOT_FIELDS_MOVING')return{status:'REJECT',reason:'حقول المصدر في الجلسة الممتدة غير مؤكدة الحركة'};
  if(session==='closed')return{status:'OBSERVE',reason:'السوق مغلق؛ هذه آخر لقطة سوق وليست إشارة دخول آنية'};
  return null;
}

function normalizeFinviz(p){
  const rows=Array.isArray(p.rows)?p.rows:(Array.isArray(p.data)?p.data:[]);
  const asOf=p.updatedAt||p.snapshotTimestampUTC||new Date().toISOString();
  const ts=new Date(asOf).getTime();
  const ageMin=Number.isFinite(ts)?Math.max(0,(Date.now()-ts)/60000):9999;
  const session=String(p.session||'unknown').toLowerCase();
  const override=sourceGate(p,session,ageMin);
  const symbols=rows.slice(0,180).map(r=>{
    const ch=plain(r.Change)??0;
    const signals=Array.isArray(r._signals)?r._signals:(Array.isArray(r.signals)?r.signals:[]);
    const unusual=signals.some(x=>String(x).includes('unusualvolume'));
    const topg=signals.some(x=>String(x).includes('topgainers'));
    const most=signals.some(x=>String(x).includes('mostactive'));
    const rawRel=plain(r['Relative Volume']??r['Rel Volume']??r.RVOL);
    const volume=plain(r.Volume)??0;
    const floatM=millions(r['Float']??r['Shs Float']);
    const slope=plain(r._persistenceSlopePctPts);
    const persistence=String(r._persistenceTrend||'');
    const persistenceUsable=Boolean(p.persistenceTrainingEligible)&&Number.isFinite(slope);
    const volumeAcceleration=rawRel!==null?clamp(rawRel/1.6+(persistence==='STRENGTHENING'?.7:0),0,10):0;
    const priceAcceleration=persistenceUsable?clamp(Math.max(0,slope)/2.2,0,8):0;
    const breakoutQuality=clamp((topg?.38:0)+(unusual?.20:0)+(persistence==='STRENGTHENING'?.17:0)+Math.min(Math.max(ch,0),20)/100,0,.85);
    let quality=.60;
    if(rawRel!==null)quality+=.10;
    if(floatM!==null)quality+=.06;
    if(persistenceUsable)quality+=.08;
    if(p.independentSourceCount>1)quality+=.08;
    if(override?.status==='REJECT')quality=Math.min(quality,.54);
    const evidence=[
      `Finviz Elite • ${signals.map(x=>String(x).replace('ta_','')).join(' + ')||'market scan'}`,
      `Snapshot ${Math.round(ageMin)}m ago • ${session}`,
      rawRel!==null?`Relative Volume ${rawRel.toFixed(2)}x`:'Relative Volume غير متاح — لم يتم تقديره',
      persistenceUsable?`Persistence ${persistence} • slope ${slope>=0?'+':''}${slope} pts`:`Persistence ${persistence||'غير مؤهل'}`
    ];
    return{
      symbol:String(r.Ticker||r.Symbol||'').trim().toUpperCase(),price:plain(r.Price)??0,changePct:ch,volume,rvol:rawRel,floatM,spreadPct:null,
      volumeAcceleration,priceAcceleration,vwapPosition:0,breakoutQuality,distanceToBreakoutPct:5,
      catalystStrength:.20,catalystFreshnessMin:9999,dilutionRisk:.25,haltRisk:ch>50?.38:ch>30?.22:.08,dataQuality:clamp(quality,0,1),
      gateOverride:override,evidence,confirm:'تأكيد ببيانات سعر/حجم أحدث مع استمرار التسارع وعدم تحول الحركة إلى Extended',invalidate:'فجوة بيانات، تجمد حقول المصدر، أو فقدان تسارع الحركة'
    };
  }).filter(x=>x.symbol&&x.price>0);
  let feedState='snapshot';
  if(activeSession(session)&&!override)feedState='fresh';
  else if(activeSession(session)&&override?.status==='REJECT')feedState='blocked';
  else if(session==='closed')feedState='closed';
  return{asOf,session,source:p.source||'Finviz Elite',ageMin,feedState,integrity:{cadenceStatus:p.cadenceStatus,bucketContinuityStatus:p.bucketContinuityStatus,extendedHoursFieldIntegrity:p.extendedHoursFieldIntegrity,independentSourceCount:p.independentSourceCount,dataIntegrityState:p.dataIntegrityState},market:{spyChangePct:0,qqqChangePct:0,iwmChangePct:0,vixChangePct:0,breadthPct:50},symbols};
}

function process(feed,{feedState='fresh',url=MARKET_FEED}={}){
  state.feed=feed;state.items=enrich(feed.symbols||[],feed.market||{});state.feedState=feedState;state.url=url;state.selected=state.items[0]?.symbol||null;
  document.body.dataset.feedState=feedState;document.body.dataset.session=String(feed.session||'unknown').toLowerCase();render();
}

function render(){
  const items=state.filter==='ALL'?state.items:state.items.filter(x=>x.phase===state.filter);
  $('#rows').innerHTML=items.map(x=>`<tr data-symbol="${x.symbol}"><td><span class="ticker">${x.symbol}</span></td><td><span class="stage ${x.phase}">${labels[x.phase]}</span></td><td><span class="score">${x.score}</span></td><td><b>${x.actionability}</b></td><td><span class="gate ${x.gate.status}">${x.gate.status}</span></td><td>$${fmt(x.price)}</td><td class="${x.changePct>=0?'pos':'neg'}">${pct(x.changePct)}</td><td>${mf(x.rvol,'x')}</td><td>${mf(x.features.floatRotation,'x')}</td><td class="signal">${x.summary}</td></tr>`).join('')||'<tr><td colspan="10">لا توجد نتائج قابلة للعرض من المصدر الحالي.</td></tr>';
  $('#metricCandidates').textContent=state.items.filter(x=>x.gate.status==='WATCH').length;
  $('#metricIgnition').textContent=state.items.filter(x=>x.phase==='IGNITION').length;
  $('#metricAcceleration').textContent=state.items.filter(x=>x.phase==='ACCELERATION').length;
  $('#metricRisk').textContent=state.items.filter(x=>['EXHAUSTION','FAILED'].includes(x.phase)||x.components.risk>=60||x.gate.status==='REJECT').length;
  const r=marketRegime(state.feed.market||{});$('#regimeText').textContent='NEUTRAL';$('#regimeScore').textContent=r.score;
  $('#sessionText').textContent=(state.feed.session||'unknown').toUpperCase();$('#asOfText').textContent=state.feed.asOf?new Date(state.feed.asOf).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
  const mode={fresh:'MARKET FEED • FRESH',closed:'LAST MARKET SNAPSHOT',blocked:'SOURCE QUALITY BLOCK',snapshot:'MARKET SNAPSHOT',unavailable:'DATA UNAVAILABLE'}[state.feedState]||'MARKET SNAPSHOT';
  $('#modePill').className=`pill ${state.feedState==='fresh'?'live':'demo'}`;$('#modeText').textContent=mode;
  document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===state.filter));document.querySelectorAll('tr[data-symbol]').forEach(r=>r.onclick=()=>{state.selected=r.dataset.symbol;renderDetail()});renderDetail();
}

function renderDetail(){
  const x=state.items.find(i=>i.symbol===state.selected);if(!x){$('#detail').className='detail empty';$('#detail').textContent='لا توجد بطاقة متاحة.';return}
  const c=x.components,f=x.features,e=(x.evidence||[]).map(v=>`<div class="evidence-item">${v}</div>`).join('');
  const m=[['Acceleration',c.acceleration],['Participation',c.participation],['Structure',c.structure],['Liquidity',c.liquidity],['Data quality',c.quality],['Risk',c.risk]].map(([k,v])=>`<div><div class="meter-label"><span>${k}</span><b>${v}</b></div><div class="bar"><div class="fill" style="width:${v}%"></div></div></div>`).join('');
  $('#detail').className='detail';$('#detail').innerHTML=`<div class="decision-top"><div><h2>${x.symbol}</h2><span class="stage ${x.phase}">${labels[x.phase]}</span></div><div class="bigscore"><b>${x.actionability}</b><span>Actionability</span></div></div><div class="price-line"><span class="price">$${fmt(x.price)}</span><span class="${x.changePct>=0?'pos':'neg'}">${pct(x.changePct)}</span></div><div class="gatebox ${x.gate.status}"><b>${x.gate.status}</b><span>${x.gate.reason}</span></div><div class="mini-stats"><div><span>RVOL</span><b>${mf(x.rvol,'x')}</b></div><div><span>Float rotation</span><b>${mf(f.floatRotation,'x')}</b></div><div><span>Spread</span><b>${f.spreadKnown?mf(f.spread,'%'):'—'}</b></div><div><span>Risk</span><b>${c.risk}</b></div></div><div class="analog-head"><b>Forward probability</b><span class="source modelled">MODELLED ESTIMATE</span></div><div class="prob-grid"><div><b>${x.analogs.p5_30m}%</b><span>+5% / 30m</span></div><div><b>${x.analogs.p10_1h}%</b><span>+10% / 1h</span></div><div><b>${x.analogs.p20_day}%</b><span>+20% / day</span></div></div><div class="section-title">Why now?</div><div class="evidence">${e}</div><div class="kv"><div class="card"><b>يؤكد الفرضية</b><span>${x.confirm}</span></div><div class="card"><b>يبطل الفرضية</b><span>${x.invalidate}</span></div></div><div class="meters">${m}</div>`;
}

async function loadMarket(){
  try{const r=await fetch(`${MARKET_FEED}?t=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);const raw=await r.json(),feed=normalizeFinviz(raw);if(!feed.symbols.length)throw new Error('Empty market feed');process(feed,{feedState:feed.feedState,url:MARKET_FEED});}
  catch(e){console.error('TAGit market feed failed',e);process({asOf:new Date().toISOString(),session:'unavailable',market:{},symbols:[]},{feedState:'unavailable',url:MARKET_FEED});}
}
async function loadCustom(url){if(!url)return;try{const r=await fetch(`${url}${url.includes('?')?'&':'?'}t=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);const d=await r.json();if(!Array.isArray(d.symbols))throw new Error('Invalid TAGit feed format');process(d,{feedState:'fresh',url});localStorage.setItem('tagitFeedUrl',url);}catch(e){alert(`تعذر ربط المصدر: ${e.message}`)}}

$('#filters').onclick=e=>{const b=e.target.closest('[data-filter]');if(b){state.filter=b.dataset.filter;render()}};
$('#connectBtn').onclick=()=>loadCustom($('#feedUrl').value.trim());$('#demoBtn').textContent='مصدر السوق';$('#demoBtn').onclick=loadMarket;$('#refreshBtn').onclick=()=>state.url===MARKET_FEED?loadMarket():loadCustom(state.url);$('#feedUrl').placeholder='اختياري: TAGit-compatible JSON endpoint';
const saved=localStorage.getItem('tagitFeedUrl');if(saved){$('#feedUrl').value=saved;loadCustom(saved)}else loadMarket();setInterval(()=>{if(state.url===MARKET_FEED)loadMarket()},60000);
