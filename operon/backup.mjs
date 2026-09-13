import {DatabaseSync,backup} from 'node:sqlite';
import {join,resolve} from 'node:path';
import {mkdirSync,existsSync} from 'node:fs';
const source=join(process.env.OPERON_DATA_DIR||'data','operon.sqlite');
if(!existsSync(source))throw Error('Database does not exist: '+source);
const target=resolve(process.argv[2]||'backups/operon-'+new Date().toISOString().replaceAll(':','-')+'.sqlite');
mkdirSync(new URL('.', 'file://'+target).pathname,{recursive:true});
const db=new DatabaseSync(source,{readOnly:true});await backup(db,target);db.close();console.log('Consistent SQLite backup created: '+target);
