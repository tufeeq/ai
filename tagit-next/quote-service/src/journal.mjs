import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
// No credentials, headers or account/position data are recorded.
export function openJournal(path,{now=Date.now}={}){
 const db=new DatabaseSync(path);db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS scans(id TEXT PRIMARY KEY,at TEXT NOT NULL,feed TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS signals(id TEXT PRIMARY KEY,symbol TEXT NOT NULL,at TEXT NOT NULL,feed TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,received_at TEXT NOT NULL,kind TEXT NOT NULL,symbol TEXT,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS events_symbol ON events(symbol,sequence);
 CREATE INDEX IF NOT EXISTS events_time ON events(symbol,received_at);
 CREATE TABLE IF NOT EXISTS responses(sequence INTEGER PRIMARY KEY AUTOINCREMENT,url TEXT NOT NULL,requested_at TEXT NOT NULL,available_at TEXT NOT NULL,status INTEGER NOT NULL,sha256 TEXT NOT NULL,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS outcomes(id TEXT PRIMARY KEY,status TEXT NOT NULL,payload TEXT NOT NULL);
 `);
 const event=db.prepare('INSERT INTO events(received_at,kind,symbol,payload) VALUES(?,?,?,?)');
 return {
  db,
  recordEvent(kind,symbol,payload){return Number(event.run(new Date(now()).toISOString(),kind,symbol??null,JSON.stringify(payload)).lastInsertRowid);},
  recordScan(scan){db.exec('BEGIN');try{
   db.prepare('INSERT OR IGNORE INTO scans VALUES(?,?,?,?)').run(scan.server_time,scan.server_time,scan.feed,JSON.stringify(scan));
   const stmt=db.prepare('INSERT OR IGNORE INTO signals VALUES(?,?,?,?,?)');
   for(const a of scan.alerts??[]){const id=a.symbol+':'+a.detected_at;stmt.run(id,a.symbol,a.detected_at,scan.feed,JSON.stringify(a));}
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}},
  recordResponse({url,requested_at,available_at,status,body}){
   const u=new URL(url);if(!['data.alpaca.markets','paper-api.alpaca.markets','raw.githubusercontent.com'].includes(u.hostname)||u.username||u.password||[...u.searchParams.keys()].some(k=>/key|secret|token/i.test(k)&&k!=='page_token'))throw Error('UNSAFE_TRACE_URL');
   const text=JSON.stringify(body),sha=createHash('sha256').update(text).digest('hex');
   db.prepare('INSERT INTO responses(url,requested_at,available_at,status,sha256,body) VALUES(?,?,?,?,?,?)').run(url,requested_at,available_at,status,sha,text);
  },
  recordOutcome(id,result){db.prepare('INSERT INTO outcomes VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload').run(id,result.status,JSON.stringify(result));},
  summary(){const count=t=>db.prepare('SELECT count(*) n FROM '+t).get().n;
   return {as_of:new Date(now()).toISOString(),storage:path===':memory:'?'MEMORY':'SQLITE_FILE',
    scans:count('scans'),signals:count('signals'),market_events:count('events'),transport_responses:count('responses'),
    outcome_statuses:db.prepare('SELECT status,count(*) n FROM outcomes GROUP BY status').all(),
    evaluated:count('outcomes'),profitability_claim_allowed:false,source:'SERVER_OBSERVATION_JOURNAL'};},
  recentSignals(limit=100){return db.prepare('SELECT signals.id,signals.symbol,signals.at,signals.feed,signals.payload,outcomes.payload outcome FROM signals LEFT JOIN outcomes ON outcomes.id=signals.id ORDER BY at DESC LIMIT ?').all(Math.min(500,Math.max(1,limit))).map(r=>({...r,payload:JSON.parse(r.payload),outcome:r.outcome?JSON.parse(r.outcome):null}));},
  close(){db.close();}
 };
}

export function recordingFetch(journal,{fetcher=fetch,now=Date.now}={}){
 return async (url,options)=>{
  const requested_at=new Date(now()).toISOString();
  try{const r=await fetcher(url,options);const body=await r.json();
   journal.recordResponse({url,requested_at,available_at:new Date(now()).toISOString(),status:r.status,body});
   return {ok:r.ok,status:r.status,json:async()=>structuredClone(body)};
  }catch(e){journal.recordEvent('TRANSPORT_ERROR',null,{requested_at,code:'FETCH_OR_RECORD_FAILED'});throw e;}
 };
}
