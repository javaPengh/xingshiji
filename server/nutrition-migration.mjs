import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

export const nutritionTables={nutritionAssessment:['nutrition_assessments','id'],nutritionReview:['nutrition_reviews','id'],nutritionInput:['nutrition_inputs','id'],diaryCoverage:['diary_coverage','date']};
export function migrateNutrition(db,directory,hadDatabase){
 const current=Number(db.prepare('PRAGMA user_version').get().user_version);if(current>2)throw new Error('数据库结构高于此版本，请使用较新的服务程序，未执行迁移。');
 db.function('xiaoka_storage_contract',()=>2);
 if(current>=2)return;
 if(hadDatabase){
  const folder=path.join(directory,'backups','schema-upgrades');fs.mkdirSync(folder,{recursive:true});const file=path.join(folder,'pre-nutrition-v2-'+Date.now()+'.sqlite');
  db.prepare('VACUUM INTO ?').run(file);const copy=new DatabaseSync(file,{readOnly:true});try{if(copy.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('升级前快照校验失败，未执行迁移');}finally{copy.close();}
  fs.writeFileSync(file+'.json',JSON.stringify({format:'xiaoka-schema-snapshot',from:current,to:2,createdAt:new Date().toISOString(),file:path.basename(file),sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')},null,2));
 }
 db.exec('BEGIN IMMEDIATE');try{
  for(const [table,key] of Object.values(nutritionTables))db.exec(`CREATE TABLE IF NOT EXISTS ${table}(${key} TEXT PRIMARY KEY,data TEXT NOT NULL);`);
  const tables=['entries','foods','messages','profile','measurements','target_plans','daily_targets','target_proposals','photos','photo_results','settings',...Object.values(nutritionTables).map(v=>v[0])];
  // Earlier executables cannot write this upgraded store: their SQLite connection
  // has no xiaoka_storage_contract function. Reads and pre-upgrade backups remain usable.
  for(const table of tables)for(const action of ['INSERT','UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS contract_v2_${table}_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT CASE WHEN xiaoka_storage_contract()!=2 THEN RAISE(ABORT,'此数据需要新版服务程序') END; END;`);
  db.exec("CREATE TRIGGER IF NOT EXISTS nutrition_input_immutable BEFORE UPDATE ON nutrition_inputs WHEN OLD.data!=NEW.data BEGIN SELECT RAISE(ABORT,'输入快照创建后不可修改'); END; PRAGMA user_version=2;");
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
