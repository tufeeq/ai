const KEY='tagitOutcomeLedgerV2';
const HOUR=3600000,DAY=86400000;
const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch{return[]}};
const save=x=>localStorage.setItem(KEY,JSON.stringify(x.slice(-1000)));
const num=v=>{const x=parseFloat(String(v||'').replace(/[^0-9.+-]/g,''));return Number.isFinite(x)?x:0};
function rows(){
  if(document.body.dataset.feedState!=='fresh')return[];
  if(!['pre-market','regular','after-hours'].includes(document.body.dataset.session||''))return[];
  return[...document.querySelectorAll('#rows tr[data-symbol]')].map(r=>{const c=r.children;return{symbol:r.dataset.symbol,phase:c[1]?.textContent?.trim(),score:num(c[2]?.textContent),actionability:num(c[3]?.textContent),gate:c[4]?.textContent?.trim(),price:num(c[5]?.textContent)}}).filter(x=>x.symbol&&x.price>0);
}
function ingest(){
  const now=Date.now(),q=rows();if(!q.length){render();return}const ledger=load(),latest=new Map(q.map(x=>[x.symbol,x]));
  for(const rec of ledger.filter(x=>!x.closedAt)){const p=latest.get(rec.symbol);if(!p)continue;const ret=(p.price/rec.entryPrice-1)*100;rec.lastPrice=p.price;rec.lastSeen=now;rec.lastReturn=+ret.toFixed(2);rec.mfe=Math.max(rec.mfe??ret,ret);rec.mae=Math.min(rec.mae??ret,ret);if(now-rec.openedAt>=HOUR&&rec.oneHourReturn===undefined){rec.oneHourReturn=+ret.toFixed(2);rec.hit5_1h=ret>=5;rec.hit10_1h=ret>=10}if(now-rec.openedAt>=DAY){rec.closedAt=now;rec.dayReturn=+ret.toFixed(2);rec.hit20_day=ret>=20}}
  for(const p of q.filter(x=>x.gate==='WATCH'))if(!ledger.some(x=>x.symbol===p.symbol&&!x.closedAt&&now-x.openedAt<6*HOUR))ledger.push({id:`${p.symbol}-${now}`,symbol:p.symbol,openedAt:now,entryPrice:p.price,phase:p.phase,score:p.score,actionability:p.actionability,mfe:0,mae:0});
  save(ledger);render();
}
function stats(){const a=load(),h=a.filter(x=>x.oneHourReturn!==undefined),d=a.filter(x=>x.closedAt);const rate=(x,k)=>x.length?Math.round(x.filter(v=>v[k]).length/x.length*100):null,avg=(x,k)=>x.length?+(x.reduce((s,v)=>s+(Number(v[k])||0),0)/x.length).toFixed(1):null;return{signals:a.length,mature:h.length,hit5:rate(h,'hit5_1h'),hit10:rate(h,'hit10_1h'),hit20:rate(d,'hit20_day'),mfe:avg(h,'mfe'),mae:avg(h,'mae')}}
function render(){const host=document.querySelector('#calibration');if(!host)return;const s=stats(),v=x=>x===null?'—':`${x}%`;host.innerHTML=`<div class="panel-head"><div><div class="panel-title">TAGit Calibration</div><div class="panel-sub">نتائج WATCH المسجلة فقط أثناء مصدر سوق Fresh — وليست Backtest</div></div><button id="exportLedger" class="btn">تصدير JSON</button></div><div class="cal-grid"><div><b>${s.signals}</b><span>Signals</span></div><div><b>${s.mature}</b><span>≥ 1h</span></div><div><b>${v(s.hit5)}</b><span>Hit +5% / 1h</span></div><div><b>${v(s.hit10)}</b><span>Hit +10% / 1h</span></div><div><b>${v(s.mfe)}</b><span>Avg MFE</span></div><div><b>${v(s.mae)}</b><span>Avg MAE</span></div></div>`;document.querySelector('#exportLedger')?.addEventListener('click',()=>{const b=new Blob([JSON.stringify(load(),null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`tagit-ledger-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href)})}
const start=()=>{const target=document.querySelector('#rows');if(target)new MutationObserver(()=>{clearTimeout(window.__tagitLedgerTimer);window.__tagitLedgerTimer=setTimeout(ingest,300)}).observe(target,{childList:true,subtree:true});render()};
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',start):start();
