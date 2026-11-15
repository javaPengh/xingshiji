import fs from 'node:fs';
import path from 'node:path';
const url=new URL(process.argv[2]);
if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash || url.pathname!=='/')throw new Error('Provide only the HTTPS origin printed by Funnel.');
const env=path.resolve(import.meta.dirname,'..','.env');
let content=fs.readFileSync(env,'utf8');
const line='PUBLIC_ORIGIN='+url.origin;
content=/^PUBLIC_ORIGIN=.*$/m.test(content)?content.replace(/^PUBLIC_ORIGIN=.*$/m,line):content+'\n'+line+'\n';
fs.writeFileSync(env,content);console.log('Public origin saved. Restart the diary server.');
