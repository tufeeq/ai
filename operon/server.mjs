import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,scryptSync,timingSafeEqual,createHash,randomUUID} from 'node:crypto';
import {readFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {emptyState,seedState,apply,VERSION} from './core.mjs';
const root=dirname(fileURLToPath(import.meta.url)),dataDir=process.env.OPERON_DATA_DIR||join(root,'data');mkdirSync(dataDir,{recursive:true});
const db=new DatabaseSync(join(dataDir,'operon.sqlite'));db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL,state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS members(workspace TEXT REFERENCES workspaces(id),user TEXT REFERENCES users(id),role TEXT NOT NULL,PRIMARY KEY(workspace,user));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user TEXT REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS invites(token TEXT PRIMARY KEY,workspace TEXT REFERENCES workspaces(id),email TEXT NOT NULL,role TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS receipts(workspace TEXT, key TEXT, request TEXT, response TEXT, PRIMARY KEY(workspace,key));
CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY AUTOINCREMENT,workspace TEXT,started TEXT,status TEXT,error TEXT);
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied TEXT);
INSERT OR IGNORE INTO schema_migrations VALUES(1,datetime('now'));
`);
const sha=x=>createHash('sha256').update(x).digest('hex');
const hashPassword=p=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(p,salt,64).toString('hex');};
const passwordOK=(p,h)=>{const [salt,value]=h.split(':');return timingSafeEqual(scryptSync(p,salt,64),Buffer.from(value,'hex'));};
const check=(v,message,status=400)=>{if(!v)throw Object.assign(Error(message),{status});};
const json=(res,status,body,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(JSON.stringify(body));};
function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}
function issueSession(res,user,req){const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sha(token),user,csrf,Date.now()+7*86400000);const secure=process.env.OPERON_SECURE_COOKIES==='1';res.setHeader('Set-Cookie',`operon_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure?'; Secure':''}`);return csrf;}
function session(req){const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('operon_session='))?.slice(15);const row=raw&&db.prepare('SELECT s.*,u.name,u.email FROM sessions s JOIN users u ON s.user=u.id WHERE token=? AND expires>?').get(sha(raw),Date.now());check(row,'Sign in to continue',401);return row;}
function member(user,id){const m=db.prepare('SELECT role FROM members WHERE user=? AND workspace=?').get(user,id);check(m,'Workspace access denied',403);return m;}
function workspace(id){const row=db.prepare('SELECT state FROM workspaces WHERE id=?').get(id);check(row,'Workspace not found',404);return JSON.parse(row.state);}
function save(id,s){db.prepare('UPDATE workspaces SET state=?,name=? WHERE id=?').run(JSON.stringify(s),s.company.name,id);}
function list(user){return db.prepare('SELECT w.id,w.name,m.role FROM workspaces w JOIN members m ON w.id=m.workspace WHERE m.user=?').all(user);}
function createWorkspace(user,name,demo){const id=randomUUID(),s=demo?seedState():emptyState(name);if(name)s.company.name=name;db.prepare('INSERT INTO workspaces VALUES(?,?,?)').run(id,s.company.name,JSON.stringify(s));db.prepare('INSERT INTO members VALUES(?,?,?)').run(id,user,'owner');return id;}
const limits=new Map();function rate(req){const key=req.socket.remoteAddress,now=Date.now();let r=limits.get(key);if(!r||r.until<now){r={count:0,until:now+600000};limits.set(key,r);}check(++r.count<=30,'Too many attempts. Try again in ten minutes.',429);}
async function body(req){let chunks=[],length=0;for await(const chunk of req){length+=chunk.length;check(length<=2500000,'Request too large',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw Object.assign(Error('Invalid JSON'),{status:400});}}
const staticFiles={'/':'index.html','/index.html':'index.html','/app.mjs':'app.mjs','/core.mjs':'core.mjs','/styles.css':'styles.css','/favicon.svg':'favicon.svg'};
const types={html:'text/html; charset=utf-8',mjs:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
 try{
  const url=new URL(req.url,'http://localhost'),path=url.pathname;
  if(!path.startsWith('/api/')){const file=staticFiles[path];check(file,'Not found',404);check(req.method==='GET','Method not allowed',405);res.writeHead(200,{'Content-Type':types[file.split('.').pop()],'Cache-Control':'no-cache'});res.end(readFileSync(join(root,file)));return;}
  if(req.method==='GET'&&path==='/api/health'){json(res,200,{status:'ok',version:VERSION,persistence:'sqlite',billing:'not_connected',externalActions:'not_connected'});return;}
  if(req.method==='POST'){
   const origin=req.headers.origin;const expected=process.env.OPERON_ORIGIN||'http://'+req.headers.host;check(!origin||origin===expected,'Origin rejected',403);check(req.headers['content-type']?.startsWith('application/json'),'JSON required',415);
  }
  if(req.method==='POST'&&['/api/register','/api/login'].includes(path)){
   rate(req);const b=await body(req),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||'');check(email.length<255&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Valid email required');check(password.length>=12&&password.length<=256,'Use a password of 12–256 characters');let user;
   if(path==='/api/register'){check(process.env.OPERON_ALLOW_SIGNUP!=='0','Registration is closed',403);check(String(b.name||'').trim(),'Name required');check(!db.prepare('SELECT id FROM users WHERE email=?').get(email),'Account already exists',409);user=randomUUID();transaction(()=>{db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(user,email,String(b.name).trim().slice(0,120),hashPassword(password));createWorkspace(user,String(b.company||'My company').slice(0,120),false);});}
   else {const row=db.prepare('SELECT * FROM users WHERE email=?').get(email);check(row&&passwordOK(password,row.password),'Invalid email or password',401);user=row.id;}
   const csrf=issueSession(res,user,req);json(res,200,{csrf,workspaces:list(user)});return;
  }
  const sess=session(req);if(req.method==='POST')check(req.headers['x-csrf-token']===sess.csrf,'Refresh your session and retry',403);
  if(path==='/api/me'&&req.method==='GET'){json(res,200,{name:sess.name,email:sess.email,csrf:sess.csrf,workspaces:list(sess.user)});return;}
  if(path==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(sess.token);res.setHeader('Set-Cookie','operon_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');json(res,200,{ok:true});return;}
  if(path==='/api/password'&&req.method==='POST'){const b=await body(req),u=db.prepare('SELECT password FROM users WHERE id=?').get(sess.user);check(passwordOK(String(b.current||''),u.password),'Current password is incorrect',403);check(typeof b.password==='string'&&b.password.length>=12&&b.password.length<=256,'Use 12–256 characters');db.prepare('UPDATE users SET password=? WHERE id=?').run(hashPassword(b.password),sess.user);db.prepare('DELETE FROM sessions WHERE user=? AND token<>?').run(sess.user,sess.token);json(res,200,{ok:true});return;}
  if(path==='/api/workspaces'&&req.method==='POST'){const b=await body(req);check(String(b.name||'').trim(),'Workspace name required');const id=transaction(()=>createWorkspace(sess.user,String(b.name).trim().slice(0,120),b.demo===true));json(res,201,{id,workspaces:list(sess.user)});return;}
  if(path==='/api/invites/accept'&&req.method==='POST'){const b=await body(req);transaction(()=>{const i=db.prepare('SELECT * FROM invites WHERE token=? AND expires>?').get(sha(String(b.token)),Date.now());check(i&&i.email===sess.email,'Invite is invalid, expired, or for a different account',403);db.prepare('INSERT OR IGNORE INTO members VALUES(?,?,?)').run(i.workspace,sess.user,i.role);db.prepare('DELETE FROM invites WHERE token=?').run(i.token);});json(res,200,{workspaces:list(sess.user)});return;}
  const match=path.match(/^\/api\/workspaces\/([^/]+)(?:\/(command|members|invites|export))?$/);check(match,'Endpoint not found',404);const id=match[1],action=match[2],m=member(sess.user,id);
  if(req.method==='GET'&&!action){json(res,200,{state:workspace(id),role:m.role});return;}
  if(req.method==='GET'&&action==='export'){json(res,200,{format:'operon-backup-v1',exportedAt:new Date().toISOString(),state:workspace(id)});return;}
  if(req.method==='GET'&&action==='members'){json(res,200,{members:db.prepare('SELECT u.id,u.name,u.email,m.role FROM members m JOIN users u ON u.id=m.user WHERE m.workspace=?').all(id)});return;}
  if(req.method==='POST'&&action==='invites'){
   check(m.role==='owner','Only the owner can invite members',403);const b=await body(req),email=String(b.email||'').trim().toLowerCase();check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Valid email required');check(['manager','operator','viewer'].includes(b.role),'Invalid role');const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO invites VALUES(?,?,?,?,?)').run(sha(token),id,email,b.role,Date.now()+7*86400000);json(res,201,{token,expiresInDays:7,note:'Share this invitation token with the intended person. No email was sent.'});return;
  }
  if(req.method==='POST'&&action==='members'){
   check(m.role==='owner','Only the owner can change membership',403);const b=await body(req);check(b.user!==sess.user,'Owner cannot remove their own access');const target=member(b.user,id);check(target.role!=='owner','Owner membership cannot be changed');if(b.remove)db.prepare('DELETE FROM members WHERE workspace=? AND user=?').run(id,b.user);else{check(['manager','operator','viewer'].includes(b.role),'Invalid role');db.prepare('UPDATE members SET role=? WHERE workspace=? AND user=?').run(b.role,id,b.user);}json(res,200,{ok:true});return;
  }
  if(req.method==='POST'&&action==='command'){
   const b=await body(req),key=req.headers['idempotency-key'];check(typeof key==='string'&&key.length>=8&&key.length<=200,'Idempotency key required');check(m.role!=='viewer','Read-only workspace',403);const signature=sha(JSON.stringify(b));
   const response=transaction(()=>{
    const old=db.prepare('SELECT request,response FROM receipts WHERE workspace=? AND key=?').get(id,key);if(old){check(old.request===signature,'Idempotency key reused for a different request',409);return JSON.parse(old.response);}
    const state=workspace(id);check(b.version===state.version,'Workspace changed. Refresh and retry.',409);const output=apply(state,b.command,{role:m.role,name:sess.name});save(id,output.state);db.prepare('INSERT INTO receipts VALUES(?,?,?,?)').run(id,key,signature,JSON.stringify(output));return output;
   });json(res,200,response);return;
  }
  throw Object.assign(Error('Method not allowed'),{status:405});
 }catch(e){const status=e.status||400;if(status>=500)console.error(e);json(res,status,{error:status>=500?'Service error. Please retry.':e.message});}
});
const scheduler=setInterval(()=>{
 db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.prepare('DELETE FROM invites WHERE expires<?').run(Date.now());for(const [key,r] of limits)if(r.until<Date.now())limits.delete(key);
 for(const row of db.prepare('SELECT id,state FROM workspaces').all()){
  const s=JSON.parse(row.state);if(!s.company.automation||s.lastCycle&&Date.now()-Date.parse(s.lastCycle)<s.company.cycleMinutes*60000)continue;
  try{transaction(()=>{const output=apply(workspace(row.id),{type:'cycle'},{role:'owner',name:'Scheduled rules engine'});save(row.id,output.state);db.prepare('INSERT INTO jobs(workspace,started,status) VALUES(?,?,?)').run(row.id,new Date().toISOString(),'completed');});}catch(e){db.prepare('INSERT INTO jobs(workspace,started,status,error) VALUES(?,?,?,?)').run(row.id,new Date().toISOString(),'failed',e.message);}
 }
},30000);scheduler.unref();
const port=Number(process.env.PORT||3000);server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`OPERON ${VERSION} listening on ${port}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{clearInterval(scheduler);server.close(()=>{db.close();process.exit(0);});});
