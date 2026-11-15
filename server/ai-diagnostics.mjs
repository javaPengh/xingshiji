import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {logContext} from './logging.mjs';

const limited=(value,maximum)=>{const text=typeof value==='string'?value:'';return {text:text.slice(0,maximum),truncated:text.length>maximum,originalLength:text.length};};
// Failure-only logs, scoped to the same account directory as its diary. No prompts,
// request headers, credentials or uploaded image bytes are written here.
export function createAiDiagnostics(directory,{keep=20}={}){
  directory=path.resolve(directory);
  return {
    write({model,purpose,phase,error,response,rawResponse,httpStatus,context}){
      const id=randomUUID();
      const record={format:'xiaoka-ai-diagnostic',version:2,id,createdAt:new Date().toISOString(),...logContext(),
        model,purpose,phase,httpStatus:httpStatus||null,
        context:context||null,
        error:{name:error?.name||'Error',message:String(error?.message||error).slice(0,2000),
          issues:Array.isArray(error?.issues)?error.issues.slice(0,30).map(issue=>({path:issue.path.map(String).join('.'),code:issue.code,message:issue.message})):[]},
        content:limited(response?.message?.content,65536),thinking:limited(response?.message?.thinking,32768),
        finish:{done:response?.done??null,doneReason:response?.done_reason??null,promptTokens:response?.prompt_eval_count??null,outputTokens:response?.eval_count??null},
        rawResponse:limited(rawResponse,131072)};
      fs.mkdirSync(directory,{recursive:true});
      const file=path.join(directory,id+'.json');
      fs.writeFileSync(file,JSON.stringify(record,null,2),{encoding:'utf8',mode:0o600,flag:'wx'});
      const owned=fs.readdirSync(directory).filter(name=>/^[0-9a-f-]{36}\.json$/.test(name)).map(name=>({file:path.join(directory,name),name})).filter(row=>fs.lstatSync(row.file).isFile()).map(row=>({...row,time:fs.statSync(row.file).mtimeMs})).sort((a,b)=>b.time-a.time||(a.name===id+'.json'?-1:b.name===id+'.json'?1:a.name.localeCompare(b.name)));
      for(const old of owned.slice(Math.max(1,keep)))fs.unlinkSync(old.file);
      return {id,file};
    },
  };
}
