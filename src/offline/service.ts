import { LocalRepository } from './repository.mjs';
import { localStorageAdapter, requestPersistence } from './storage';
import { request } from '../api';
import seed from '../../shared/foods.seed.json';
import type { Connection } from '../types';
export type Repository=InstanceType<typeof LocalRepository>;
const instances=new Map<string,Repository>();
export function openRepository(connection:Connection):Repository{
  if(!connection.serverId||!connection.token)throw new Error('请先连接或登录一次，再使用离线日记。');
  const origin=new URL(connection.base||location.origin,location.origin).origin;
  const partition=origin+'|'+connection.serverId;
  const existing=instances.get(partition);
  if(existing&&!existing.closed){existing.remote=(route:string,options:any)=>request(connection,route,options);return existing;}
  const repo=new LocalRepository({storage:localStorageAdapter,partition,remote:(route:string,options:any)=>request(connection,route,options),seed});
  instances.set(partition,repo);
  const wake=()=>{if(repo.hasSyncWork())repo.schedule(20);};
  window.addEventListener('online',wake);
  const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('xiaoka-local'):null;
  const save=repo.storage.save.bind(repo.storage);
  repo.storage={...repo.storage,save:async(key:string,value:any)=>{await save(key,value);channel?.postMessage({partition});}};
  if(channel)channel.onmessage=event=>{if(event.data?.partition===partition)repo.gate=repo.gate.then(async()=>{const state=await repo.storage.load(partition);if(state){repo.state=state;repo.emit();}}).catch(error=>{repo.error=error.message;repo.emit();});};
  const close=repo.close.bind(repo);repo.close=()=>{close();channel?.close();window.removeEventListener('online',wake);instances.delete(partition);};
  repo.ready.then(async()=>{
    if(!(repo.state.meta as any).legacyImported){
      const snapshots=Object.keys(localStorage).filter(key=>key.startsWith(`xiaoka.snapshot.${connection.serverId}.`));
      await repo.commit((s:any)=>{for(const key of snapshots){try{const value=JSON.parse(localStorage.getItem(key)||'null');for(const entry of value?.entries||[]){const id='entry:'+entry.id;if(!s.records[id])s.records[id]={type:'entry',id:entry.id,data:entry,version:0,deleted:false};}if(value?.profile&&!s.records['profile:profile'])s.records['profile:profile']={type:'profile',id:'profile',data:value.profile,version:0,deleted:false};}catch{/* Keep the old snapshot for recovery. */}}s.meta.legacyImported=true;});
    }
    await requestPersistence();if(!repo.state.initialized)repo.schedule(20);
  }).catch(error=>{repo.error=error.message;repo.emit();});
  return repo;
}
