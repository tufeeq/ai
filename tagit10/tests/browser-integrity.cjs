const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const row=()=>({symbol:'TEST',price:10,changePct:3,score:65,stage:'CONFIRMED',
  quoteTimestampUTC:new Date(Date.now()-60000).toISOString(),screeningVersion:'10.3',
  screeningPassed:true,barClosed:true,riskBlocks:[],confirmationCount:2,ret5mPct:1,
  dollarVolume5m:200000,dollarVolume15m:600000,reasons:['Test fixture only']});
 const fresh=()=>({engineVersion:'10.3',updatedAtUTC:new Date().toISOString(),session:'regular',
  universeScanned:1,quotesFresh:1,quotesValid:1,watch:[row()],early:[],actionable:[],confirmed:[]});
 let feed=fresh();
 await page.route('https://raw.githubusercontent.com/**',async route=>{
  const url=route.request().url();
  const data=url.includes('tagit10-live.json')?feed:url.includes('historical-training')?
   {status:'TRAINED_RESEARCH_ONLY',promoted:false,test:{selected:107,precisionPct:26.17,meanNetReturnPct:-.4518},splits:{test:[]},limitations:[]}:
   {status:'PENDING',patterns:[],lessons:[]};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:8765/tagit10/');
 await page.waitForFunction(()=>document.getElementById('confirmedN').textContent==='1');
 assert((await page.locator('#health').textContent()).includes('وضع البحث'));
 await page.waitForFunction(()=>document.getElementById('evidenceNotice').textContent.includes('26.17'));
 await page.locator('#useInPlan').click();
 await page.locator('#planSymbol').waitFor({state:'visible'});
 assert.equal(await page.locator('#planSymbol').inputValue(),'TEST');
 await page.locator('[data-view="radar"]').click();
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
 await refresh(old,0);assert.equal(await page.locator('#earlyN').textContent(),'0');
 await page.locator('[data-tab="watch"]').click();assert((await page.locator('#rows').textContent()).includes('سعر متأخر'));
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
 assert.deepEqual(errors,[]);
 console.log('PASS: candidate, visible evidence, paper import, legacy engine, blocked signal, invalid boolean, stale quote, mobile layout, no page errors');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
