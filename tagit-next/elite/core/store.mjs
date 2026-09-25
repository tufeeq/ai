import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
export const hash=value=>createHash('sha256').update(typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value)).digest('hex');
export function openStore(path=':memory:') {
  const db=new DatabaseSync(path);db.exec(readFileSync(new URL('../migrations/001.sql',import.meta.url),'utf8'));
  return {db,path,
    transaction(fn){db.exec('BEGIN IMMEDIATE');try{const x=fn();db.exec('COMMIT');return x;}catch(e){db.exec('ROLLBACK');throw e;}},
    run(id,config,sourceHash='unrecorded'){db.prepare('INSERT OR IGNORE INTO runs VALUES(?,?,?,?,?)').run(id,new Date().toISOString(),JSON.stringify(config),config.mode,sourceHash);const row=db.prepare('SELECT config,source_hash FROM runs WHERE id=?').get(id);if(row.config!==JSON.stringify(config)||row.source_hash!==sourceHash)throw Error('RUN_CONFIG_CONFLICT');},
    input(run,event){const b=event.bar;const identity=b?[event.kind,b.symbol,b.feed,b.t,b.o,b.h,b.l,b.c,b.v,b.n,b.vw]:event;const id=hash([run,identity]);return Boolean(db.prepare('INSERT OR IGNORE INTO inputs VALUES(?,?,?,?,?,?,?,?)').run(id,run,event.kind,event.symbol??null,event.event_at,event.received_at,JSON.stringify(event),event.revision_of??null).changes);},
    first(o,run){db.prepare('INSERT OR IGNORE INTO opportunities VALUES(?,?,?,?,?,?,?,?)').run(o.id,run,o.symbol,o.session,o.first_at,o.first_price,o.methodology,JSON.stringify(o));},
    event(o,event){const id=hash([o.id,event]);db.prepare('INSERT OR IGNORE INTO transitions VALUES(?,?,?,?,?)').run(id,o.id,event.at,event.kind,JSON.stringify(event));},
    checkpoint(run,key,value){db.prepare('INSERT INTO checkpoints VALUES(?,?,?) ON CONFLICT(run_id,symbol_session) DO UPDATE SET payload=excluded.payload').run(run,key,JSON.stringify(value));},
    restore(run,key){const r=db.prepare('SELECT payload FROM checkpoints WHERE run_id=? AND symbol_session=?').get(run,key);return r?JSON.parse(r.payload):null;},
    timeline(id){return db.prepare('SELECT payload FROM transitions WHERE opportunity_id=? ORDER BY at,rowid').all(id).map(r=>JSON.parse(r.payload));},
    snapshots(run){return db.prepare('SELECT payload FROM checkpoints WHERE run_id=?').all(run).map(r=>JSON.parse(r.payload)).filter(x=>x.opportunity).map(x=>x.opportunity);},
    summary(){const count=t=>db.prepare('SELECT count(*) n FROM '+t).get().n;return {inputs:count('inputs'),opportunities:count('opportunities'),transitions:count('transitions'),storage:path===':memory:'?'SQLITE_MEMORY':'SQLITE_FILE',durabilityVerified:false};},
    registerExperiment(id,config,dataHash,partition){db.prepare('INSERT OR IGNORE INTO experiments VALUES(?,?,?,?,?,NULL)').run(id,new Date().toISOString(),JSON.stringify(config),dataHash,partition);const r=db.prepare('SELECT * FROM experiments WHERE id=?').get(id);if(r.config!==JSON.stringify(config)||r.data_hash!==dataHash||r.partition!==partition)throw Error('EXPERIMENT_ID_CONFLICT');},
    experimentResult(id,result){db.prepare('UPDATE experiments SET result=? WHERE id=? AND result IS NULL').run(JSON.stringify(result),id);},
    job(id,kind,cursor,status,error=null){db.prepare('INSERT INTO jobs VALUES(?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET cursor=excluded.cursor,status=excluded.status,attempts=jobs.attempts+1,updated_at=excluded.updated_at,error_code=excluded.error_code').run(id,kind,cursor,status,new Date().toISOString(),error);},
    close(){db.close();}
  };
}
