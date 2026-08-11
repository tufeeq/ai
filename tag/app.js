const demo=[
 {ticker:'WAFU',price:2.41,changePct:66.1,volume:21500000,avgVolume:620000,float:4500000,pmChange:2,ahChange:66.1,ahVolume:19000000,catalystAgeHours:4,spreadPct:1.2,sharia:'UNVERIFIED'},
 {ticker:'BW',price:12.58,changePct:41.7,volume:7300000,avgVolume:1700000,float:90000000,pmChange:1,ahChange:41.7,ahVolume:3000000,catalystAgeHours:3,spreadPct:.4,sharia:'UNVERIFIED'},
 {ticker:'MTEN',price:1.40,changePct:29.6,volume:41000000,avgVolume:1800000,float:7650000,pmChange:5,ahChange:29.6,ahVolume:9000000,catalystAgeHours:96,spreadPct:2.2,sharia:'UNVERIFIED'},
 {ticker:'SOAR',price:.17,changePct:25.6,volume:314000000,avgVolume:22000000,float:30000000,pmChange:30,ahChange:-2.3,ahVolume:3700000,catalystAgeHours:144,spreadPct:1.5,sharia:'UNVERIFIED'},
 {ticker:'SCKT',price:8.1,changePct:180,volume:58000000,avgVolume:90000,float:3700000,pmChange:545,ahChange:-27,ahVolume:4100000,catalystAgeHours:18,spreadPct:2.7,sharia:'UNVERIFIED'},
 {ticker:'PLBY',price:2.3,changePct:26,volume:8000000,avgVolume:1200000,float:42000000,pmChange:0,ahChange:26,ahVolume:1500000,catalystAgeHours:8,spreadPct:1.1,sharia:'EXCLUDED'}
];
let rows=[];
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
const n=v=>Number(v)||0;
function analyze(x){
 const rvol=x.avgVolume>0?x.volume/x.avgVolume:0;
 const turnover=x.float>0?x.volume/x.float:0;
 const ahPart=x.volume>0?x.ahVolume/x.volume:0;
 const fresh=x.catalystAgeHours>=0&&x.catalystAgeHours<=24;
 const extended=Math.max(Math.abs(x.pmChange),Math.abs(x.ahChange));
 const liquidity=clamp(Math.log2(1+rvol)*17);
 const turnoverScore=clamp(Math.log2(1+turnover)*24);
 const extScore=clamp(extended*1.15);
 const spreadQuality=clamp(100-x.spreadPct*18);
 const catalyst=fresh?88:x.catalystAgeHours<=72?55:25;
 let early=clamp(liquidity*.28+turnoverScore*.22+extScore*.25+spreadQuality*.13+catalyst*.12);
 let ignition=clamp(early*.55+clamp(x.changePct*1.25)*.25+liquidity*.2);
 let continuation=clamp(42+Math.max(x.ahChange,0)*.45+ahPart*80+spreadQuality*.14+(fresh?12:0));
 let exhaustion=clamp(Math.max(0,x.changePct-35)*.65+turnover*7+Math.max(0,-x.ahChange)*1.4+(rvol>12?12:0));
 if(x.changePct>80) early-=18;
 if(x.changePct>120) exhaustion+=20;
 if(x.ahChange<0&&x.changePct>50){continuation-=25;exhaustion+=18}
 if(x.sharia==='EXCLUDED'){early=0;ignition=0;continuation=0}
 early=clamp(early);ignition=clamp(ignition);continuation=clamp(continuation);exhaustion=clamp(exhaustion);
 let stage='DISCOVERY';
 if(x.changePct>90||exhaustion>76)stage='EXHAUSTION';
 else if(x.changePct>35||early<45&&ignition>60)stage='LATE';
 else if(ignition>62||x.changePct>15)stage='IGNITION';
 const score=clamp(early*.55+continuation*.25+ignition*.2-exhaustion*.22);
 const reasons=[];
 if(rvol>=5)reasons.push(`RVOL ${rvol.toFixed(1)}×`);
 if(turnover>=1)reasons.push(`Turnover ${turnover.toFixed(1)}× float`);
 if(Math.abs(x.pmChange)>=15)reasons.push(`PM ${x.pmChange>0?'+':''}${x.pmChange}%`);
 if(Math.abs(x.ahChange)>=15)reasons.push(`AH ${x.ahChange>0?'+':''}${x.ahChange}%`);
 if(fresh)reasons.push('Fresh catalyst');
 if(x.changePct>80)reasons.push('Late-move penalty');
 if(x.ahChange<0&&x.changePct>50)reasons.push('Exhaustion memory');
 return {...x,rvol,turnover,ahPart,fresh,early,ignition,continuation,exhaustion,score,stage,reasons};
}
function render(){
 const q=document.querySelector('#search').value.trim().toUpperCase();
 const sf=document.querySelector('#stageFilter').value,sh=document.querySelector('#shariaFilter').value;
 const out=rows.map(analyze).filter(x=>(!q||x.ticker.includes(q))&&(sf==='all'||x.stage===sf)&&(sh==='all'||x.sharia===sh)).sort((a,b)=>b.score-a.score);
 document.querySelector('#scannerBody').innerHTML=out.map(x=>`<tr><td class="ticker">${x.ticker}</td><td>$${n(x.price).toFixed(x.price<1?3:2)}</td><td class="${x.changePct>=0?'pos':'neg'}">${x.changePct>=0?'+':''}${x.changePct.toFixed(1)}%</td><td class="score">${x.score.toFixed(0)}</td><td><span class="pill p-${x.stage.toLowerCase()}">${x.stage}</span></td><td>${x.ignition.toFixed(0)}</td><td>${x.continuation.toFixed(0)}</td><td>${x.exhaustion.toFixed(0)}</td><td><span class="pill p-${x.sharia.toLowerCase()}">${x.sharia}</span></td><td>${x.reasons.join(' · ')||'No strong trigger'}</td></tr>`).join('')||'<tr><td colspan="10">لا توجد نتائج مطابقة.</td></tr>';
 const analyzed=rows.map(analyze);const discovery=analyzed.filter(x=>x.stage==='DISCOVERY'||x.stage==='IGNITION').length;const excluded=analyzed.filter(x=>x.sharia==='EXCLUDED').length;const avg=analyzed.length?analyzed.reduce((s,x)=>s+x.score,0)/analyzed.length:0;
 document.querySelector('#summaryCards').innerHTML=`<div class="metric"><small>Universe</small><strong>${rows.length}</strong></div><div class="metric"><small>Early candidates</small><strong>${discovery}</strong></div><div class="metric"><small>Average TAG Score</small><strong>${avg.toFixed(0)}</strong></div><div class="metric"><small>Sharia excluded</small><strong>${excluded}</strong></div>`;
}
function resultHTML(x){return `<div class="result-top"><div><div class="ticker">${x.ticker}</div><span class="pill p-${x.stage.toLowerCase()}">${x.stage}</span> <span class="pill p-${x.sharia.toLowerCase()}">${x.sharia}</span></div><div class="big-score">${x.score.toFixed(0)}</div></div><div class="score-bars">${[['Early Regime',x.early],['Ignition',x.ignition],['Continuation',x.continuation],['Exhaustion',x.exhaustion]].map(([k,v])=>`<div class="bar-row"><span>${k}</span><div class="bar"><i style="width:${v}%"></i></div><b>${v.toFixed(0)}</b></div>`).join('')}</div><p>${x.reasons.join(' · ')||'لا توجد إشارة قوية.'}</p><small>RVOL ${x.rvol.toFixed(2)}× · Turnover ${x.turnover.toFixed(2)}× · AH participation ${(x.ahPart*100).toFixed(1)}%</small>`}
function parseCSV(t){const lines=t.trim().split(/\r?\n/);const h=lines.shift().split(',').map(s=>s.trim());return lines.map(line=>{const v=line.split(',');const o={};h.forEach((k,i)=>o[k]=v[i]?.trim());['price','changePct','volume','avgVolume','float','pmChange','ahChange','ahVolume','catalystAgeHours','spreadPct'].forEach(k=>o[k]=n(o[k]));o.ticker=(o.ticker||'').toUpperCase();o.sharia=(o.sharia||'UNVERIFIED').toUpperCase();return o}).filter(x=>x.ticker)}
function exportCSV(){const a=rows.map(analyze);const h=['ticker','TAGScore','stage','ignition','continuation','exhaustion','sharia','rvol','turnover'];const csv=[h.join(','),...a.map(x=>[x.ticker,x.score.toFixed(1),x.stage,x.ignition.toFixed(1),x.continuation.toFixed(1),x.exhaustion.toFixed(1),x.sharia,x.rvol.toFixed(2),x.turnover.toFixed(2)].join(','))].join('\n');const b=new Blob([csv],{type:'text/csv'}),u=URL.createObjectURL(b),ael=document.createElement('a');ael.href=u;ael.download='TAG5-results.csv';ael.click();URL.revokeObjectURL(u)}
document.querySelector('#loadDemo').onclick=()=>{rows=structuredClone(demo);render();document.querySelector('#integrityLog').innerHTML='<div class="log-item">DEMO dataset loaded — timestamps are illustrative, not live market data.</div><div class="log-item warn">UNVERIFIED means Sharia financial screening has not been completed.</div>'};
['search','stageFilter','shariaFilter'].forEach(id=>document.querySelector('#'+id).addEventListener('input',render));
document.querySelector('#csvFile').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;rows=parseCSV(await f.text());render();document.querySelector('#integrityLog').innerHTML=`<div class="log-item">Imported ${rows.length} records from ${f.name}.</div><div class="log-item warn">Final Snapshot Reconciliation must be performed upstream before treating imported values as training truth.</div>`});
document.querySelector('#exportBtn').onclick=exportCSV;
document.querySelector('#analyzerForm').addEventListener('submit',e=>{e.preventDefault();const fd=new FormData(e.currentTarget),o={};for(const [k,v] of fd)o[k]=k==='ticker'||k==='sharia'?v.toUpperCase():n(v);document.querySelector('#analysisResult').innerHTML=resultHTML(analyze(o));document.querySelector('#analysisResult').classList.remove('empty')});
const ruleData=[['Early Regime Shift','Price range + time-normalized liquidity + turnover + spread quality.'],['Extended-Hours Persistence','Separates persistent ignition from flash spike/fade.'],['Persistence Slope','Tracks strengthening, flat, or decaying AH momentum.'],['Catalyst Clock','Separates fresh/event-driven moves from recycled/no-news momentum.'],['Late Detection Penalty','Huge RVOL after a major move is not credited as early discovery.'],['Exhaustion Memory','Penalizes mega-runners that fail to retain gains.'],['Final Snapshot Reconciliation','Do not train on mismatched or stale end-of-window snapshots.'],['Sharia Gate','Excluded activity is blocked; incomplete financial screening remains Unverified.']];document.querySelector('#rules').innerHTML=ruleData.map(([a,b])=>`<div class="rule"><strong>${a}</strong><span>${b}</span></div>`).join('');
render();