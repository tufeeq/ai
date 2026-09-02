import {enrich} from './core.js';

const MARKET_FEED='../tag/data/finviz.json';
const $=s=>document.querySelector(s);
const fmt=n=>Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2});
const pct=n=>`${Number(n)>=0?'+':''}${fmt(n)}%`;
const num=v=>{const x=parseFloat(String(v??'').replace(/[$,%x,]/g,''));return Number.isFinite(x)?x:0};
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));

const demo={asOf:new Date().toISOString(),session:'demo',symbols:[
  {symbol:'DEMO',price:1.25,changePct:7.4,rvol:3.4,floatM:8,spreadPct:2,volumeAcceleration:3.2,priceAcceleration:2.4,vwapPosition:.5,breakoutQuality:.5,catalystStrength:.35,catalystFreshnessMin:10,dilutionRisk:.25,haltRisk:.08,dataQuality:.55,evidence:['بيانات عرض فقط','يتم استخدامها فقط عند تعذر مصدر السوق'],confirm:'عودة مصدر السوق',invalidate:'لا تستخدم هذه البيانات لاتخاذ قرار'}
]};

let state={feed:demo,items:[],filter:'ALL',selected:null,market:false,stale:true,url:MARKET_FEED};

function normalizeFinviz(payload){
  const rows=Array.isArray(payload.rows)?payload.rows:(Array.isArray(payload.data)?payload.data:[]);
  const asOf=payload.updatedAt||payload.snapshotTimestampUTC||new Date().toISOString();
  const ageMin=Math.max(0,(Date.now()-new Date(asOf).getTime())/60000);
  const session=payload.session||'unknown';
  const symbols=rows.slice(0,120).map((r,idx)=>{
    const change=num(r.Change);
    const signals=Array.isArray(r._signals)?r._signals:(Array.isArray(r.signals)?r.signals:[]);
    const relRaw=r['Relative Volume']??r['Rel Volume']??r['Rel Volume?']??r.RVOL;
    const rel=num(relRaw);
    const unusual=signals.some(s=>String(s).includes('unusualvolume'));
    const topg=signals.some(s=>String(s).includes('topgainers'));
    const most=signals.some(s=>String(s).includes('mostactive'));
    const inferredRvol=rel>0?rel:(unusual?3.5:signals.length>=2?2.5:most?1.8:1.2);
    const volume=num(r.Volume);
    const freshness=Math.round(ageMin);
    const rankBoost=clamp((120-idx)/120);
    return {
      symbol:String(r.Ticker||r.Symbol||'').trim().toUpperCase(),
      price:num(r.Price),
      changePct:change,
      volume,
      rvol:inferredRvol,
      floatM:num(r['Float'])||num(r['Shs Float'])||30,
      spreadPct:2.2,
      volumeAcceleration:clamp((inferredRvol-1)*1.7+signals.length+rankBoost*1.5,0,12),
      priceAcceleration:clamp(Math.max(0,change)/6,0,10),
      vwapPosition:change>2?.7:change>0?.25:change<0?-.6:0,
      breakoutQuality:clamp((Math.max(0,change)/35)+(topg?.25:0)+(unusual?.12:0),0,1),
      catalystStrength:clamp(.20+signals.length*.08,0,.48),
      catalystFreshnessMin:freshness,
      dilutionRisk:.22,
      haltRisk:change>80?.55:change>45?.30:.10,
      dataQuality:rel>0?.78:.68,
      evidence:[
        `Finviz Elite • تحديث قبل ${Math.round(ageMin)} دقيقة`,
        topg?'ضمن Top Gainers':unusual?'ضمن Unusual Volume':most?'ضمن Most Active':'ضمن رادار السوق',
        `الحركة ${change>=0?'+':''}${fmt(change)}% • الحجم ${fmt(volume)}`
      ],
      confirm:'استمرار تسارع الحجم مع ثبات السعر وعدم تحوّل الإشارة إلى Extended',
      invalidate:'توقف تسارع الحجم أو انعكاس الحركة مع بيانات أحدث'
    };
  }).filter(x=>x.symbol&&x.price>0);
  return {asOf,session,source:payload.source||'Finviz Elite',ageMin,symbols};
}

function process(feed,{market=false,stale=true,url=MARKET_FEED}={}){
  state.feed=feed; state.items=enrich(feed.symbols||[]); state.market=market; state.stale=stale; state.url=url;
  state.selected=state.items[0]?.symbol||null; render();
}

function render(){
  const items=state.filter==='ALL'?state.items:state.items.filter(x=>x.stage===state.filter);
  $('#rows').innerHTML=items.map(x=>`<tr data-symbol="${x.symbol}"><td><span class="ticker">${x.symbol}</span></td><td><span class="stage ${x.stage}">${x.stage}</span></td><td><span class="score">${x.score}</span></td><td><b>${x.actionability}</b></td><td>$${fmt(x.price)}</td><td class="${x.changePct>=0?'pos':'neg'}">${pct(x.changePct)}</td><td>${fmt(x.rvol)}x</td><td class="signal">${x.summary}</td></tr>`).join('')||'<tr><td colspan="8">لا توجد نتائج ضمن هذا الفلتر.</td></tr>';
  $('#metricCandidates').textContent=state.items.filter(x=>['EMERGING','CONFIRMED','RADAR'].includes(x.stage)).length;
  $('#metricConfirmed').textContent=state.items.filter(x=>x.stage==='CONFIRMED').length;
  $('#metricEarly').textContent=state.items.filter(x=>x.stage==='EMERGING').length;
  $('#metricRisk').textContent=state.items.filter(x=>x.stage==='EXTENDED'||x.components.risk>=55).length;
  $('#sessionText').textContent=(state.feed.session||'unknown').toUpperCase();
  $('#asOfText').textContent=state.feed.asOf?new Date(state.feed.asOf).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}):'—';
  const fresh=state.market&&!state.stale;
  $('#modePill').className=`pill ${fresh?'live':'demo'}`;
  $('#modeText').textContent=fresh?'MARKET FEED • 5m':state.market?'STALE MARKET FEED':'DEMO FALLBACK';
  [...document.querySelectorAll('[data-filter]')].forEach(b=>b.classList.toggle('active',b.dataset.filter===state.filter));
  [...document.querySelectorAll('tr[data-symbol]')].forEach(r=>r.onclick=()=>{state.selected=r.dataset.symbol;renderDetail()});
  renderDetail();
}

function renderDetail(){
  const x=state.items.find(i=>i.symbol===state.selected);
  if(!x){$('#detail').className='detail empty';$('#detail').textContent='اختر سهمًا من الرادار.';return}
  const c=x.components;
  const evidence=(x.evidence||[]).map(e=>`<div class="evidence-item">${e}</div>`).join('');
  const meters=[['Catalyst',c.catalyst],['Liquidity',c.liquidity],['Momentum',c.momentum],['Structure',c.structure],['Freshness',c.freshness],['Data quality',c.quality],['Risk',c.risk]].map(([k,v])=>`<div><div class="meter-label"><span>${k}</span><b>${v}</b></div><div class="bar"><div class="fill" style="width:${v}%"></div></div></div>`).join('');
  $('#detail').className='detail';
  $('#detail').innerHTML=`<h2>${x.symbol} <span class="stage ${x.stage}">${x.stage}</span></h2><div class="price-line"><span class="price">$${fmt(x.price)}</span><span class="${x.changePct>=0?'pos':'neg'}">${pct(x.changePct)}</span></div><div><b>Why now?</b></div><div class="evidence">${evidence}</div><div class="kv"><div class="card"><b>يؤكد الفرضية</b><span>${x.confirm}</span></div><div class="card"><b>يبطل الفرضية</b><span>${x.invalidate}</span></div></div><div class="meters">${meters}</div>`;
}

async function loadMarketFeed(){
  try{
    const res=await fetch(`${MARKET_FEED}?t=${Date.now()}`,{cache:'no-store'});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw=await res.json();
    const feed=normalizeFinviz(raw);
    if(!feed.symbols.length) throw new Error('Empty market feed');
    const stale=feed.ageMin>15;
    process(feed,{market:true,stale,url:MARKET_FEED});
  }catch(e){
    console.error('TAGit market feed failed',e);
    process({...demo,asOf:new Date().toISOString()},{market:false,stale:true,url:MARKET_FEED});
  }
}

async function loadCustomFeed(url){
  if(!url)return;
  try{
    const res=await fetch(`${url}${url.includes('?')?'&':'?'}t=${Date.now()}`,{cache:'no-store'});
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    const data=await res.json();
    if(!Array.isArray(data.symbols))throw new Error('Invalid TAGit feed format');
    const age=(Date.now()-new Date(data.asOf||Date.now()).getTime())/60000;
    process({...data,asOf:data.asOf||new Date().toISOString()},{market:true,stale:age>15,url});
  }catch(e){alert(`تعذر ربط المصدر: ${e.message}`)}
}

$('#filters').onclick=e=>{const f=e.target.closest('[data-filter]');if(!f)return;state.filter=f.dataset.filter;render()};
$('#connectBtn').onclick=()=>loadCustomFeed($('#feedUrl').value.trim());
$('#demoBtn').textContent='مصدر السوق';
$('#demoBtn').onclick=loadMarketFeed;
$('#refreshBtn').onclick=()=>state.url===MARKET_FEED?loadMarketFeed():loadCustomFeed(state.url);
$('#feedUrl').placeholder='اختياري: TAGit-compatible JSON endpoint';

loadMarketFeed();
setInterval(loadMarketFeed,60000);
