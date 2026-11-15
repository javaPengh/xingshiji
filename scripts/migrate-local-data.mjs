import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../server/store.mjs';
const root=path.resolve(import.meta.dirname,'..');
const directory=path.resolve(root,process.env.DATA_DIR||'data');
const username=process.argv[2]?.toLowerCase();
if(!username)throw new Error('Usage: node --env-file=.env scripts/migrate-local-data.mjs USERNAME. Stop the diary server before migration.');
const accounts=new DatabaseSync(path.join(directory,'accounts.sqlite'),{readOnly:true});
const user=accounts.prepare('SELECT id FROM users WHERE username=?').get(username);accounts.close();
if(!user || !/^[0-9a-f-]{36}$/.test(user.id))throw new Error('Register the destination account first.');
const original=createStore(directory);const target=createStore(path.join(directory,'users',user.id));
try{const result=target.importBackup(original.exportBackup());console.log(`Merged ${result.added} diary entries into ${username}. Original data preserved.`);}finally{original.close();target.close();}
