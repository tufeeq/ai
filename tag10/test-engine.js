const {analyze}=require('./engine.js');
const live={marketDataVerified:true,source:'TEST_MARKET',sourceTimestamp:'2026-08-13T06:00:00Z'};
const cases=[
 ['early-pressure',{...live,ticker:'EARLY',price:1,changePct:4,volume:8e6,avgVolume:8e5,float:6e6,spreadPct:.7,catalystAgeHours:2,orderFlowImbalance:.45,bookDepthImbalance:.25,persistenceSlope:.5,gainRetention:.9,sympathyScore:70,dilutionRisk:10,haltHazard:8}],
 ['late-risk',{...live,ticker:'LATE',price:.5,changePct:110,volume:1.2e8,avgVolume:1e6,float:4e6,spreadPct:3,catalystAgeHours:4,orderFlowImbalance:-.2,bookDepthImbalance:-.1,persistenceSlope:-.4,gainRetention:.4,dilutionRisk:65,haltHazard:80}],
 ['missing-data',{...live,ticker:'MISS',price:1,changePct:2,volume:1e5}],
 ['unverified-source',{ticker:'FAKE',price:.82,changePct:6.2,volume:6400000,avgVolume:900000,float:7200000,spreadPct:.8}]
];
let failed=0;
for(const [name,input] of cases){const z=analyze(input);console.log(name,z.state,z.decision,z.probabilities?((z.probabilities.pUp10*100).toFixed(1)):'NO_PROB',(z.evidence.quality*100).toFixed(0));if(name==='early-pressure'&&!['NOW','FORMING','WATCH'].includes(z.decision))failed++;if(name==='late-risk'&&z.decision!=='AVOID')failed++;if(name==='missing-data'&&z.decision!=='ABSTAIN_DATA')failed++;if(name==='unverified-source'&&(z.decision!=='ABSTAIN_DATA'||z.probabilities!==null||z.targets.length!==0))failed++;}
if(failed){console.error('FAILED',failed);process.exit(1)}console.log('TAG10 fail-closed tests passed');