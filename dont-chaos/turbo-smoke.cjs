const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const base=process.env.PAGES_URL.replace(/\/$/,'')+'/dont-chaos/?v=2';
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
 const errors=[];const reports=[];
 for(const viewport of [{width:390,height:844},{width:844,height:390},{width:1440,height:1000}]){
  const context=await browser.newContext({viewport,isMobile:viewport.width<520,hasTouch:viewport.width<900});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'networkidle'});
  assert.equal(await page.evaluate(()=>DontChaos.version),'2.0.0');
  assert.equal(await page.locator('.world-card').count(),12);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // A real persisted nickname, not an in-memory mock.
  await page.locator('[data-do="profile"]').first().click();
  await page.locator('#player-name').fill('Turbo QA');await page.locator('[data-do="save-profile"]').click();
  await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('#header-name').innerText(),'Turbo QA');
  await page.locator('[data-world="meteor"]').click();assert.equal(await page.locator('[data-level]').count(),5);
  await page.locator('[data-level="3"]').click();await page.locator('[data-do="start"]').click();
  await page.waitForFunction(()=>DontChaos.inspect().status==='playing');
  // First Meteor Raid encounter always starts on the left.
  await page.locator('[data-action="left"]').dispatchEvent('pointerdown',{pointerId:1,bubbles:true});
  const run=await page.evaluate(()=>DontChaos.inspect());assert.equal(run.cleared,1);assert.equal(run.lives,3);
  const audio=await page.evaluate(()=>DontChaos.audio());assert.equal(audio.state,'running');assert(audio.notes>0);assert(audio.effects>0);
  const bounds=await page.locator('#controls').boundingBox();assert(bounds.y+bounds.height<=viewport.height+2);
  await page.locator('#pause-game').click();const elapsed=await page.evaluate(()=>DontChaos.inspect().elapsed);
  await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>DontChaos.inspect().elapsed),elapsed);
  assert.equal(await page.evaluate(()=>DontChaos.audio().running),false);
  reports.push({viewport,version:'2.0.0',worlds:12,levels:60,run,audio,storage:'persisted',pause:'passed'});
  await context.close();
 }
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('TURBO LIVE BROWSER SMOKE PASS',JSON.stringify(reports));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
