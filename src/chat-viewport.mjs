// Keep chat inside the visible viewport. Only its message list scrolls.
export function installChatViewport(win,doc,onResize=()=>{}){
 const viewport=win.visualViewport,root=doc.documentElement;
 let width=viewport?.width||win.innerWidth,baseline=Math.max(win.innerHeight,viewport?.height||0),keyboardOpen=false;
 const update=()=>{
  const nextWidth=viewport?.width||win.innerWidth,height=viewport?.height||win.innerHeight;
  if(viewport?.scale&&Math.abs(viewport.scale-1)>.05)return;
  if(Math.abs(nextWidth-width)>30){baseline=Math.max(win.innerHeight,height);width=nextWidth;}
  else baseline=Math.max(baseline,win.innerHeight,height);
  const focused=doc.activeElement,editing=focused?.matches?.('textarea,input,[contenteditable="true"]');
  keyboardOpen=baseline-height>120&&(!!editing||keyboardOpen);
  doc.body.classList.toggle('chat-keyboard-open',keyboardOpen);
  root.style.setProperty('--chat-viewport-height',height+'px');
  root.style.setProperty('--chat-viewport-top',(viewport?.offsetTop||0)+'px');
  onResize();
 };
 root.classList.add('chat-viewport');doc.body.classList.add('chat-viewport');
 for(const event of ['resize','scroll'])viewport?.addEventListener(event,update);
 win.addEventListener('resize',update);doc.addEventListener('focusin',update);doc.addEventListener('focusout',update);
 update();
 return()=>{
  for(const event of ['resize','scroll'])viewport?.removeEventListener(event,update);
  win.removeEventListener('resize',update);doc.removeEventListener('focusin',update);doc.removeEventListener('focusout',update);
  root.classList.remove('chat-viewport');doc.body.classList.remove('chat-viewport','chat-keyboard-open');
  root.style.removeProperty('--chat-viewport-height');root.style.removeProperty('--chat-viewport-top');
 };
}
