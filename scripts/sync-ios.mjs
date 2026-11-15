import {buildClient,run} from './build-client.mjs';
// Native builds have their own assets; they never overwrite the server's PWA.
const env={...process.env,XINGSHIJI_WEB_DIR:'build/web-ios',VITE_AUTH_MODE:'accounts'};
env.VITE_API_BASE_URL ||= 'https://desktop-7nla9nf.taila5d3f3.ts.net';
const address=new URL(env.VITE_API_BASE_URL);
if(address.protocol!=='https:'||address.username||address.password)throw new Error('iOS 构建需要不含凭据的可信 HTTPS 服务地址');
buildClient(env);
run('node_modules/@capacitor/cli/bin/capacitor',['sync','ios'],env);
run('scripts/prepare-ios.mjs',[],env);
