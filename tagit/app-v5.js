import{marketRegime}from'./core.js';

const SIGNAL_FEED='../tag/data/tagit-signal-feed.json';
const RESEARCH_REPORTS=[
  ['v5.31','../tag/data/tagit-v531-free-pit-training.json'],
  ['v5.30','../tag/data/tagit-v530-free-pit-training.json'],
  ['v5.29','../tag/data/tagit-v529-free-pit-training.json'],
  ['v5.28','../tag/data/tagit-v528-free-pit-training.json'],
  ['v5.23','../tag/data/tagit-v523-free-pit-training.json']
];
const FREEZE_REPORT='../tag/data/tagit-v514-freeze-report.json';
const FORWARD_LEDGER='../tag/data/forward/ledger.json';
const LEGACY_FORWARD_LEDGER='../tag/data/tagit-forward-universe-ledger.json';

const $=s=>document.querySelector(s);
const fmt=(n,d=2)=>Number(n||0).toLocaleString('en-US',{maximumFractionDigits:d});
const pct=n=>n===null||n===undefined||!Number.isFinite(+n)?'—':`${+n>=0?'+':''}${fmt(+n)}%`;
const val=(v,suffix='')=>v===null||v===undefined||v===''||!Number.isFinite(+v)?'—':`${fmt(+v)}${suffix}`;
const active=s=>['pre-market','regular','after-hours'].includes(String(s||'').toLowerCase());
const esc=s=>String(s??'—').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const cacheBust=u=>`${u}${u.includes('?')?'&':'?'}t=${Date.now()}`;

async function json(url){const r=await fetch(cacheBust(url),{cache:'no-store'});if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);return r.json()}
async function maybe(url){try{return await json(url)}catch{return null}}
async function latestResearch(){for(const [version,url] of RESEARCH_REPORTS){const report=await maybe(url);if(report?.status==='COMPLETE')return{version,report}}return{version:'—',report:null}}

let state={items:[],session:'loading',asOf:null,sourceHealthy:false,source:'TAGit',market:{},filter:'ALL',selected:null,researchVersion:'—',research:null,freeze:null,forward:null,forwardKind:'none'};

function normalizeFeed(sig){return{
  items:Array.isArray(sig?.items)?sig.items:[],session:String(sig?.session||'unknown').toLowerCase(),asOf:sig?.updatedAt||null,
  sourceHealthy:Boolean(sig?.sourceHealthy),source:sig?.source||'TAGit derived signals',market:{spyChangePct:sig?.market?.spy?.changePct??null,qqqChangePct:sig?.market?.qqq?.changePct??null,iwmChangePct:sig?.market?.iwm?.changePct??null,vixChangePct:null,breadthPct:null}
}}
function latestForwardSession(x){
  if(!x)return null;
  if(Array.isArray(x.sessions)&&x.sessions.length)return [...x.sessions].sort((a,b)=>String(a.sessionDateET||a.date||'').localeCompare(String(b.sessionDateET||b.date||''))).at(-1);
  if(Array.isArray(x.entries)&&x.entries.length)return [...x.entries].sort((a,b)=>String(a.sessionDateET||a.date||'').localeCompare(String(b.sessionDateET||b.date||''))).at(-1);
  return x.latest||null;
}
async function load(){
  const [feed,research,freeze,newForward,legacyForward]=await Promise.all([maybe(SIGNAL_FEED),latestResearch(),maybe(FREEZE_REPORT),maybe(FORWARD_LEDGER),maybe(LEGACY_FORWARD_LEDGER)]);
  const f=normalizeFeed(feed||{});Object.assign(state,f,{researchVersion:research.version,research:research.report,freeze});
  state.forward=newForward||legacyForward||null;state.forwardKind=newForward?'immutable-v1':legacyForward?'legacy-pit-ledger':'none';
  state.items=state.items.slice().sort((a,b)=>(+b.actionability||0)-(+a.actionability||0)||(+b.score||0)-(+a.score||0)||String(a.symbol).localeCompare(String(b.symbol)));
  state.selected=state.items.some(i=>i.symbol===state.selected)?state.selected:(state.items[0]?.symbol||null);
  document.body.dataset.session=state.session;document.body.dataset.feedState=state.sourceHealthy&&active(state.session)?'fresh':'stale';
  render();renderValidation();
}

function statusClass(s){const z=String(s||'OBSERVE').toUpperCase();return['WATCH','DISCOVER','OBSERVE','CAUTION','REJECT','BLOCKED','CLOSED'].includes(z)?z:'OBSERVE'}
function catalystLabel(x){const t=x?.catalystShadow?.type;return t&&t!=='NONE'?t:'—'}
function reason(x){return x?.modelEvidence||x?.executionNote||'—'}
function persistence(x){return x?.persistenceScore??x?.persistence?.score??null}
function riskFlag(x){const d=String(x?.featureFlags?.dilution||'').toUpperCase();return (+x?.riskScore||0)>=40||(d&&d!=='NO_RECENT_FLAG'&&d!=='UNKNOWN')}
function displayMode(){if(!state.sourceHealthy)return'DATA DEGRADED';if(state.session==='closed')return'MARKET CLOSED · DATA HEALTHY';if(active(state.session))return'LIVE · DATA HEALTHY';return'DATA HEALTHY'}

function render(){
  const visible=(state.filter==='ALL'?state.items:state.items.filter(x=>String(x.phase||'').toUpperCase()===state.filter));
  const rankMap=new Map(state.items.map((x,i)=>[x.symbol,i+1]));
  $('#rows').innerHTML=visible.map(x=>{
    const gate=String(x.state||'OBSERVE').toUpperCase(),score=x.score,action=x.actionability,price=x.price??null,change=x.changePct??null;
    return `<tr data-symbol="${esc(x.symbol)}" data-phase="${esc(x.phase||'—')}" data-score="${Number(score)||0}" data-actionability="${Number(action)||0}" data-gate="${esc(gate)}" data-price="${price==null?'':Number(price)}"><td><span class="ticker">${esc(x.symbol)}</span></td><td><span class="gate ${statusClass(gate)}">${esc(gate)}</span></td><td><b>#${rankMap.get(x.symbol)??'—'}</b></td><td><span class="score">${val(score)}</span></td><td><b>${val(action)}</b></td><td>${val(persistence(x))}</td><td>${val(x.continuationScore)}</td><td>${esc(catalystLabel(x))}</td><td>${price==null?'—':'$'+fmt(price)}</td><td class="${(change??0)>=0?'pos':'neg'}">${pct(change)}</td><td class="signal">${esc(reason(x))}</td></tr>`
  }).join('')||'<tr><td colspan="11">لا توجد إشارات متاحة في هذه الحالة.</td></tr>';

  $('#metricCandidates').textContent=state.items.filter(x=>String(x.state).toUpperCase()==='WATCH').length;
  $('#metricDiscover').textContent=state.items.filter(x=>String(x.state).toUpperCase()==='DISCOVER').length;
  $('#metricAcceleration').textContent=state.items.filter(x=>['ACCELERATION','BREAKOUT','EXPANSION'].includes(String(x.phase||'').toUpperCase())).length;
  $('#metricRisk').textContent=state.items.filter(riskFlag).length;
  const reg=marketRegime(state.market||{});$('#regimeText').textContent=reg.label;$('#regimeScore').textContent=reg.score;
  $('#sessionText').textContent=String(state.session||'unknown').toUpperCase();
  $('#asOfText').textContent=state.asOf?new Date(state.asOf).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
  $('#researchText').textContent=state.research?`${state.researchVersion} · COMPLETE`:'NO VALID REPORT';
  $('#championText').textContent=state.freeze?'v5.14 · FROZEN':'PENDING';
  $('#modePill').className=`pill ${state.sourceHealthy&&active(state.session)?'live':'demo'}`;$('#modeText').textContent=displayMode();
  document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===state.filter));
  document.querySelectorAll('tr[data-symbol]').forEach(r=>r.onclick=()=>{state.selected=r.dataset.symbol;renderDetail()});renderDetail();
}

function renderDetail(){
  const x=state.items.find(i=>i.symbol===state.selected);if(!x){$('#detail').className='detail empty';$('#detail').textContent='لا توجد بطاقة متاحة.';return}
  const c=x.catalystShadow||{},ff=x.featureFlags||{},source=x.sourceEvidence||{};const execution=x.executionVerified?'EXECUTION VERIFIED':'EXECUTION UNVERIFIED';
  $('#detail').className='detail';$('#detail').innerHTML=`<div class="decision-top"><div><h2>${esc(x.symbol)}</h2><span class="gate ${statusClass(x.state)}">${esc(x.state||'—')}</span></div><div class="bigscore"><b>${val(x.actionability)}</b><span>Actionability</span></div></div><div class="price-line"><span class="price">${x.price==null?'—':'$'+fmt(x.price)}</span><span class="${(x.changePct??0)>=0?'pos':'neg'}">${pct(x.changePct)}</span></div><div class="gatebox ${statusClass(x.state)}"><b>${esc(x.phase||'—')}</b><span>${esc(reason(x))}</span></div><div class="mini-stats"><div><span>Discovery score</span><b>${val(x.score)}</b></div><div><span>Precursor</span><b>${val(x.precursorScore)}</b></div><div><span>Continuation</span><b>${val(x.continuationScore)}</b></div><div><span>Data quality</span><b>${val(x.dataQualityScore)}</b></div></div><div class="section-title">Catalyst context</div><div class="evidence"><div class="evidence-item">${esc(c.type||'NONE')} · materiality ${val(c.materiality)} · confidence ${val(c.confidence)}</div></div><div class="section-title">Feature context</div><div class="evidence"><div class="evidence-item">RVOL ${esc(ff.rvol||'UNKNOWN')} · Momentum ${esc(ff.microMomentum||'UNKNOWN')} · Float ${esc(ff.float||'UNKNOWN')} · Dilution ${esc(ff.dilution||'UNKNOWN')}</div></div><div class="section-title">Execution & source</div><div class="evidence"><div class="evidence-item">${esc(execution)} · ${esc(x.executionNote||'No execution note')} · ${esc(source.provider||state.source)}</div></div><div class="kv"><div class="card"><b>Model governance</b><span>Research ${esc(state.researchVersion)} is comparison-only. Frozen forward artifact: ${state.freeze?'v5.14':'pending'}.</span></div><div class="card"><b>Score meaning</b><span>Relative discovery/actionability scores — not calibrated success probabilities.</span></div></div>`;
}

function metricCard(label,value,sub=''){return `<div class="validation-metric"><span>${esc(label)}</span><b>${esc(value)}</b>${sub?`<small>${esc(sub)}</small>`:''}</div>`}
function badge(label,ok,neutral=false){return `<span class="integrity-badge ${neutral?'neutral':ok?'ok':'warn'}">${esc(label)}</span>`}
function renderValidation(){
  const host=$('#researchValidation');if(!host)return;const r=state.research,h=r?.researchHoldout||{},pi=r?.providerIntegrity||{};
  const fs=latestForwardSession(state.forward);const fdate=fs?.sessionDateET||fs?.date||'—';const fcount=fs?.symbols?Object.keys(fs.symbols).length:(fs?.symbolCount??fs?.count??null);
  const real=r?.realDiscoveryPrecisionPct;
  const latestAttempt=state.researchVersion==='v5.30'?'v5.31: no valid completed report':'Latest completed report loaded';
  const metrics=r?[
    metricCard('Research precision',val(h.precision20Pct,'%'),`${h.tp20??0}/${h.count??0} independent selections`),
    metricCard('Wilson lower 90%',val(h.wilsonLower90Pct,'%')),
    metricCard('Day-block lower 90%',val(h.dayBlockLower90Pct,'%')),
    metricCard('Active days',val(h.activeDays)),
    metricCard('Median lead',h.medianLeadMin==null?'—':`${fmt(h.medianLeadMin)} min`),
    metricCard('Top-3 daily',val(h.top3DailyPrecisionPct,'%')),
    metricCard('Remaining upside',val(h.medianRemainingUpsidePct,'%')),
    metricCard('Winner-day recall',val(h.winnerDayRecallPct,'%'))
  ].join(''):metricCard('Research validation','No report');
  const changes=(r?.change||[]).slice(0,5).map(x=>`<li>${esc(x)}</li>`).join('');
  host.innerHTML=`<div class="panel-head validation-head"><div><div class="panel-kicker">MODEL & EVIDENCE GOVERNANCE</div><div class="panel-title">TAGit v5 Validation State</div><div class="panel-sub">آخر نتيجة مكتملة فقط؛ لا يتم تحويل Research precision إلى Real precision قبل تحقق forward مستقل.</div></div><div class="validation-version"><b>${esc(state.researchVersion)}</b><span>${esc(r?.status||'NO REPORT')}</span></div></div><div class="validation-grid">${metrics}</div><div class="integrity-row">${badge(`Research tail: ${r?.holdoutStatus||'UNKNOWN'}`,false)}${badge(`Historical PIT universe: ${pi.historicalPointInTimeUniverse?'YES':'NO'}`,Boolean(pi.historicalPointInTimeUniverse))}${badge(`Survivorship-safe: ${pi.survivorshipSafe?'YES':'NO'}`,Boolean(pi.survivorshipSafe))}${badge(`Real discovery precision: ${real==null?'PENDING':val(real,'%')}`,real!=null,real==null)}${badge(`Frozen model: ${state.freeze?'v5.14 READY':'PENDING'}`,Boolean(state.freeze),!state.freeze)}${badge(`Forward PIT: ${state.forwardKind==='immutable-v1'?'IMMUTABLE':'ACCUMULATING'}`,state.forwardKind==='immutable-v1',state.forwardKind!=='immutable-v1')}</div><div class="validation-lower"><div><b>Forward evidence</b><span>Latest frozen day: ${esc(fdate)}${fcount==null?'':` · ${esc(fcount)} symbols`} · model training cutoff ${esc(state.freeze?.trainingCutoffDate||'—')}.</span></div><div><b>Latest attempt</b><span>${esc(latestAttempt)}. لا توجد مطالبة 90% أو market-wide precision بدون holdout مستقل + PIT universe + forward confirmation.</span></div>${changes?`<div class="validation-changes"><b>Latest substantive model changes</b><ul>${changes}</ul></div>`:''}</div>`;
}

$('#filters').onclick=e=>{const b=e.target.closest('[data-filter]');if(b){state.filter=b.dataset.filter;render()}};
$('#refreshBtn').onclick=load;$('#demoBtn').textContent='تحديث السوق';$('#demoBtn').onclick=load;$('#connectBtn').onclick=()=>{};$('#feedUrl').placeholder='TAGit signal feed is managed automatically';$('#feedUrl').disabled=true;$('#connectBtn').disabled=true;
load();setInterval(load,60000);
