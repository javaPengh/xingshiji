import {buildClient,run} from './build-client.mjs';
if(process.platform!=='win32')throw new Error('Windows 运行包需要 Windows 版 Node.js');
// Ignore native build variables: the bundled PWA must call this server's origin.
const env={...process.env,XINGSHIJI_WEB_DIR:'dist',VITE_API_BASE_URL:'',VITE_AUTH_MODE:'accounts'};
buildClient(env);
run('scripts/build-windows-runtime.mjs',[],env);
