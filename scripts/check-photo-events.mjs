// Run from the actual server directory with its .env loaded. Read-only query.
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';

const args=process.argv.slice(2);
const value=flag=>{const i=args.indexOf(flag);return i<0?null:args[i+1];};
const directory=path.resolve(value('--data')||process.env.DATA_DIR||path.resolve(import.meta.dirname,'../data'));
const db=new DatabaseSync(path.join(directory,'diary.sqlite'),{readOnly:true});
try {
  const photo=value('--photo'),request=value('--request');
  const rows=photo?db.prepare('SELECT * FROM photo_events WHERE photoId=? OR requestId IN (SELECT requestId FROM photo_events WHERE photoId=?) ORDER BY seq DESC LIMIT 200').all(photo,photo)
    :request?db.prepare('SELECT * FROM photo_events WHERE requestId=? ORDER BY seq DESC LIMIT 200').all(request)
    :db.prepare('SELECT * FROM photo_events ORDER BY seq DESC LIMIT 200').all();
  for(const row of rows.reverse())console.log(JSON.stringify({...row,data:JSON.parse(row.data)}));
} finally {db.close();}
