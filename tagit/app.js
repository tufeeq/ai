import {enrich} from './core.js';

const demo={asOf:new Date().toISOString(),session:'demo',symbols:[
{symbol:'AXGN',price:1.28,changePct:8.2,volume:1620000,rvol:5.8,floatM:5.1,spreadPct:1.2,volumeAcceleration:7.9,priceAcceleration:3.8,vwapPosition:1,breakoutQuality:.72,catalystStrength:.86,catalystFreshnessMin:24,dilutionRisk:.18,haltRisk:.12,dataQuality:.96,evidence:['محفز حديث وعالي الصلة','تسارع الحجم قبل اكتمال الحركة','السعر فوق VWAP مع اختراق منظم'],confirm:'الثبات فوق قمة النطاق مع استمرار RVOL > 4x',invalidate:'فقدان VWAP مع تباطؤ الحجم'},
{symbol:'QNRX',price:3.44,changePct:23.4,volume:4820000,rvol:9.1,floatM:3.7,spreadPct:1.7,volumeAcceleration:9.4,priceAcceleration:6.2,vwapPosition:1,breakoutQuality:.83,catalystStrength:.78,catalystFreshnessMin:47,dilutionRisk:.24,haltRisk:.22,dataQuality:.92,evidence:['اختراق مؤكد بحجم متزايد','Float منخفض نسبيًا','الحركة ما زالت دون مستوى التمدد'],confirm:'استمرار higher lows فوق VWAP',invalidate:'كسر VWAP بحجم بيع متزايد'},
{symbol:'LTRY',price:.82,changePct:4.1,volume:610000,rvol:3.2,floatM:8.5,spreadPct:2.3,volumeAcceleration:3.8,priceAcceleration:1.9,vwapPosition:.3,breakoutQuality:.38,catalystStrength:.62,catalystFreshnessMin:31,dilutionRisk:.31,haltRisk:.08,dataQuality:.88,evidence:['نشاط مبكر غير اعتيادي','محفز متوسط القوة','لم يحدث تأكيد سعري كامل بعد'],confirm:'اختراق قمة ما قبل السوق بحجم 2x إضافي',invalidate:'عودة الحجم إلى خط الأساس'},
{symbol:'VSTM',price:5.72,changePct:71.3,volume:15800000,rvol:22.7,floatM:11.2,spreadPct:2.9,volumeAcceleration:16.2,priceAcceleration:9.1,vwapPosition:1,breakoutQuality:.92,catalystStrength:.91,catalystFreshnessMin:80,dilutionRisk:.22,haltRisk:.48,dataQuality:.95,evidence:['زخم قوي لكن الحركة أصبحت متقدمة','RVOL شديد الارتفاع','مخاطر مطاردة السعر مرتفعة'],confirm:'لا يُعامل كإشارة دخول مبكر',invalidate:'هبوط دون VWAP أو halt/downside unwind'},
{symbol:'PRFX',price:2.08,changePct:-2.7,volume:210000,rvol:.9,floatM:14.5,spreadPct:3.7,volumeAcceleration:.7,priceAcceleration:-1.2,vwapPosition:-1,breakoutQuality:.1,catalystStrength:.35,catalystFreshnessMin:420,dilutionRisk:.42,haltRisk:.05,dataQuality:.82,evidence:['الإشارة فقدت الزخم','الحجم دون خط الأساس','المحفز لم يعد حديثًا'],confirm:'يحتاج إعادة تسارع كاملة',invalidate:'استمرار التداول دون VWAP'}
]};

let state={feed:demo,items:[],filter:'ALL',selected:null,live:false,url:''};
const $=s=>document.querySelector(s);
const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
const pct=n=>`${Number(n)>=0?'+':''}${fmt(n)}%`;

function process(feed,live=false,url=''){
 state.feed=feed; state.items=enrich(feed.symbols||[]); state.live=live; state.url=url; state.selected=state.items[0]?.symbol||null; render();
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
 $('#modePill').className=`pill ${state.live?'live':'demo'}`; $('#modeText').textContent=state.live?'LIVE FEED':'DEMO DATA';
 [...document.querySelectorAll('[data-filter]')].forEach(b=>b.classList.toggle('active',b.dataset.filter===state.filter));
 [...document.querySelectorAll('tr[data-symbol]')].forEach(r=>r.onclick=()=>{state.selected=r.dataset.symbol;renderDetail();});
 renderDetail();
}

function renderDetail(){
 const x=state.items.find(i=>i.symbol===state.selected);
 if(!x){$('#detail').className='detail empty';$('#detail').textContent='اختر سهمًا من الرادار.';return;}
 const c=x.components;
 const evidence=(x.evidence||[]).map(e=>`<div class="evidence-item">${e}</div>`).join('');
 const meters=[['Catalyst',c.catalyst],['Liquidity',c.liquidity],['Momentum',c.momentum],['Structure',c.structure],['Freshness',c.freshness],['Data quality',c.quality],['Risk',c.risk]].map(([k,v])=>`<div><div class="meter-label"><span>${k}</span><b>${v}</b></div><div class="bar"><div class="fill" style="width:${v}%"></div></div></div>`).join('');
 $('#detail').className='detail';
 $('#detail').innerHTML=`<h2>${x.symbol} <span class="stage ${x.stage}">${x.stage}</span></h2><div class="price-line"><span class="price">$${fmt(x.price)}</span><span class="${x.changePct>=0?'pos':'neg'}">${pct(x.changePct)}</span></div><div><b>Why now?</b></div><div class="evidence">${evidence||`<div class="evidence-item">${x.summary}</div>`}</div><div class="kv"><div class="card"><b>يؤكد الفرضية</b><span>${x.confirm||'استمرار الزخم مع سيولة وتأكيد سعري'}</span></div><div class="card"><b>يبطل الفرضية</b><span>${x.invalidate||'فقدان الزخم/السيولة أو كسر البنية'}</span></div></div><div class="meters">${meters}</div>`;
}

async function loadFeed(url){
 if(!url) return;
 const btn=$('#connectBtn'); const old=btn.textContent; btn.textContent='جارٍ الاتصال…'; btn.disabled=true;
 try{
   const res=await fetch(url,{cache:'no-store'}); if(!res.ok) throw new Error(`HTTP ${res.status}`); const data=await res.json();
   if(!data||!Array.isArray(data.symbols)) throw new Error('Invalid TAGit feed format');
   process({...data,asOf:data.asOf||new Date().toISOString()},true,url); localStorage.setItem('tagitFeedUrl',url);
 }catch(e){alert(`تعذر ربط المصدر الحي: ${e.message}\nسيبقى TAGit في وضع العرض دون ادعاء بيانات حية.`);}
 finally{btn.textContent=old;btn.disabled=false;}
}

$('#filters').onclick=e=>{const f=e.target.closest('[data-filter]');if(!f)return;state.filter=f.dataset.filter;render();};
$('#connectBtn').onclick=()=>loadFeed($('#feedUrl').value.trim());
$('#demoBtn').onclick=()=>{localStorage.removeItem('tagitFeedUrl');process({...demo,asOf:new Date().toISOString()},false,'');};
$('#refreshBtn').onclick=()=>state.live?loadFeed(state.url):process({...demo,asOf:new Date().toISOString()},false,'');

const configured=window.TAGIT_FEED_URL||localStorage.getItem('tagitFeedUrl')||''; $('#feedUrl').value=configured;
process(demo,false,'');
if(configured) loadFeed(configured);
