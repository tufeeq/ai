const {analyze}=require('./engine.js');
const cases=[
 ['early-pressure',{ticker:'EARLY',price:1,changePct:4,volume:8e6,avgVolume:8e5,float:6e6,spreadPct:.7,catalystAgeHours:2,orderFlowImbalance:.45,bookDepthImbalance:.25,persistenceSlope:.5,gainRetention:.9,sympathyScore:70,dilutionRisk:10,haltHazard:8,sharia:'VERIFIED'}],
 ['late-risk',{ticker:'LATE',price:.5,changePct:110,volume:1.2e8,avgVolume:1e6,float:4e6,spreadPct:3,catalystAgeHours:4,orderFlowImbalance:-.2,bookDepthImbalance:-.1,persistenceSlope:-.4,gainRetention:.4,dilutionRisk:65,haltHazard:80,sharia:'VERIFIED'}],
 ['unverified',{ticker:'UNV',price:2,changePct:5,volume:2e6,avgVolume:1e6,float:12e6,spreadPct:.5,catalystAgeHours:6,sharia:'UNVERIFIED'}],
 ['missing-data',{ticker:'MISS',price:1,changePct:2,volume:1e5,sharia:'VERIFIED'}]
];
let failed=0;for(const [name,input] of cases){const z=analyze(input);console.log(name,z.state,z.decision,(z.probabilities.pUp10*100).toFixed(1),(z.evidence.quality*100).toFixed(0));if(name==='early-pressure'&&!['NOW','FORMING','WATCH'].includes(z.decision))failed++;if(name==='late-risk'&&z.decision!=='AVOID')failed++;if(name==='unverified'&&z.decision!=='SHARIA_UNVERIFIED')failed++;if(name==='missing-data'&&z.decision!=='ABSTAIN_DATA')failed++;}
if(failed){console.error('FAILED',failed);process.exit(1)}console.log('TAG10 engine tests passed');