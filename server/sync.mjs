import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import {nutritionRecordTypes,supportsNutrition,nutritionCapabilities} from '../shared/nutrition.mjs';
import {nutritionTables} from './nutrition-migration.mjs';

const mappings = [
  ['exercise','exercises','id'],['entry','entries','id'],['food','foods','id'],['message','messages','id'],
  ['profile','profile',"'profile'"],['measurement','measurements','date'],
  ['plan','target_plans','startDate'],['dayTarget','daily_targets','date'],
  ...Object.entries(nutritionTables).map(([type,[table,key]])=>[type,table,key]),
];
const operationSchema=z.object({opId:z.string().uuid(),deviceId:z.string().uuid(),type:z.enum(mappings.map(row=>row[0])),id:z.string().min(1).max(100),baseVersion:z.number().int().min(0),deleted:z.boolean().default(false),data:z.unknown().nullable().default(null)});
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const bad=(text,status=400)=>Object.assign(new Error(text),{status});

// All legacy writes are journaled by triggers in the SAME SQLite transaction.
// The durable journal is also the upgrade path for pre-sync clients and AI results.
export function createJournal(db,{validate,write,remove,guard=()=>{}}) {
  db.exec(`CREATE TABLE IF NOT EXISTS sync_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_entities(type TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT,deleted INTEGER NOT NULL,PRIMARY KEY(type,id));
    CREATE TABLE IF NOT EXISTS sync_changes(seq INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT,deleted INTEGER NOT NULL,changedAt TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS sync_receipts(opId TEXT PRIMARY KEY,digest TEXT NOT NULL,result TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_conflicts(id TEXT PRIMARY KEY,data TEXT NOT NULL,resolved INTEGER NOT NULL DEFAULT 0);`);
  if(!db.prepare("SELECT value FROM sync_meta WHERE key='epoch'").get())db.prepare('INSERT INTO sync_meta VALUES(?,?)').run('epoch',randomUUID());
  const encode=row=>row?{type:row.type,id:row.id,version:Number(row.version),data:row.data===null?null:JSON.parse(row.data),deleted:!!row.deleted}:null;
  const entity=(type,id)=>encode(db.prepare('SELECT * FROM sync_entities WHERE type=? AND id=?').get(type,id));
  function publish(type,id,data,deleted=false){
    db.prepare('INSERT INTO sync_entities VALUES(?,?,1,?,?) ON CONFLICT(type,id) DO UPDATE SET version=version+1,data=excluded.data,deleted=excluded.deleted').run(type,id,deleted?null:JSON.stringify(data),Number(deleted));
    db.prepare('INSERT INTO sync_changes(type,id,version,data,deleted) SELECT type,id,version,data,deleted FROM sync_entities WHERE type=? AND id=?').run(type,id);
    return entity(type,id);
  }
  const isNew=!db.prepare("SELECT value FROM sync_meta WHERE key='migrated'").get();
  db.exec('BEGIN IMMEDIATE');
  try {
    for(const [type,table,key] of mappings){
      const newKey=key.startsWith("'")?key:'NEW.'+key;
      const oldKey=key.startsWith("'")?key:'OLD.'+key;
      if(isNew){
        const rows=db.prepare(`SELECT ${key} AS entityId,data FROM ${table}`).all();
        for(const row of rows)publish(type,String(row.entityId),JSON.parse(row.data));
      }
      for(const action of ['INSERT','UPDATE'])db.exec(`CREATE TRIGGER IF NOT EXISTS sync_${table}_${action.toLowerCase()} AFTER ${action} ON ${table} BEGIN
        INSERT INTO sync_entities(type,id,version,data,deleted) VALUES('${type}',${newKey},1,NEW.data,0) ON CONFLICT(type,id) DO UPDATE SET version=version+1,data=excluded.data,deleted=0;
        INSERT INTO sync_changes(type,id,version,data,deleted) SELECT type,id,version,data,deleted FROM sync_entities WHERE type='${type}' AND id=${newKey};
      END;`);
      db.exec(`CREATE TRIGGER IF NOT EXISTS sync_${table}_delete AFTER DELETE ON ${table} BEGIN
        INSERT INTO sync_entities(type,id,version,data,deleted) VALUES('${type}',${oldKey},1,NULL,1) ON CONFLICT(type,id) DO UPDATE SET version=version+1,data=NULL,deleted=1;
        INSERT INTO sync_changes(type,id,version,data,deleted) SELECT type,id,version,data,deleted FROM sync_entities WHERE type='${type}' AND id=${oldKey};
      END;`);
    }
    db.prepare('INSERT OR IGNORE INTO sync_meta VALUES(?,?)').run('migrated','1');
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  const epoch=()=>db.prepare("SELECT value FROM sync_meta WHERE key='epoch'").get().value;
  const cursor=()=>Number(db.prepare('SELECT COALESCE(MAX(seq),0) AS value FROM sync_changes').get().value);
  return {
    entity,epoch,cursor,
    bootstrap({after=null,limit=300,allChat=false,chatSince=new Date(Date.now()-90*86400000).toISOString(),clientCapabilities=null}={}){
      const where=(clientCapabilities?.exerciseRecords?'':"type!='exercise' AND ")+"(type!='message' OR deleted=1 OR ?=1 OR json_extract(data,'$.pinned')=1 OR json_extract(data,'$.createdAt')>=?)"+(supportsNutrition(clientCapabilities)?'':" AND type NOT IN ('nutritionAssessment','nutritionReview','nutritionInput','diaryCoverage') AND (data IS NULL OR json_extract(data,'$.contractVersion') IS NULL)");
      const [type='',id='']=String(after||'').split('\u001f');
      const rows=db.prepare(`SELECT * FROM sync_entities WHERE ${where} AND (type>? OR (type=? AND id>?)) ORDER BY type,id LIMIT ?`).all(Number(allChat),chatSince,type,type,id,Math.min(500,limit));
      return {epoch:epoch(),cursor:cursor(),records:rows.map(encode),next:rows.length===Math.min(500,limit)?rows.at(-1).type+'\u001f'+rows.at(-1).id:null};
    },
    pull(after=0,limit=300,clientCapabilities=null){
      if(!Number.isSafeInteger(after)||after<0)throw bad('同步游标不正确');
      const rows=db.prepare('SELECT * FROM sync_changes WHERE seq>? ORDER BY seq LIMIT ?').all(after,Math.min(500,limit));
      return {epoch:epoch(),records:rows.filter(row=>(row.type!=='exercise'||clientCapabilities?.exerciseRecords)&&(supportsNutrition(clientCapabilities)||!nutritionRecordTypes.includes(row.type)&&(!row.data||!JSON.parse(row.data).contractVersion))).map(row=>({...encode(row),seq:Number(row.seq)})),cursor:rows.length?Number(rows.at(-1).seq):after,more:rows.length===Math.min(500,limit)};
    },
    push(input){
      if(input.epoch&&input.epoch!==epoch())throw bad('服务器同步标识改变，请先导出本机备份，再重新核对服务器。',409);
      const {operations}=z.object({operations:z.array(operationSchema).min(1).max(100)}).parse(input);
      const results=[];let activeOperationId=null;
      db.exec('BEGIN IMMEDIATE');
      try{
        for(const raw of operations){
          activeOperationId=raw.opId;
          if(raw.deleted)validate(raw.type,raw.id,null,true);
          if(JSON.stringify(raw).length>(nutritionRecordTypes.includes(raw.type)?4000000:180000))throw bad('单条记录过大');
          const parsed=raw.deleted?null:validate(raw.type,raw.id,raw.data);
          const digest=hash(raw);const receipt=db.prepare('SELECT * FROM sync_receipts WHERE opId=?').get(raw.opId);
          if(receipt){if(receipt.digest!==digest)throw bad('操作标识已用于不同内容',409);results.push(JSON.parse(receipt.result));continue;}
          guard(raw.type,raw.id,parsed,raw.deleted,input.clientCapabilities);
          if(raw.type==='plan'&&!raw.deleted)guard('dayTarget',raw.id,null,true,input.clientCapabilities);
          const current=entity(raw.type,raw.id);
          let result;
          if((current?.version||0)!==raw.baseVersion){
            const conflict={id:randomUUID(),operation:raw,server:current,createdAt:new Date().toISOString()};
            db.prepare('INSERT INTO sync_conflicts(id,data) VALUES(?,?)').run(conflict.id,JSON.stringify(conflict));
            result={opId:raw.opId,status:'conflict',conflict};
          }else{
            if(raw.deleted){remove(raw.type,raw.id);if((entity(raw.type,raw.id)?.version||0)===(current?.version||0))publish(raw.type,raw.id,null,true);}
            else { write(raw.type,raw.id,parsed); }
            result={opId:raw.opId,status:'applied',record:entity(raw.type,raw.id)};
          }
          db.prepare('INSERT INTO sync_receipts VALUES(?,?,?)').run(raw.opId,digest,JSON.stringify(result));results.push(result);
        }
        db.exec('COMMIT');
        return {epoch:epoch(),results,cursor:cursor()};
      }catch(error){db.exec('ROLLBACK');if(activeOperationId)error.operationId=activeOperationId;throw error;}
    },
    histories(after=0,clientCapabilities=null){const rows=db.prepare("SELECT * FROM sync_changes WHERE seq>? AND type IN ('profile','plan','dayTarget','nutritionAssessment','nutritionReview','nutritionInput','diaryCoverage','measurement') ORDER BY seq LIMIT 300").all(after);return {rows:rows.filter(row=>supportsNutrition(clientCapabilities)||!nutritionRecordTypes.includes(row.type)&&(!row.data||!JSON.parse(row.data).contractVersion)).map(row=>({...encode(row),seq:Number(row.seq),changedAt:row.changedAt})),next:rows.length===300?Number(rows.at(-1).seq):null};},
    archivedHistories(after=0){if(!Number.isSafeInteger(after)||after<0)throw bad('历史游标不正确');const rows=db.prepare('SELECT rowid,id,data FROM nutrition_history_archive WHERE rowid>? ORDER BY rowid LIMIT 300').all(after);return {rows:rows.map(row=>({...JSON.parse(row.data),archiveId:row.id})),cursor:rows.length?Number(rows.at(-1).rowid):after,more:rows.length===300};},
    history(type,id){return [...db.prepare('SELECT * FROM sync_changes WHERE type=? AND id=? ORDER BY seq DESC LIMIT 100').all(type,id).map(row=>({...encode(row),changedAt:row.changedAt})),...db.prepare("SELECT data FROM nutrition_history_archive WHERE json_extract(data,'$.type')=? AND json_extract(data,'$.id')=? ORDER BY rowid DESC LIMIT 100").all(type,id).map(row=>JSON.parse(row.data))];},
    messages(before='9999',limit=50,beforeId='\uffff'){return db.prepare("SELECT * FROM sync_entities WHERE type='message' AND deleted=0 AND (json_extract(data,'$.createdAt')<? OR (json_extract(data,'$.createdAt')=? AND id<?)) ORDER BY json_extract(data,'$.createdAt') DESC,id DESC LIMIT ?").all(before,before,beforeId,Math.min(100,limit)).map(encode).reverse();},
    restore(records){
      // Administrative restore publishes NEW revisions; clients never rewind cursors.
      db.exec('BEGIN IMMEDIATE');try{for(const row of records){const valid=validate(row.type,row.id,row.data,!!row.deleted);guard(row.type,row.id,valid,!!row.deleted,nutritionCapabilities,{restoring:true});if(row.deleted){const before=entity(row.type,row.id);remove(row.type,row.id);if(entity(row.type,row.id)?.version===before?.version)publish(row.type,row.id,null,true);}else write(row.type,row.id,valid);}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    },
  };
}
