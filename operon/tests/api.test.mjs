import test,{before,after} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {once} from 'node:events';
const dir=mkdtempSync(join(tmpdir(),'operon-api-'));const port=31000+Math.floor(Math.random()*5000),base='http://127.0.0.1:'+port;let proc;
async function start(){proc=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),OPERON_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});await Promise.race([once(proc.stdout,'data'),once(proc,'exit').then(()=>{throw Error('server exited');})]);}
async function stop(){proc.kill('SIGTERM');await once(proc,'exit');}
async function call(path,b,user={},extra={}){const r=await fetch(base+'/api'+path,{method:b?'POST':'GET',headers:{...(b?{'Content-Type':'application/json'}:{}),...(user.cookie?{Cookie:user.cookie,'X-CSRF-Token':user.csrf}:{}),...extra},body:b?JSON.stringify(b):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function register(email){const r=await call('/register',{email,password:'Correct-Horse-Test-123',name:email,company:'Test Company'});assert.equal(r.status,200);return {cookie:r.cookie,csrf:r.data.csrf,id:r.data.workspaces[0].id};}
before(start);after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
test('HTTP lifecycle, tenant isolation, RBAC, CSRF, conflict, idempotency, and restart durability',async()=>{
 const alice=await register('alice@example.test'),bob=await register('bob@example.test');
 assert.equal((await call('/workspaces/'+alice.id,null,bob)).status,403);
 assert.equal((await call('/workspaces/'+alice.id)).status,401);
 assert.equal((await call('/workspaces/'+alice.id+'/command',{version:0,command:{type:'cycle'}},{...alice,csrf:'bad'},{'Idempotency-Key':'csrf-test'})).status,403);
 assert.equal((await call('/workspaces',{name:'Bad origin'},alice,{Origin:'https://evil.test'})).status,403);
 const demo=await call('/workspaces',{name:'QA business',demo:true},alice);assert.equal(demo.status,201);const id=demo.data.id;let s=(await call('/workspaces/'+id,null,alice)).data.state;
 const request={version:s.version,command:{type:'decision.approve',id:s.decisions[0].id}},key={'Idempotency-Key':'approve-once-123'};
 let r=await call('/workspaces/'+id+'/command',request,alice,key);assert.equal(r.status,200);const first=r.data;
 r=await call('/workspaces/'+id+'/command',request,alice,key);assert.deepEqual(r.data,first);
 assert.equal((await call('/workspaces/'+id+'/command',{...request,command:{type:'cycle'}},alice,key)).status,409);
 assert.equal((await call('/workspaces/'+id+'/command',request,alice,{'Idempotency-Key':'stale-version-123'})).status,409);
 const invite=await call('/workspaces/'+id+'/invites',{email:'bob@example.test',role:'viewer'},alice);assert.equal(invite.status,201);
 assert.equal((await call('/invites/accept',{token:invite.data.token},alice)).status,403);
 assert.equal((await call('/invites/accept',{token:invite.data.token},bob)).status,200);
 assert.equal((await call('/invites/accept',{token:invite.data.token},bob)).status,403);
 assert.equal((await call('/workspaces/'+id,null,bob)).status,200);
 assert.equal((await call('/workspaces/'+id+'/command',{version:first.state.version,command:{type:'cycle'}},bob,{'Idempotency-Key':'viewer-write-123'})).status,403);
 const members=(await call('/workspaces/'+id+'/members',null,alice)).data.members,bobMember=members.find(m=>m.email==='bob@example.test');
 assert.equal((await call('/workspaces/'+id+'/members',{user:bobMember.id,role:'operator'},alice)).status,200);
 s=(await call('/workspaces/'+id,null,bob)).data.state;
 assert.equal((await call('/workspaces/'+id+'/command',{version:s.version,command:{type:'decision.approve',id:s.decisions[1].id}},bob,{'Idempotency-Key':'operator-approve'})).status,400);
 assert.equal((await fetch(base+'/server.mjs')).status,404);assert.equal((await fetch(base+'/data/operon.sqlite')).status,404);
 const beforeRestart=(await call('/workspaces/'+id,null,alice)).data.state;await stop();await start();assert.deepEqual((await call('/workspaces/'+id,null,alice)).data.state,beforeRestart);
 const login2=await call('/login',{email:'alice@example.test',password:'Correct-Horse-Test-123'});assert.equal(login2.status,200);const alice2={cookie:login2.cookie,csrf:login2.data.csrf};
 const sessions=(await call('/sessions',null,alice)).data.sessions;assert.equal(sessions.length,2);assert(sessions.every(x=>!x.token));const other=sessions.find(x=>!x.current);assert.equal((await call('/sessions/revoke',{id:other.id},bob)).status,404);assert.equal((await call('/sessions/revoke',{id:other.id},alice)).status,200);assert.equal((await call('/me',null,alice2)).status,401);
 assert.equal((await call('/workspaces/'+id+'/admin',null,bob)).status,403);const inv2=await call('/workspaces/'+id+'/invites',{email:'new@example.test',role:'operator'},alice);assert.equal(inv2.status,201);const admin=(await call('/workspaces/'+id+'/admin',null,alice)).data;assert.equal(admin.invites.length,1);assert.equal((await call('/workspaces/'+id+'/invite-revoke',{id:admin.invites[0].id},alice)).status,200);assert.equal((await call('/workspaces/'+id+'/admin',null,alice)).data.invites.length,0);
 const latest=(await call('/workspaces/'+id,null,alice)).data.state;assert(latest.audit.some(x=>x.action==='Membership role changed'));assert(latest.audit.some(x=>x.action==='Invitation revoked'));
 assert.equal((await call('/logout',{},alice)).status,200);assert.equal((await call('/me',null,alice)).status,401);
});
