const CACHE='xiaoka-shell-dev';
const SHELL=['/'];
self.addEventListener('install',event=>event.waitUntil((async()=>{await (await caches.open(CACHE)).addAll(SHELL.map(url=>new Request(url,{cache:'reload'})));await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const owned=(await caches.keys()).filter(key=>key.startsWith('xiaoka-shell-'));
  const previous=owned.filter(key=>key!==CACHE).at(-1);
  for(const key of owned)if(key!==CACHE&&key!==previous)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const cached=await cache.match(event.request.mode==='navigate'?'/':event.request);
    if(cached)return cached;
    // Retain the previous shell's chunks while an already open page finishes updating.
    for(const key of (await caches.keys()).filter(key=>key.startsWith('xiaoka-shell-'))){const old=await (await caches.open(key)).match(event.request);if(old)return old;}
    return fetch(event.request);
  })());
});
