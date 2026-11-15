import {NutritionPlannerSheet} from './NutritionPlannerSheet';
import {MotionSettings} from './Motion';
import {StepTracker} from './StepTracker';

import {NutritionQuestions} from './NutritionQuestions';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Capacitor} from '@capacitor/core';
import {Camera as NativeCamera, CameraResultType, CameraSource} from '@capacitor/camera';
import {BookOpen, Camera, MessageCircle, Settings as SettingsIcon, Plus, ChevronRight, X, ArrowRight, Pencil, Trash2, Check, Download, Upload, Send, ImagePlus, CheckCircle2, WifiOff, LoaderCircle, ShieldCheck, Utensils, CircleHelp} from 'lucide-react';
import {loadConnection, saveConnection, request} from './api';
import {AuthScreen} from './Auth';
import {openRepository} from './offline/service';
import type {Repository} from './offline/service';
import {StoragePanel} from './offline/StoragePanel';
import {NutritionSheet, BodyProfileCard} from './BodyProfileSheet';
import type {AccountUser} from './Auth';
import {ProfileSummary, CalendarPicker, TargetSheet, BodyCards, NutritionCard} from './Health';
import {emptyMeasurement, blankNutrients, mealNames, nutrientLabels, scaleNutrients, today, uid} from './types';
import type {Connection, Draft, Entry, Food, Item, Meal, Message, Nutrients, Settings, Profile, DayData} from './types';

type Tab = 'diary' | 'camera' | 'chat' | 'settings';
const meals = Object.keys(mealNames) as Meal[];
const mealEmoji: Record<Meal, string> = { breakfast: '🌤️', lunch: '🍱', dinner: '🌙', snack: '🍓' };
const fmt = (number: number | null | undefined, digits = 1) => number === null || number === undefined ? '—' : Number(number.toFixed(digits)).toLocaleString('zh-CN');
const defaultMeal = (): Meal => new Date().getHours() < 10 ? 'breakfast' : new Date().getHours() < 16 ? 'lunch' : new Date().getHours() < 22 ? 'dinner' : 'snack';
const defaultSettings: Settings = { dailyGoal: null, chatModel: '', visionModel: '' };
const emptyItem = (): Item => ({ name: '', grams: 100, nutrients: blankNutrients(), source: 'manual', estimated: false, nutritionSource: '用户填写', photoId: null, note: '' });

export default function App() {
  const [authMode,setAuthMode]=useState<'pending'|'local'|'accounts'>(()=>{const mode=localStorage.getItem('xiaoka.authMode');return mode==='accounts'||mode==='local'?mode:'pending';});
  const [accountUser,setAccountUser]=useState<AccountUser|null>(null);
  const [tab, setTab] = useState<Tab>('diary');
  const [date, setDate] = useState(today());
  const selectedDate=useRef(date);selectedDate.current=date;
  const [connection, setConnection] = useState<Connection>(loadConnection);
  const [connected, setConnected] = useState(false);
  const [localReady,setLocalReady]=useState(false);
  const [syncState,setSyncState]=useState<any>({pending:0,conflicts:0});
  const repository=useRef<Repository|null>(null);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [foods, setFoods] = useState<Food[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [day, setDay] = useState<DayData>({ measurement: emptyMeasurement(date), history: [], target: null });
  const [targetOpen, setTargetOpen] = useState(false);
  const [plannerOpen,setPlannerOpen]=useState(false);
  const [nutritionOpen,setNutritionOpen]=useState(false);
  const [bodyPublicationDate,setBodyPublicationDate]=useState<string|null>(null);
  const [editor, setEditor] = useState<{ meal: Meal; item: Item; entry?: Entry; photoIndex?: number } | null>(null);
  const [toast, setToast] = useState('');
  const [photo, setPhoto] = useState('');
  const [photoId, setPhotoId] = useState('');
  const [photoItems, setPhotoItems] = useState<(Item & { selected: boolean })[]>([]);
  const [photoSummary, setPhotoSummary] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoSaving, setPhotoSaving] = useState(false);
  const [photoMeal, setPhotoMeal] = useState<Meal>(defaultMeal);
  const [chatText, setChatText] = useState('');
  const [chatMode,setChatMode]=useState<'chat'|'knowledge'>('chat');
  const [chatBusy, setChatBusy] = useState(false);
  const photoOperation = useRef(uid());
  const chatOperation = useRef(uid());
  const picker = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const refreshSequence = useRef(0);
  const activeToken=useRef(connection.token);activeToken.current=connection.token;
  const native = Capacitor.isNativePlatform();
  const photoUploading = photoBusy && !(repository.current?.state.photos as Record<string, { confirmed: boolean }> | undefined)?.[photoId]?.confirmed;
  const notify = (message: string) => setToast(message);
  const api = useCallback(async <T,>(route:string, options:RequestInit={})=>{
    const repo=repository.current;if(!repo)throw new Error('本机日记正在打开，请稍后重试。');
    const result=await repo.request(route,options);
    if(connection.token!==activeToken.current)throw new Error('账号已切换，请重新操作。');return result as T;
  },[connection.token]);
  function clearPrivateState(){setBodyPublicationDate(null);setNutritionOpen(false);setProfile(null);setEntries([]);setMessages([]);setFoods([]);setAccountUser(null);setDay({measurement:emptyMeasurement(date),history:[],target:null});setPhoto('');setPhotoId('');setPhotoItems([]);setPhotoSummary('');setChatText('');setEditor(null);setTargetOpen(false);setPlannerOpen(false);}

  function selectedDateRef(){return selectedDate.current;}
  async function refresh(_selectedConnection=connection,selectedDate=selectedDateRef()){
    const sequence=++refreshSequence.current;const repo=repository.current;
    if(!repo){setLoading(false);return;}
    try{
      await repo.ready;
      const [status,diary,catalog,history,daily]=await Promise.all([
        repo.request('status'),repo.request('entries?date='+selectedDate),repo.request('foods'),repo.request('messages'),repo.request('day?date='+selectedDate),
      ]) as any[];
      if(sequence!==refreshSequence.current||repo!==repository.current)return;
      setAccountUser(status.user||null);setProfile(status.profile);setDay(daily);setSettings(status.settings);setEntries(diary.entries);setFoods(catalog);setMessages(history);
      setLocalReady(true);
    }catch(error){notify((error as Error).message);}
    finally{if(sequence===refreshSequence.current)setLoading(false);}
  }
  useEffect(() => {
    let active=true;
    request<{mode:'local'|'accounts'}>(connection,'auth/config').then(async result=>{
      if(!active)return;setAuthMode(result.mode);localStorage.setItem('xiaoka.authMode',result.mode);
      if(result.mode==='local' && !connection.base && !native){
        const pair=await request<{token:string;serverId:string}>({base:'',token:''},'bootstrap');
        if(active){const next={base:'',token:pair.token,serverId:pair.serverId};await saveConnection(next);setConnection(next);}
      }
    }).catch(()=>{if(active){setAuthMode(localStorage.getItem('xiaoka.authMode')==='accounts'||import.meta.env.VITE_AUTH_MODE==='accounts'?'accounts':'local');setLoading(false);}});
    return ()=>{active=false;};
  },[connection.base]);
  useEffect(()=>{
    if(!connection.token||!connection.serverId){setLocalReady(false);setLoading(false);return;}
    const repo=openRepository(connection);repository.current=repo;setLoading(true);let active=true;let timer:ReturnType<typeof setTimeout>;
    const update=()=>{if(!active)return;setSyncState(repo.status());setConnected(repo.online);clearTimeout(timer);timer=setTimeout(()=>refresh(),30);};
    const unsubscribe=repo.subscribe(update);
    repo.ready.then(()=>{if(active){setLocalReady(true);refresh();update();}}).catch(error=>notify(error.message));
    return ()=>{active=false;unsubscribe();clearTimeout(timer);repo.close();if(repository.current===repo)repository.current=null;setLocalReady(false);};
  },[connection.base,connection.token,connection.serverId]);
  useEffect(()=>{refresh();},[date]);
  useEffect(()=>{if(tab!=='camera'||!localReady)return;let active=true;api<any>('photos/current').then(draft=>{if(active&&draft){setPhoto(draft.image);setPhotoId(draft.photoId);setPhotoItems(draft.items||[]);setPhotoSummary(draft.summary||'');setPhotoMeal(draft.meal||defaultMeal());if(draft.date)setDate(draft.date);}}).catch(error=>notify(error.message));return()=>{active=false;};},[tab,localReady]);
  useEffect(()=>{if(!photoId||!localReady)return;const timer=setTimeout(()=>api('photo-draft',{method:'POST',body:JSON.stringify({photoId,date,meal:photoMeal,items:photoItems,summary:photoSummary})}).catch(error=>notify(error.message)),250);return()=>clearTimeout(timer);},[photoId,photoMeal,photoItems,photoSummary,date,localReady]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => { if (tab === 'chat') chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, chatBusy, tab]);

  const totals = Object.fromEntries(Object.keys(blankNutrients()).map(key => {
    const values = entries.map(entry => entry.nutrients[key as keyof Nutrients]).filter(value => value !== null);
    return [key, values.length ? values.reduce((a, b) => a! + b!, 0) : entries.length ? null : 0];
  })) as Nutrients;
  const knownEnergy = entries.filter(entry => entry.nutrients.energyKcal !== null).length;
  const incompleteNutrition = entries.some(entry => Object.values(entry.nutrients).some(value => value === null));

  async function saveEditor(item: Item, selectedMeal: Meal, saveFood: boolean) {
    if (!editor) return;
    if (editor.photoIndex !== undefined) {
      const next=photoItems.map((value,index)=>index===editor.photoIndex?{...item,selected:value.selected}:value);await api('photo-draft',{method:'POST',body:JSON.stringify({photoId,date,meal:photoMeal,items:next,summary:photoSummary})});setPhotoItems(next);
      photoOperation.current = uid(); setEditor(null); return;
    }
    if (editor.entry) await api(`entries/${editor.entry.id}`, { method: 'PUT', body: JSON.stringify({ ...item, date: editor.entry.date, meal: selectedMeal }) });
    else await api('entries/batch', { method: 'POST', body: JSON.stringify({ date, meal: selectedMeal, items: [item], idempotencyKey: editorKey.current }) });
    setEditor(null); notify('已保存到饮食日记'); await refresh();
    if (saveFood) {
      try { await api('foods', { method: 'POST', body: JSON.stringify({ name: item.name, emoji: '🍽️', servingGrams: item.grams, nutrientsPer100g: scaleNutrients(item.nutrients, 100 / item.grams), source: item.nutritionSource }) }); await refresh(); }
      catch { notify('日记已保存，常用食物保存失败，可稍后重试'); }
    }
  }
  const editorKey = useRef(uid());
  function openEditor(meal = defaultMeal(), entry?: Entry) { editorKey.current = uid(); setEditor({ meal, item: entry || emptyItem(), entry }); }
  async function removeEntry(entry: Entry) {
    try { await api('entries/' + entry.id, { method: 'DELETE' }); await refresh(); notify('已删除记录，营养合计已更新'); return true; }
    catch (error) { notify((error as Error).message); return false; }
  }
  async function choosePhoto(file?: File) {
    if (!file) return;
    try {
      const url = URL.createObjectURL(file);
      try {
        const image = new Image(); image.src = url; await image.decode();
        const factor = Math.min(1, 1280 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * factor); canvas.height = Math.round(image.height * factor);
        canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
        const imageData=canvas.toDataURL('image/jpeg',.86);const small=document.createElement('canvas');small.width=160;small.height=Math.max(1,Math.round(canvas.height*160/canvas.width));small.getContext('2d')!.drawImage(canvas,0,0,small.width,small.height);const thumbnail=small.toDataURL('image/jpeg',.6);const saved=await api<{photoId:string}>('photos',{method:'POST',body:JSON.stringify({image:imageData,thumbnail,date,meal:photoMeal})});setPhoto(imageData);setPhotoId(saved.photoId);setPhotoItems([]);setPhotoSummary('已保存到手机，联网后可分析');photoOperation.current=uid();
      } finally { URL.revokeObjectURL(url); }
    } catch(error) { notify((error as Error).message||'这张照片暂时无法读取，请使用 JPG 或 PNG 照片。'); }
  }
  async function takePhoto() {
    if (!native) { picker.current?.click(); return; }
    try {
      const value = await NativeCamera.getPhoto({ quality: 85, resultType: CameraResultType.Uri, source: CameraSource.Prompt, promptLabelHeader: '添加餐食照片', promptLabelPhoto: '从相册选择', promptLabelPicture: '拍一张照片' });
      if (value.webPath) await choosePhoto(new File([await (await fetch(value.webPath)).blob()], 'meal.jpg', { type: 'image/jpeg' }));
    } catch (error) { if (!String(error).toLowerCase().includes('cancel')) notify('未取得照片，请检查相机和相册权限。'); }
  }
  async function recognize() {
    if (!photo || photoBusy) return;
    setPhotoBusy(true);
    try {
      const id = photoId || (await api<{ photoId: string }>('photos', { method: 'POST', body: JSON.stringify({ image: photo }) })).photoId;
      setPhotoId(id);
      const result = await api<Draft & { summary: string }>('ai/recognize', { method: 'POST', body: JSON.stringify({ photoId: id, date, meal: photoMeal }) });
      setPhotoItems(result.items.map(item => ({ ...item, selected: true }))); setPhotoSummary(result.summary); photoOperation.current = uid();
    } catch (error) { notify((error as Error).message); }
    finally { setPhotoBusy(false); }
  }
  async function savePhoto() {
    const selected = photoItems.filter(item => item.selected).map(({ selected: _selected, ...item }) => item);
    if (!selected.length || photoSaving) return;
    setPhotoSaving(true);
    try { await api('entries/batch', { method: 'POST', body: JSON.stringify({ date, meal: photoMeal, items: selected, idempotencyKey: photoOperation.current }) });
      await api('photo-draft/clear',{method:'POST',body:'{}'});setPhotoItems([]);setPhoto('');setPhotoId('');setTab('diary'); await refresh(); notify(`已记录 ${selected.length} 项食物`);
    } catch (error) { notify((error as Error).message); } finally { setPhotoSaving(false); }
  }
  async function sendChat() {
    if (!chatText.trim() || chatBusy) return;
    setChatBusy(true);
    try { await api('ai/chat', { method: 'POST', body: JSON.stringify({ text: chatText.trim(), date, meal: defaultMeal(), requestId: chatOperation.current }) });
      setChatText(''); chatOperation.current = uid(); await refresh();
    } catch (error) { notify((error as Error).message); } finally { setChatBusy(false); }
  }
  async function recordDraft(id: string) {
    try { await api('messages/' + id + '/confirm', { method: 'POST', body: '{}' }); await refresh(); notify('已保存，日记合计已更新'); }
    catch (error) { notify((error as Error).message); }
  }

  async function logout() {
    ++refreshSequence.current;
    try { await request(connection,'auth/logout',{method:'POST',body:'{}'}); }
    catch { notify('服务未连接，已退出本机登录。'); }
    repository.current?.close();repository.current=null;
    const next={base:connection.base,token:'',serverId:connection.serverId};await saveConnection(next);activeToken.current='';setConnection(next);clearPrivateState();setTab('diary');

  }
  return <div className="app-shell">
    <aside className="desktop-aside"><div className="wordmark"><span className="brand-mark"><Utensils size={25}/></span>行食记</div><p>每一餐，都有迹可循。</p><div className="aside-line"/><div className="aside-copy">你的饮食记录<br/>始终在一起。</div><p>iPhone 安装版 · 网页版<br/>共用同一本日记</p><div className="aside-bottom"><ShieldCheck size={17}/>{authMode==='accounts'?'每个账号独立保存':'数据保存在你的电脑'}</div></aside>
    <div className="phone-app">
      <header className="topbar"><div className="avatar"><Utensils size={21}/></div><div><span className="eyebrow">好好吃饭，慢慢记录</span><h1>{authMode==='accounts'&&!connection.token?'行食记':({ diary: '饮食日记', camera: '拍照记录', chat: 'AI 饮食搭子', settings: '我的设置' })[tab]}</h1></div>{tab !== 'diary' && <button className="icon-button header-settings" aria-label="打开设置" onClick={() => setTab('settings')}><SettingsIcon size={20}/></button>}</header>
      {!connected && !loading && !(authMode==='accounts'&&!connection.token) && <button className="offline-banner" onClick={() => setTab('settings')}><WifiOff size={15}/>{connection.token ? '离线可记录，联网后自动同步' : '连接电脑，开始你的第一条记录'}<ArrowRight size={14}/></button>}
      <main>
        {localReady&&<div className="sync-strip" role="status">{syncState.syncing?'正在同步…':syncState.pending?`已保存到本机 · ${syncState.pending} 项待同步`:connected?'已同步到服务器':'本机记录已就绪'}{syncState.conflicts>0&&<button onClick={()=>setTab('settings')}>{syncState.conflicts} 条冲突待选择</button>}{syncState.authRequired&&<button onClick={()=>setTab('settings')}>登录已过期，导出或重新登录</button>}</div>}
        {authMode==='accounts' && !connection.token ? <AuthScreen connection={connection} onLogin={async(config,user)=>{localStorage.setItem('xiaoka.authMode','accounts');setAuthMode('accounts');await saveConnection(config);setConnection(config);setAccountUser(user);notify('已登录自己的日记');}}/> : <>
        {tab !== 'settings' && !profile && <div className="page onboarding-page">{localReady ? <section className="settings-card"><h2>先认识一下你</h2><p>填写身体资料，让AI根据知识库制定计划，也可以先发布资料。</p><button className="primary-button full" onClick={()=>setTab('settings')}>前往设置</button></section> : <section className="settings-card"><h2>{loading?'正在读取身体资料…':'先连接电脑日记服务'}</h2><p className="hint">连接成功后，首次使用需要填写身体资料和身材管理目标。</p><button className="secondary-button full" onClick={()=>setTab('settings')}>前往连接设置</button></section>}</div>}
        {tab === 'diary' && profile && <div className="page diary-page">
          <CalendarPicker date={date} onDate={setDate} api={api} onBodyProfile={setBodyPublicationDate} revision={profile?.updatedAt||syncState.pending}/>
          <NutritionCard date={date} totals={totals} count={entries.length} unknownEnergy={entries.length-knownEnergy} incomplete={incompleteNutrition} target={day.target} connected={localReady} onTarget={()=>setTargetOpen(true)}/>
          <div className="section-heading"><h2>我的餐食</h2><span>{entries.length ? `共 ${entries.length} 项食物` : '记录每一份日常'}</span></div>
          <div className="meal-list">{meals.map(meal => { const records = entries.filter(entry => entry.meal === meal); const kcal = records.reduce((sum, item) => sum + (item.nutrients.energyKcal || 0), 0); return <section className="meal-card" key={meal}><div className="meal-heading"><span className="meal-emoji">{mealEmoji[meal]}</span><h3>{mealNames[meal]}</h3><span className="meal-kcal">{records.length ? `${records.some(item => item.nutrients.energyKcal !== null) ? fmt(kcal, 0) : '—'} kcal${records.some(item => item.nutrients.energyKcal === null) ? ' · 部分未知' : ''}` : '还没记录'}</span><button className="add-button" aria-label={'添加' + mealNames[meal]} disabled={!localReady} onClick={() => openEditor(meal)}><Plus size={18}/></button></div>{records.length ? records.map(entry => <button className="food-row" key={entry.id} onClick={() => openEditor(entry.meal, entry)}><EntryIcon entry={entry} api={api}/><div><strong>{entry.name}</strong><small>{fmt(entry.grams)} g{entry.estimated ? ' · 估算' : ''}</small></div><div className="food-energy"><strong>{fmt(entry.nutrients.energyKcal, 0)}</strong><small>kcal</small></div><ChevronRight size={14}/></button>) : <button className="meal-empty" disabled={!localReady} onClick={() => openEditor(meal)}>添加{mealNames[meal]}，留住这一餐 <Plus size={13}/></button>}</section>; })}</div>

          {profile && <BodyCards day={day} profile={profile}/>}
        </div>}
        {tab === 'camera' && profile && <div className="page camera-page">{repository.current&&<div className="pending-photo-list">{Object.values(repository.current.state.photos).filter((row:any)=>!row.confirmed||row.id===(repository.current?.state.draft as any)?.photoId).map((row:any)=><button key={row.id} onClick={async()=>{try{await api('photo-draft/select',{method:'POST',body:JSON.stringify({id:row.id,date,meal:photoMeal})});const draft=await api<any>('photos/current');setPhoto(draft.image);setPhotoId(draft.photoId);setPhotoItems(draft.items||[]);setPhotoSummary(draft.summary||'');setPhotoMeal(draft.meal);if(draft.date)setDate(draft.date);}catch(error){notify((error as Error).message);}}}>{row.confirmed?'当前照片':'待上传照片'} · {row.id.slice(0,4)}</button>)}</div>}<div className="page-intro"><h2>把这一餐，记下来</h2><p>拍照分析后，你可以选择食物并修正分量。</p></div><div className={'photo-stage ' + (photo ? 'has-photo' : '')}>{photo ? <img src={photo} alt="待分析的餐食"/> : <><div className="camera-art"><div className="frame-corner a"/><div className="frame-corner b"/><div className="frame-corner c"/><div className="frame-corner d"/><span>🥗</span></div><h3>今天吃了什么？</h3><p>让餐食完整入镜，清晰的照片更容易识别</p></>}{photoBusy && <div className="photo-loading"><LoaderCircle className="spin"/><strong>{photoUploading ? '正在上传照片' : '正在分析食物'}</strong><span>{photoUploading ? '上传完成后会开始识别，请保持页面打开' : '请稍候，暂时不要关闭页面'}</span></div>}</div><input ref={picker} className="hidden-input" type="file" accept="image/*" aria-label="选择餐食照片" onChange={e => { choosePhoto(e.target.files?.[0]); e.target.value = ''; }}/><div className="meal-segment">{meals.map(meal => <button key={meal} className={photoMeal === meal ? 'active' : ''} onClick={() => setPhotoMeal(meal)}>{mealNames[meal]}</button>)}</div><div className="photo-controls"><button className="secondary-button" disabled={photoBusy || photoSaving} onClick={takePhoto}><ImagePlus size={18}/>{photo ? '重新选择' : '拍照 / 选图'}</button><button className="primary-button" disabled={!photo || !connected || photoBusy} onClick={recognize}>{photoBusy ? <LoaderCircle size={18} className="spin"/> : <Camera size={18}/>} {photoBusy ? (photoUploading ? '正在上传' : '正在分析') : '开始分析'}</button></div>{!settings.visionModel && <div className="notice-card"><CircleHelp size={19}/><div><strong>先准备好图片模型</strong><p>照片识别需要电脑上的 Ollama 视觉模型。稍后可在设置中连接；现在可先使用手动日记。</p><button className="text-button" onClick={() => setTab('settings')}>前往连接设置 <ArrowRight size={14}/></button></div></div>}{photoSummary && <p className="photo-summary">{photoSummary}</p>}{photoItems.length > 0 && <><div className="section-heading"><h2>选择要记录的食物</h2><span>{photoItems.filter(item => item.selected).length} 项已选</span></div>{photoItems.map((item, index) => <div className="recognition-card" key={index}><button className={'check-button ' + (item.selected ? 'checked' : '')} aria-label={'选择' + item.name} onClick={() => { setPhotoItems(current => current.map((value, i) => i === index ? { ...value, selected: !value.selected } : value)); photoOperation.current = uid(); }}><Check size={15}/></button><div className="recognition-copy"><strong>{item.name}</strong><small>{fmt(item.grams)} g · {fmt(item.nutrients.energyKcal, 0)} kcal</small><MacroLine nutrients={item.nutrients}/></div><button className="icon-button" aria-label={'修改' + item.name} onClick={() => setEditor({ meal: photoMeal, item, photoIndex: index })}><Pencil size={17}/></button></div>)}<button className="primary-button full" disabled={!localReady || photoSaving || !photoItems.some(item => item.selected)} onClick={savePhoto}>{photoSaving ? <LoaderCircle className="spin" size={17}/> : <CheckCircle2 size={17}/>}将选中食物记入{mealNames[photoMeal]}</button></>}<p className="footnote">照片无法精确测出重量和隐藏配料。结果为估算，可在记录前修改。</p></div>}
        {tab==='chat'&&profile&&<div className="page nutrition-chat-switch"><button className={chatMode==='chat'?'active':''} aria-pressed={chatMode==='chat'} onClick={()=>setChatMode('chat')}>餐食与运动记录</button><button className={chatMode==='knowledge'?'active':''} aria-pressed={chatMode==='knowledge'} onClick={()=>setChatMode('knowledge')}>有据营养问答</button></div>}
        {tab==='chat'&&profile&&chatMode==='knowledge'&&<div className="page chat-page"><NutritionQuestions key={connection.base+accountUser?.id} api={api} date={date} onAssessment={()=>setTab('settings')}/></div>}
        {tab === 'chat' && profile && chatMode==='chat' && <div className="page chat-page"><div className="chat-context"><span><i className={settings.chatModel ? 'dot green' : 'dot'}/>{settings.chatModel ? '已配置 AI 模型' : 'AI 尚未配置'}</span><span>{date}</span></div><div className="chat-history"><button className="text-button" onClick={()=>repository.current?.olderMessages().then(()=>refresh()).catch(error=>notify(error.message))}>加载更早的聊天</button>{!messages.length && <div className="chat-welcome"><div className="ai-orb"><MessageCircle size={32}/></div><h2>吃了什么、做了什么运动，和我说说</h2><p>可以估算餐食或运动消耗；需要保存时请明确说“记录”。营养依据请切换“有据营养问答”。<br/>运动记录可在日记的运动卡片查看详情。</p><div className="suggestions">{['帮我记录：午饭吃了两个鸡蛋和200克米饭', '帮我记录今天跑步30分钟的运动消耗', '拍照记录的食物，应该怎样修正分量？'].map(text => <button key={text} onClick={() => { setChatText(text); chatOperation.current = uid(); }}>{text}<ArrowRight size={14}/></button>)}</div>{!settings.chatModel && <button className="secondary-button" onClick={() => setTab('settings')}>连接 Ollama 后开始聊天</button>}</div>}{messages.map(message => <div key={message.id} className={'message-group ' + message.role}><div className="message-avatar">{message.role === 'assistant' ? <Utensils size={17}/> : '我'}</div><div className="message-content"><div className="bubble">{message.text}</div><div className="message-tools">{message.sendState==='queued'&&<span>等待 AI 回复 · 已保存到本机</span>}{message.sendState==='error'&&<span>已取消发送</span>}<button onClick={()=>api('messages/'+message.id+'/pin',{method:'POST',body:'{}'}).then(()=>refresh()).catch(error=>notify(error.message))}>{message.pinned?'取消离线保留':'保留离线'}</button>{message.sendState==='queued'&&<button onClick={()=>api('messages/'+message.id+'/cancel',{method:'POST',body:'{}'}).then(()=>refresh()).catch(error=>notify(error.message))}>取消</button>}</div>{message.entryIds.length > 0 && <div className="chat-record-block"><div className="record-label"><CheckCircle2 size={14}/>{message.records?.length ? '已记入日记' : '相关记录已删除'}</div>{message.records?.map(entry => <div className="chat-record-card" key={entry.id}><span className="tiny-tag">{mealNames[entry.meal]} · {entry.date}</span><strong>{entry.name} <small>{fmt(entry.grams)} g</small></strong><div className="record-energy">{fmt(entry.nutrients.energyKcal, 0)} <small>kcal</small></div><MacroLine nutrients={entry.nutrients}/><div className="record-actions"><button onClick={() => openEditor(entry.meal, entry)}><Pencil size={13}/> 修改记录</button><button onClick={() => removeEntry(entry)}><Trash2 size={13}/> 删除记录</button></div></div>)}</div>}{message.draft && <div className="draft-preview"><span className="tiny-tag">待确认 · {mealNames[message.draft.meal]} · {message.draft.date}</span>{message.draft.items.map((item, index) => <div key={index}><strong>{item.name} · {fmt(item.grams)} g</strong><MacroLine nutrients={item.nutrients}/></div>)}<button className="draft-button" disabled={!localReady} onClick={() => recordDraft(message.id)}><Plus size={14}/>确认并记录 {message.draft.items.length} 项食物</button></div>}</div></div>)}{chatBusy && <div className="message-group assistant"><div className="message-avatar"><Utensils size={17}/></div><div className="bubble typing"><i/><i/><i/></div></div>}<div ref={chatEnd}/></div><div className="chat-composer"><textarea rows={1} disabled={chatBusy} aria-label="给AI发送消息" placeholder="告诉我餐食或运动内容…" value={chatText} onChange={e => { setChatText(e.target.value); chatOperation.current = uid(); }}/><button aria-label="发送消息" disabled={!localReady || chatBusy || !chatText.trim()} onClick={sendChat}>{chatBusy ? <LoaderCircle className="spin" size={19}/> : <Send size={19}/>}</button></div><p className="composer-note">热量为估算值 · 明确要求记录才会保存</p></div>}
        {tab === 'settings' && <div className="page settings-page">
          <section className="settings-card account-panel"><h3>当前账号</h3><p><strong>{accountUser?.username||'本机日记'}</strong></p>{authMode==='accounts'&&<button className="secondary-button" onClick={logout}>退出登录</button>}</section>
          <ProfileSummary profile={profile} onEdit={()=>setNutritionOpen(true)} onTarget={()=>setPlannerOpen(true)}/>
          {repository.current&&<StoragePanel repository={repository.current} notify={notify}/>}
          <BackupPanel api={api} notify={notify} onRefresh={()=>refresh()}/>
          <MotionSettings/>
        </div>}
      </>}
      </main>
      {!(authMode==='accounts'&&!connection.token) && <nav className="bottom-nav" aria-label="主导航">{([{ id: 'diary', label: '日记', icon: BookOpen }, { id: 'camera', label: '拍照', icon: Camera }, { id: 'chat', label: 'AI 搭子', icon: MessageCircle }, { id: 'settings', label: '设置', icon: SettingsIcon }] as const).map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><span><item.icon size={21}/></span>{item.label}</button>)}</nav>}
    </div>
    {editor && <FoodEditor key={editor.entry?.id ?? editor.photoIndex ?? editorKey.current} initial={editor.item} meal={editor.meal} foods={foods} onFavorite={async food=>{await api('foods',{method:'POST',body:JSON.stringify({...food,favorite:!food.favorite})});await refresh();}} loadPhoto={editor.item.photoId?()=>api<string>('photo-image/'+editor.item.photoId):undefined} onClose={() => setEditor(null)} onSave={saveEditor} onDelete={editor.entry ? async () => { if (await removeEntry(editor.entry!)) setEditor(null); } : undefined}/>}
    {plannerOpen&&localReady&&<NutritionPlannerSheet profile={profile} api={api} chatReady={!!settings.chatModel} onClose={()=>setPlannerOpen(false)} onSaved={()=>{setPlannerOpen(false);refresh();notify('AI计划已保存。');}}/>}
    {nutritionOpen&&localReady&&<NutritionSheet profile={profile} api={api} onClose={()=>setNutritionOpen(false)} onSaved={()=>refresh()}/>}
    {bodyPublicationDate&&localReady&&<BodyProfileCard date={bodyPublicationDate} api={api} onClose={()=>setBodyPublicationDate(null)}/>}
    {targetOpen && profile && <TargetSheet date={date} current={day.target} api={api} chatReady={!!settings.chatModel} onClose={()=>setTargetOpen(false)} onSaved={(saved)=>{setTargetOpen(false);refresh();notify(saved?.source==='rule_kb'?'规则候选已保存到本机，联网核验后标为已确认。':saved?.source==='ollama'?'AI计划已保存。':'手动计划已保存。');}} onOpenSettings={()=>{setTargetOpen(false);setTab('settings');}}/>}
    {profile && localReady && repository.current && <StepTracker key={repository.current.partition} repo={repository.current} onSaved={()=>refresh()} onError={notify}/>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}

function EntryIcon({entry,api}:{entry:Entry;api:<T>(route:string)=>Promise<T>}){
  const [image,setImage]=useState<string|null>(null);
  useEffect(()=>{let active=true;if(entry.photoId)api<string|null>('photo-thumbnail/'+entry.photoId).then(value=>{if(active)setImage(value);}).catch(()=>{});return()=>{active=false;};},[entry.photoId,api]);
  return <span className="food-emoji">{image?<img src={image} alt="" style={{width:36,height:36,objectFit:'cover',borderRadius:10}}/>:entry.source==='photo'?'📷':entry.source==='chat'?'💬':'🍽️'}</span>;
}

function MacroLine({ nutrients }: { nutrients: Nutrients }) { return <div className="macro-line"><span>碳水 {fmt(nutrients.carbsG)}g</span><span>蛋白质 {fmt(nutrients.proteinG)}g</span><span>脂肪 {fmt(nutrients.fatG)}g</span></div>; }

function FoodEditor({ initial, meal, foods, onClose, onSave, onDelete, loadPhoto, onFavorite }: { onFavorite:(food:Food)=>Promise<void>; loadPhoto?:()=>Promise<string>; initial: Item; meal: Meal; foods: Food[]; onClose: () => void; onSave: (item: Item, meal: Meal, saveFood: boolean) => Promise<void>; onDelete?: () => Promise<void> }) {
  const [item, setItem] = useState<Item>({ ...initial, nutrients: { ...initial.nutrients } });
  const [image,setImage]=useState('');
  const [gramsText, setGramsText] = useState(String(initial.grams));
  const [selectedMeal, setSelectedMeal] = useState(meal);
  const [saveFood, setSaveFood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const found = foods.filter(food => food.name.toLowerCase().includes(item.name.toLowerCase())).sort((a,b)=>Number(!!b.favorite)-Number(!!a.favorite)).slice(0,8);
  function pick(food: Food) { setGramsText(String(food.servingGrams)); setItem({ ...item, name: food.name, grams: food.servingGrams, nutrients: scaleNutrients(food.nutrientsPer100g, food.servingGrams / 100), nutritionSource: food.source, estimated: false }); }
  async function submit() { setBusy(true); setError(''); try { if (!item.name.trim() || !(Number(gramsText) > 0)) throw new Error('请填写食物名称和有效克数'); await onSave(item, selectedMeal, saveFood); } catch (value) { setError((value as Error).message); } finally { setBusy(false); } }
  return <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && !busy && onClose()}><section className="editor-sheet" role="dialog" aria-modal="true" aria-labelledby="editor-title"><div className="sheet-handle"/><div className="sheet-heading"><h2 id="editor-title">{onDelete ? '编辑食物记录' : '添加食物'}</h2><button className="icon-button" aria-label="关闭编辑" onClick={onClose} disabled={busy}><X size={20}/></button></div><div className="editor-body">{loadPhoto&&<><button className="text-button" onClick={()=>loadPhoto().then(setImage).catch(error=>setError(error.message))}>查看餐食照片</button>{image&&<img style={{width:'100%',borderRadius:16}} src={image} alt="餐食照片"/>}</>}<div className="meal-segment">{meals.map(value => <button key={value} className={selectedMeal === value ? 'active' : ''} onClick={() => setSelectedMeal(value)}>{mealNames[value]}</button>)}</div><label className="field-label">食物名称<input autoFocus placeholder="搜索参考食物，或输入自己的食物" value={item.name} onChange={e => setItem({ ...item, name: e.target.value })}/></label>{!onDelete && found.length > 0 && <div className="food-picker">{found.map(food => <div className="food-choice" key={food.id}><button onClick={() => pick(food)}><span>{food.emoji}</span>{food.name}<small>{fmt(food.nutrientsPer100g.energyKcal, 0)} kcal/100g</small></button><button className="favorite-food" aria-label={(food.favorite?'取消收藏':'收藏')+food.name} onClick={()=>onFavorite(food).catch(error=>setError(error.message))}>{food.favorite?'★':'☆'}</button></div>)}</div>}<label className="field-label">吃了多少<div className="grams-input"><input type="number" min="1" max="20000" inputMode="decimal" value={gramsText} onChange={e => { setGramsText(e.target.value); const grams = Number(e.target.value); if (grams > 0) setItem({ ...item, grams, nutrients: scaleNutrients(item.nutrients, grams / item.grams) }); }}/><span>克 g</span></div></label><div className="editor-nutrition-heading"><strong>这份食物的营养</strong><span>按上面的分量填写</span></div><div className="nutrient-input-grid">{(['energyKcal','carbsG','proteinG','fatG'] as (keyof Nutrients)[]).map(key => <label key={key}>{nutrientLabels[key][0]} <small>{nutrientLabels[key][1]}</small><input aria-label={nutrientLabels[key][0]} type="number" min="0" inputMode="decimal" placeholder="未知" value={item.nutrients[key] ?? ''} onChange={e => setItem({ ...item, nutrients: { ...item.nutrients, [key]: e.target.value === '' ? null : Number(e.target.value) }, nutritionSource: '用户填写或修改' })}/></label>)}</div><details className="extra-inputs"><summary>补充纤维、糖和微量营养素</summary><div className="nutrient-input-grid">{(Object.keys(nutrientLabels) as (keyof Nutrients)[]).slice(4).map(key => <label key={key}>{nutrientLabels[key][0]} <small>{nutrientLabels[key][1]}</small><input type="number" min="0" inputMode="decimal" placeholder="未知" value={item.nutrients[key] ?? ''} onChange={e => setItem({ ...item, nutrients: { ...item.nutrients, [key]: e.target.value === '' ? null : Number(e.target.value) }, nutritionSource: '用户填写或修改' })}/></label>)}</div></details><p className="source-note">来源：{item.nutritionSource}。不清楚的数值可以留空。</p><label className="check-label"><input type="checkbox" checked={item.estimated} onChange={e => setItem({ ...item, estimated: e.target.checked })}/>这份营养含估算值</label>{!onDelete && <label className="check-label"><input type="checkbox" checked={saveFood} onChange={e => setSaveFood(e.target.checked)}/>保存为常用食物，方便下次添加</label>}{error && <div className="form-error" role="alert">{error}</div>}</div><div className="sheet-footer">{onDelete && <button className="delete-button" disabled={busy} onClick={onDelete}><Trash2 size={18}/></button>}<button className="primary-button" disabled={busy} onClick={submit}>{busy ? <LoaderCircle className="spin" size={17}/> : <Check size={17}/>}保存记录</button></div></section></div>;
}

export function BackupPanel({api,notify,onRefresh}:{api:<T>(route:string,options?:RequestInit)=>Promise<T>;notify:(message:string)=>void;onRefresh:()=>void}) {
  const [busy, setBusy] = useState('');
  const importer = useRef<HTMLInputElement>(null);
  async function action(name: string, handler: () => Promise<void>) { setBusy(name); try { await handler(); } catch (error) { notify((error as Error).message); } finally { setBusy(''); } }
  async function exportBackup() {
    const backup = await api<unknown>('backup');
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const fileName = `行食记备份-${today()}.json`;
    if (Capacitor.isNativePlatform()) {
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
      const { Share } = await import('@capacitor/share');
      const result = await Filesystem.writeFile({ path: 'backups/' + fileName, data: await blob.text(), directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
      await Share.share({ title: '保存日记备份', url: result.uri, dialogTitle: '导出日记备份' });
    } else {
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    notify('已导出本机正式数据和待上传照片；已同步图片可从服务器下载');
  }
  return <section className="settings-card"><h3><ShieldCheck size={17}/> 备份与切换</h3><p className="hint">日记和身体记录保留在本机，联网后与服务器增量同步。手动备份也包含待上传照片，请妥善保存。</p><div className="backup-buttons"><button className="secondary-button" disabled={!!busy} onClick={() => action('export', exportBackup)}><Download size={17}/>导出备份</button><button className="secondary-button" disabled={!!busy} onClick={() => importer.current?.click()}><Upload size={17}/>导入备份</button></div><input ref={importer} className="hidden-input" type="file" accept="application/json,.json" onChange={e => { const file = e.target.files?.[0]; if (file) action('import', async () => { if(file.size>256*1024*1024)throw new Error('备份超过256MB，请在电脑浏览器导入或恢复服务器快照'); const parsed = JSON.parse(await file.text()); const result = await api<{ added: number;candidates:number }>('backup/import', { method: 'POST', body: JSON.stringify(parsed) }); notify(`已导入 ${result.added} 条新记录，${result.candidates||0} 个不同版本可在设置页选择恢复`); onRefresh(); }); e.target.value = ''; }}/></section>;
}
