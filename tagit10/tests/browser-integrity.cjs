const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const row=()=>({symbol:'TEST',price:10,changePct:3,score:65,stage:'CONFIRMED',
  quoteTimestampUTC:new Date(Date.now()-60000).toISOString(),screeningVersion:'10.3',
  screeningPassed:true,barClosed:true,riskBlocks:[],confirmationCount:2,ret5mPct:1,
  dollarVolume5m:200000,dollarVolume15m:600000,reasons:['Test fixture only'],
  explosive:{status:'SHADOW',validationStatus:'NOT_SUPPORTED_FOR_TRADING',score:3.2,aboveResearchThreshold:true,patterns:['VOLUME_IGNITION'],modelId:'TEST_FIXTURE',decisionAtUTC:new Date().toISOString(),tradeEligible:false}});
 const fresh=()=>({engineVersion:'10.3',updatedAtUTC:new Date().toISOString(),session:'regular',
  universeScanned:1,quotesFresh:1,quotesValid:1,watch:[row()],early:[],actionable:[],confirmed:[]});
 let feed=fresh();
 await page.route('https://raw.githubusercontent.com/**',async route=>{
  const url=route.request().url();
  const data=url.includes('explosive-learning')?{status:'TEST_FIXTURE',validationStatus:'NOT_SUPPORTED_FOR_TRADING',holdout:{alerts:5,target20Hits:1,unscorableAlerts:0},collection:{bars:1000,successfulSymbols:10},trainingPatterns:[],splits:{holdout:[]},limitations:[]}:
   url.includes('explosive-cases')?{cases:[]}:url.includes('tagit10-live.json')?feed:url.includes('historical-training')?
   {status:'TRAINED_RESEARCH_ONLY',promoted:false,test:{selected:107,precisionPct:26.17,meanNetReturnPct:-.4518},splits:{test:[]},limitations:[]}:
   {status:'PENDING',patterns:[],lessons:[]};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:8765/tagit10/');
 await page.waitForFunction(()=>document.getElementById('confirmedN').textContent==='1');
 assert((await page.locator('#health').textContent()).includes('السعر حديث'));
 await page.locator('.desk-nav [data-view="research"]').click();
 await page.waitForFunction(()=>document.getElementById('evidenceNotice').textContent.includes('26.17'));
 await page.waitForFunction(()=>document.getElementById('explosiveReport').textContent.includes('لم يجتز النموذج'));
 assert((await page.locator('#explosiveReport').textContent()).includes('20%'));
 await page.waitForFunction(()=>document.getElementById('sessionReport').textContent.includes('لم تثبت ربحية'));
 assert((await page.locator('#sessionReport').textContent()).includes('−2%'));
 await page.locator('.desk-nav [data-view="radar"]').click();
 await page.locator('#useInPlan').click();
 await page.locator('#planSymbol').waitFor({state:'visible'});
 assert.equal(await page.locator('#planSymbol').inputValue(),'TEST');
 await page.locator('.desk-nav [data-view="radar"]').click();
 async function refresh(newFeed,count){
  feed=newFeed;await page.locator('#refresh').click();
  await page.waitForFunction(()=>!document.getElementById('refresh').disabled);
  await page.waitForFunction(n=>document.getElementById('confirmedN').textContent===n,String(count));
 }
 const legacy=fresh();legacy.engineVersion='10.2';
 await refresh(legacy,0);assert.equal(await page.locator('#earlyN').textContent(),'0');
 const blocked=fresh();blocked.watch[0].screeningPassed=false;blocked.watch[0].riskBlocks=['LOW_LIQUIDITY'];
 await refresh(blocked,0);assert.equal(await page.locator('#earlyN').textContent(),'0');
 const stringFlag=fresh();stringFlag.watch[0].screeningPassed='true';
 await refresh(stringFlag,0);assert.equal(await page.locator('#earlyN').textContent(),'0');
 const old=fresh();old.watch[0].quoteTimestampUTC=new Date(Date.now()-3600000).toISOString();
 await refresh(old,'—');assert.equal(await page.locator('#earlyN').textContent(),'—');
 await page.locator('[data-tab="early"]').click();assert((await page.locator('#rows').textContent()).includes('لا يمكن تقييم الفرص'));
 await page.locator('[data-tab="unavailable"]').click();assert((await page.locator('#rows').textContent()).includes('بيانات غير متاحة'));
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
 assert.equal(await page.locator('#evidenceNotice').isVisible(),false);
 await page.locator('[data-symbol="TEST"]').click();
 assert(await page.locator('.details').isVisible());
 assert((await page.locator('#detail').textContent()).includes('درجة النموذج'));
 assert((await page.locator('#detail').textContent()).includes('ليست احتمال ربح'));
 assert((await page.locator('#detail').textContent()).includes('فشل النموذج'));
 await page.locator('#detailClose').click();
 assert.equal(await page.locator('.details').isVisible(),false);
 const empty=fresh();empty.early=[];empty.actionable=[];empty.confirmed=[];empty.watch[0].stage='WATCH';empty.watch[0].screeningPassed=false;empty.watch[0].riskBlocks=['LOW_LIQUIDITY'];empty.quotesValid=720;empty.quotesFresh=193;empty.freshnessBuckets={[empty.watch[0].quoteTimestampUTC]:193};
 await refresh(empty,0);
 await page.locator('[data-tab="watch"]').click();
 assert((await page.locator('#rows').textContent()).includes('TEST'));
 assert((await page.locator('#rows').textContent()).includes('سيولة أعلى'));
 assert.equal(await page.locator('#status').textContent(),'تغطية جزئية');
 assert.equal(await page.locator('#status').getAttribute('data-state'),'stale');
 await page.locator('[data-tab="early"]').click();
 assert((await page.locator('#rows').textContent()).includes('لا توجد حالات مجتازة'));
 await page.locator('#showWatch').click();
 assert((await page.locator('#rows').textContent()).includes('TEST'));
 await page.evaluate(()=>window.scrollTo(0,0));
 const geometry=await page.evaluate(()=>Object.fromEntries(['header','.desk-nav','#health','.metrics','.toolbar','.radar-context','.row'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [s,{y:r.y,height:r.height}]})));
 console.log('Mobile layout',JSON.stringify(geometry));
 assert(geometry['.row'].y<600,JSON.stringify(geometry));
 const mixed=fresh();mixed.watch[0].stage='WATCH';mixed.watch[0].score=10;
 mixed.watch[0].ret15mPct=1;mixed.watch.push({...row(),symbol:'FALL',stage:'WATCH',score:99,ret5mPct:-2,riskBlocks:['FALLING_PRICE'],screeningPassed:false});
 await refresh(mixed,0);
 assert(!(await page.locator('#rows').textContent()).includes('FALL'));
 await page.locator('[data-tab="invalidated"]').click();
 assert((await page.locator('#rows').textContent()).includes('FALL'));
 // Opening structures can be visible before the legacy 30m window completes.
 const opening=fresh();opening.watch=[];opening.sessionSetups=[{...row(),symbol:'OPEN',stage:'WATCH',screeningPassed:false,
  riskBlocks:['INCOMPLETE_WINDOWS'],session:'regular',instrumentType:'EQUITY',
  sessionSetup:{status:'RESEARCH_SETUP',tradeEligible:false,referencePrice:10,decisionAtUTC:new Date().toISOString(),
   families:['OPENING_IMPULSE'],minutesFromOpen:5,indicatorEvidence:{return5:1,logRelativeVolume:Math.log1p(2)},
   validationStatus:'NOT_SUPPORTED_FOR_TRADING',estimatedNet30mPct:-.5}}];
 await refresh(opening,0);await page.locator('[data-tab="setups"]').click();
 assert((await page.locator('#rows').textContent()).includes('OPEN'));
 assert((await page.locator('#rows').textContent()).includes('لم تثبت ربحيته'));
 await page.locator('[data-symbol="OPEN"]').click();
 assert((await page.locator('#detail').textContent()).includes('اندفاع الافتتاح'));
 await page.locator('#detailClose').click();
 opening.sessionSetups[0].sessionSetup.decisionAtUTC=new Date(Date.now()-120000).toISOString();
 await refresh(opening,0);assert(!(await page.locator('#rows').textContent()).includes('OPEN'));
 opening.sessionSetups[0].sessionSetup.decisionAtUTC=new Date().toISOString();opening.sessionSetups[0].price=9.9;
 await refresh(opening,0);assert(!(await page.locator('#rows').textContent()).includes('OPEN'));
 const planned=fresh();planned.watch[0].conditionalPlan={schema:'conditional-plan-v1',id:'TEST_PLAN',entryTrigger:10.02,
  entryLimit:10.04505,stopReference:9.89,targetScenario:10.5,expiresAtUTC:new Date(Date.now()+300000).toISOString(),
  status:'PAPER_TRIGGER_OBSERVED',paperTriggerObserved:true,tradeEligible:false,blocks:[],assumedSlippagePerSidePct:.2,assumedFeePerSide:0,
  quote:{feed:'iex',timestampUTC:new Date().toISOString(),bid:10.02,ask:10.025,bidSize:10,askSize:10}};
 planned.quoteValidation={provider:{status:'OK',feed:'iex',requested:1,received:1},freshQuotes:1};
 await refresh(planned,1);await page.locator('[data-tab="plans"]').click();
 await page.locator('[data-symbol="TEST"]').click();
 assert((await page.locator('#detail').textContent()).includes('لُوحظ شرط الدخول'));
 assert((await page.locator('#detail').textContent()).includes('بورصة واحدة'));
 await page.locator('#copyConditionalPlan').click();
 assert.equal(Number(await page.locator('#planEntry').inputValue()),10.04505);
 assert.equal(Number(await page.locator('#planStop').inputValue()),9.89);
 assert.equal(Number(await page.locator('#planTarget').inputValue()),10.5);
 await page.locator('.desk-nav [data-view="radar"]').click();
 await page.locator('#detailClose').click();
 planned.watch[0].conditionalPlan.quote.timestampUTC=new Date(Date.now()-20000).toISOString();
 await refresh(planned,1);
 assert((await page.locator('#rows').textContent()).includes('بانتظار عرض سعر حديث'));
 assert(!(await page.locator('#rows').textContent()).includes('لُوحظ شرط الدخول'));
 // A fast response must render before the other endpoint finishes.
 await page.route('https://raw.githubusercontent.com/tufeeq/ai/main/tagit10-live.json*',async route=>{
   await new Promise(resolve=>setTimeout(resolve,4000));
   await route.fulfill({status:503,body:'unavailable'});
 });
 feed=fresh();feed.watch[0].symbol='FAST';
 await page.locator('[data-tab="watch"]').click();
 await page.locator('#refresh').click();
 await page.waitForFunction(()=>document.getElementById('rows').textContent.includes('FAST'),{},{timeout:2500});
 assert.equal(await page.locator('#refresh').isDisabled(),true);
 await page.waitForFunction(()=>!document.getElementById('refresh').disabled);
 assert.deepEqual(errors,[]);
 console.log('PASS: candidate, visible evidence, paper import, legacy engine, blocked signal, invalid boolean, stale quote, mobile layout, no page errors');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
