import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {gunzipSync,gzipSync} from 'node:zlib';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCalendar} from '../core/calendar.mjs';
import {normalizeBar} from '../core/data.mjs';
import {openStore,hash} from '../core/store.mjs';
import {createEngine} from '../core/engine.mjs';
import {configuration} from '../core/config.mjs';
import {simulate,summarizeSimulation} from '../core/simulator.mjs';
import {discoveryOutcome,partitions,walkForward,synchrony,stockProfiles} from '../core/evaluation.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),input=resolve(process.argv[2]||resolve(root,'../data'));
const output=resolve(process.argv[3]||resolve(root,'web/data'));mkdirSync(output,{recursive:true});
const audit=JSON.parse(readFileSync(resolve(input,'discovery-audit.json'))),manifest=JSON.parse(readFileSync(resolve(input,'study-manifest.json')));
const calendarData=JSON.parse(readFileSync(resolve(root,'../data/capabilities/calendar-20260824-20260904.json'))).calendar;
const calendar=createCalendar(calendarData,{start:'2026-08-24',end:'2026-09-04'}),config=configuration({mode:'REPLAY'});
const store=openStore(process.env.TAG_ELITE_REPLAY_DB||':memory:'),runId='elite-study-20260925-v1';
const sourceHash=hash(manifest);store.registerExperiment(runId,config,sourceHash,'EXPOSED_DEVELOPMENT_ONLY');
const engine=createEngine({store,calendar,config,runId,sourceHash,discoveryMode:'PRESERVED'});
const all=[],paths=new Map(),days=[...new Set(audit.events.map(x=>x.date))].sort();let normalizedCount=0;
for(const day of days){
 const raw=JSON.parse(gunzipSync(readFileSync(resolve(input,'study',day+'.json.gz'))));
 const file=manifest.files.find(f=>f.path.endsWith(day+'.json.gz'));const bytes=readFileSync(resolve(input,'study',day+'.json.gz'));
 if(!file||hash(bytes)!==file.sha256)throw Error('SOURCE_HASH_MISMATCH '+day);
 const dayEvents=audit.events.filter(e=>e.date===day),symbols=[...new Set(dayEvents.map(e=>e.symbol))];
 for(const symbol of symbols){
   const events=dayEvents.filter(e=>e.symbol===symbol),byAt=new Map(events.map(e=>[Date.parse(e.detected_at),e]));
   const session=calendar.session(day);const bars=(raw.bars[symbol]||[]).map(b=>normalizeBar(b,{symbol,feed:'sip',receivedAt:new Date(Date.parse(b.timestamp)+60000).toISOString(),availabilityBasis:'ASSUMED_BAR_CLOSE_ARCHIVE_RECEIPT_UNKNOWN'})).filter(b=>Date.parse(b.t)>=session.open&&Date.parse(b.t)<session.close);
   normalizedCount+=bars.length;paths.set(day+':'+symbol,bars);
   for(const b of bars){const original=byAt.get(Date.parse(b.received_at));
     const signal=original?{imported:true,expansion:true,originalRecord:{symbol:original.symbol,detected_at:original.detected_at,signal_price:original.signal_price},baselineSourceHash:sourceHash}:null;
     engine.process(b,{detect:signal});
   }
   const o=engine.snapshots().find(x=>x.symbol===symbol&&x.session===day);if(!o)throw Error('BASELINE_SIGNAL_NOT_PRESERVED '+day+' '+symbol);
   const timeline=engine.timeline(o.id),outcome=discoveryOutcome(o,bars,session.close),equal30=discoveryOutcome(o,bars,session.close,{horizonMinutes:30});
   const diagnostic=simulate(o,bars,timeline,session,config,{diagnostic:true}),strict=simulate(o,bars,timeline,session,config);
   all.push({...o,timeline,outcome,equal30,simulation:diagnostic,strictSimulation:strict,
     bars:bars.map(b=>[Date.parse(b.t),b.o,b.h,b.l,b.c,b.v]),dataProvenance:'SIP historical archive; previously selected sample; historical eligibility unknown'});
 }
 store.job(runId,'REPLAY',day,'RUNNING');console.log(JSON.stringify({session:day,opportunities:all.length}));
}
const summary={name:'TAG elite',version:config.version,mode:'REPLAY',generatedAt:new Date().toISOString(),sourceHash,config,baselineCommit:'cbfd60e97da730b22c77793ba1b4b194301a3f5b',
 scope:{sessions:days.length,symbols:96,sourceBars:manifest.total_bars,processedBars:normalizedCount,preservedSignals:audit.events.length,opportunities:all.length,completePaths:all.filter(x=>x.outcome.complete).length,strictEligible:all.filter(x=>x.first_eligibility.status==='ELIGIBLE').length},
 outcomes:Object.fromEntries([10,20,50].map(n=>[n,{observed:all.filter(o=>o.outcome.hits[n].status==='OBSERVED_HIT').length,notHit:all.filter(o=>o.outcome.hits[n].status==='NOT_HIT_COMPLETE_PATH').length,unknown:all.filter(o=>o.outcome.hits[n].status==='UNKNOWN').length}])),
 diagnostic:summarizeSimulation(all.map(x=>x.simulation)),strict:summarizeSimulation(all.map(x=>x.strictSimulation)),
 partitions:partitions(days),walkForward:walkForward(days),profiles:stockProfiles(all),synchrony:synchrony(all),
 rulesPromoted:false,independentValidation:false,limitations:['Previously exposed selected sample','Historical eligibility and compliance unknown','Archive receipt times unknown; bar-close availability assumed','No historical quotes in this archive','No complete point-in-time market universe; missed-market opportunities cannot be counted','IEX live and SIP historical are different coverage','Missing minutes retain unknown outcomes','No automatic real trading']};
const sensitivity=[];for(const spreadBps of [20,80,150])for(const quantity of [100,1000]){
 const cfg=configuration({mode:'REPLAY',execution:{spreadBps,quantity}}),id=runId+`-cost-${spreadBps}-size-${quantity}`;
 store.registerExperiment(id,cfg,sourceHash,'EXPOSED_DEVELOPMENT_SENSITIVITY');
 const results=all.map(o=>simulate(o,paths.get(o.session+':'+o.symbol),o.timeline,calendar.session(o.session),cfg,{diagnostic:true}));
 const result={spreadBps,quantity,summary:summarizeSimulation(results)};store.experimentResult(id,result);sensitivity.push(result);
}
summary.sensitivity=sensitivity;
summary.walkForward=summary.walkForward.map(f=>({...f,performance:summarizeSimulation(all.filter(o=>f.test.includes(o.session)).map(o=>o.simulation)),fit:'NONE_FIXED_RESEARCH_RULES'}));
summary.partitionPerformance=Object.fromEntries(['development','validationDiagnostic','testDiagnostic'].map(k=>[k,summarizeSimulation(all.filter(o=>summary.partitions[k].includes(o.session)).map(o=>o.simulation))]));
const matched=all.filter(o=>o.simulation.families.every(f=>f.trades.some(t=>t.returnPct!==null)));
summary.matchedOpportunityDiagnostic={opportunities:matched.length,summary:summarizeSimulation(matched.map(o=>({...o.simulation,families:o.simulation.families.map(f=>({...f,trades:f.trades.filter(t=>t.returnPct!==null).slice(0,1)}))}))),restriction:'First scorable trade per family on common opportunities; exposed complete-case subset, selection bias remains'};
summary.baselineLargeMoveDiagnostic={selectedSampleSessionsAbove20:audit.sessions_with_20pct_excursion,detectedBefore10Before20:audit.detected_below_10pct_before_20pct,definition:'Original baseline: +20% from first observed bar, not necessarily session open; selected sample only',marketWideMissed:null};
store.experimentResult(runId,summary);store.job(runId,'REPLAY',days.at(-1),'COMPLETED');
writeFileSync(resolve(output,'summary.json'),JSON.stringify(summary));
writeFileSync(resolve(output,'opportunities.json'),JSON.stringify(all));
for(const day of days)writeFileSync(resolve(output,day+'.json.gz'),gzipSync(JSON.stringify(all.filter(o=>o.session===day)),{mtime:0}));
writeFileSync(resolve(root,'docs/experiment-registry.json'),JSON.stringify(store.db.prepare('SELECT * FROM experiments').all(),null,2));
console.log(JSON.stringify({complete:true,scope:summary.scope,outcomes:summary.outcomes,diagnostic:summary.diagnostic}));store.close();
