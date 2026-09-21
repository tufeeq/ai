'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium,webkit}=require('playwright');
(async()=>{
 const base=process.env.SITE_URL||process.env.PAGES_URL.replace(/\/$/,'')+'/dont-chaos/';
 const types=process.env.WEBKIT==='1'?[['chromium',chromium],['webkit',webkit]]:[['chromium',chromium]];
 const reports=[],errors=[];
 for(const [name,type] of types){
  const browser=await type.launch(name==='chromium'?{channel:'chrome',headless:true,args:['--no-sandbox']}:{headless:true});
  const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(name+': '+e.message));
  await page.goto(base+'?v=3&qa='+Date.now(),{waitUntil:'networkidle'});
  assert.equal(await page.evaluate(()=>DontChaos.version),'3.0.0');
  assert.equal(await page.locator('.world-card').count(),4);
  // Check real persistence with a fresh navigation, not a storage mock.
  await page.locator('#settings').click();await page.locator('#nickname').fill('Director QA');await page.locator('[data-do="settings-save"]').click();
  await page.reload({waitUntil:'networkidle'});await page.locator('#settings').click();assert.equal(await page.locator('#nickname').inputValue(),'Director QA');await page.locator('#modal-close').click();
  for(const world of ['neon','orbit','night','temple']){
   await page.locator('[data-world="'+world+'"]').click();assert.equal(await page.locator('[data-level]').count(),5);
   assert.equal(await page.locator('[data-pace="calm"]').getAttribute('aria-pressed'),'true');
   await page.locator('[data-do="start-sound"]').click();
   await page.waitForFunction(()=>DontChaos.inspect().mode==='playing');
   await page.waitForFunction(()=>{const a=DontChaos.inspect().audio;return a.mediaPlaying&&a.mediaTime>1&&!a.error;},{},{timeout:10000});
   const key=world==='temple'?'jump':'skill';
   // Trusted browser input exercises the pointer handler without inventing an active pointer ID.
   const target=await page.locator('[data-key="'+key+'"]').boundingBox();
   await page.mouse.move(target.x+target.width/2,target.y+target.height/2);await page.mouse.down();
   await page.waitForTimeout(250);
   await page.mouse.up();
   const s=await page.evaluate(()=>DontChaos.inspect());
   assert.equal(s.run.health,5);assert.equal(s.audio.mediaPlaying,true);assert.equal(s.audio.context,'running');
   const rect=await page.locator('#controls').boundingBox();assert(rect.y+rect.height<=846,JSON.stringify(rect));
   assert(await page.evaluate(()=>{const c=document.querySelector('#game-canvas'),ctx=c.getContext('2d'),d=ctx.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=1000)if(d[i]+d[i+1]+d[i+2]>100)n++;return n>100;}));
   await page.locator('#pause-game').click();const t=await page.evaluate(()=>DontChaos.inspect().run.t);await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>DontChaos.inspect().run.t),t);assert.equal(await page.evaluate(()=>DontChaos.inspect().audio.mediaPlaying),false);
   await page.locator('[data-do="resume"]').click();await page.waitForFunction(()=>DontChaos.inspect().mode==='playing');await page.waitForTimeout(250);assert((await page.evaluate(()=>DontChaos.inspect().run.t))>t);assert.equal(await page.evaluate(()=>DontChaos.inspect().audio.mediaPlaying),true);
   reports.push({browser:name,world,version:'3.0.0',audio:s.audio,openingHealth:s.run.health,pauseResume:'passed',viewport:{width:390,height:844},controls:rect});
   await page.locator('#pause-game').click();await page.locator('[data-do="home"]').click();
  }
  // Every supported layout keeps the rule and touch controls on-screen.
  for(const viewport of [{width:320,height:568},{width:844,height:390},{width:1440,height:1000}]){
   await page.setViewportSize(viewport);await page.locator('[data-world="neon"]').click();await page.locator('[data-do="start-silent"]').click();
   const box=await page.locator('#controls').boundingBox();assert(box.y+box.height<=viewport.height+2);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.locator('#pause-game').click();await page.locator('[data-do="home"]').click();
  }
  await ctx.close();await browser.close();
 }
 assert.equal(errors.length,0,errors.join('\n'));
 fs.writeFileSync('/tmp/dont-chaos-v3-live-report.json',JSON.stringify({url:base,scope:'Browser media playback, controls, pause, layouts, persistence. Not physical iPhone audibility.',reports,errors},null,2));
 console.log('DIRECTORS CUT LIVE BROWSER PASS',JSON.stringify(reports));
})().catch(e=>{console.error(e);process.exit(1)});
