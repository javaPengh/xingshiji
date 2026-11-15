import {MotionProvider} from './Motion';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './page-layout.css';
import { hydrateConnection } from './api';
hydrateConnection().then(()=>createRoot(document.getElementById('root')!).render(<React.StrictMode><MotionProvider><App /></MotionProvider></React.StrictMode>)).catch(()=>{document.getElementById('root')!.textContent='本机安全存储暂时无法打开，请检查浏览器存储权限或重新打开应用。原有日记未被删除。';});
function shellState(message:string){localStorage.setItem('xiaoka.shell.status',message);window.dispatchEvent(new Event('xiaoka-shell'));}
if(import.meta.env.PROD){
  if('serviceWorker' in navigator&&(location.protocol==='https:'||['localhost','127.0.0.1'].includes(location.hostname))){
    shellState('正在准备离线页面资源');
    navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready).then(()=>shellState('离线页面资源已就绪')).catch(()=>shellState('当前浏览器无法缓存离线页面，请使用 Safari 添加到主屏幕后再验证离线启动'));
  }else shellState('当前浏览器不支持离线页面资源；安装版使用随包资源');
}
