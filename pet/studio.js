import {createApiClient} from './ui/apiClient.js';
import {createPetRuntime} from './runtime/petRuntime.js';
import './studio.css';
import { mountHomeRuntime } from './homeRuntime.js';

const parent=new URLSearchParams(location.search).get('mode')==='parent';
const embedded=!parent&&new URLSearchParams(location.search).get('embedded')==='1';
document.body.classList.toggle('studio-embedded',embedded);
document.body.classList.toggle('studio-child',!parent);
const endpoint=parent?'/api/parent/studio':'/api/studio';
const home=parent?'./parent.html':'./';
document.body.classList.add('studio-loading');document.body.dataset.studioStage='session';
const bar=document.createElement('nav');bar.className='studio-bar';bar.setAttribute('aria-label','原版互动导航');
const back=document.createElement('a');back.href=home;back.textContent=parent?'返回家长页':'返回奖励小屋';bar.append(back);
const status=document.createElement('span');status.setAttribute('role','status');status.textContent='正在准备小猫…';bar.append(status);document.body.append(bar);
const barSize=new ResizeObserver(()=>document.body.style.setProperty('--studio-toolbar-height',`${bar.getBoundingClientRect().height}px`));barSize.observe(bar);
let csrf='',revision='0',dirty=false,stopped=false,playTimer,pollTimer,runtime;
const requests=new AbortController();
let removeVisibilityListener=()=>{};
// Home callbacks must be detached before the shared animation controller is released.
function stopStudio(){
  if(stopped)return;
  stopped=true;
  clearTimeout(playTimer);clearTimeout(pollTimer);requests.abort();
  removeVisibilityListener();barSize.disconnect();
  delete document.body.dataset.studioReady;
  try{window.meowHome?.dispose();}finally{runtime?.dispose();}
}
const apiRequest=createApiClient({getCsrf:()=>csrf,signal:requests.signal});
async function request(...args){
  const result=await apiRequest(...args);
  if(stopped)throw new DOMException('页面已关闭','AbortError');
  return result;
}
function button(label,fn){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',async()=>{if(stopped)return;b.disabled=true;try{await fn();}catch(e){if(!stopped){status.textContent=e.message;if(e.status===401)expire();}}finally{b.disabled=stopped;}});bar.append(b);return b;}
function expire(){if(stopped)return;stopStudio();delete document.body.dataset.studioReady;document.body.dataset.studioStage='expired';document.body.dataset.studioError='登录已过期，请返回重新登录。';document.body.classList.add('studio-loading');for(const control of bar.querySelectorAll('button,select'))control.disabled=true;status.textContent='登录已过期，请返回重新登录。';if(embedded)window.parent.postMessage({type:'meow:error',message:status.textContent},location.origin);}
async function startStudio(){
try {
  const session=await request(`/api/${parent?'parent':'child'}/session`);if(stopped)return;csrf=session.csrf;document.body.dataset.studioStage='configuration';
  let data=await request(endpoint);if(stopped)return;revision=data.revision;document.body.dataset.studioStage='renderer';
  const {petStudio:nativeStudio}=await import('../src/main.js');
  if(stopped){nativeStudio.lock();return;}
  const petStudio=createPetRuntime(nativeStudio);
  runtime=petStudio;await petStudio.ready;
  if(stopped)return;
  runtime=petStudio;document.body.dataset.studioStage='preset';
  const initial=petStudio.capture();
  const defaults=()=>{petStudio.resetRoom();petStudio.restore(initial);petStudio.restore(Object.keys(data.preset).length?data.preset:{params:data.state.params});};
  defaults();
  if(!parent)petStudio.setAccess(data.access);
  status.textContent=parent?'家长创作 · 调整或随机生成后，保存为解锁奖励':'原版互动免费';
  if(parent){
    const edit=()=>{dirty=true;status.textContent='原版参数有未保存修改';};
    document.getElementById('panel').addEventListener('input',edit);
    document.getElementById('panel').addEventListener('click',e=>{if(e.target.closest('.chip,.section-action,#btn-random'))edit();});
    for(const el of document.querySelectorAll('#weather-control,#light-orb,#disable-shadows')){el.addEventListener('input',edit);el.addEventListener('pointerup',edit);}
    const {createCreationEditor}=await import('./creationEditor.js');
    if(stopped)return;
    const editor=createCreationEditor({runtime:petStudio,request,onSaved:reward=>{dirty=false;status.textContent=`已保存奖励「${reward.title}」：${reward.unlockAt} 成长分解锁，兑换 ${reward.cost} 积分`;},onError:e=>{if(e.status===401)expire();}});
    const query=new URLSearchParams(location.search);
    if(query.get('reward')){await editor.load(query.get('reward'),query.get('copy')==='1');if(stopped)return;status.textContent='正在编辑家长作品，保存后更新奖励';}
    button('随机生成',()=>{document.getElementById('btn-random').click();edit();});
    button('保存为解锁奖励',()=>editor.open());
    button('另存为新奖励',()=>editor.open(true));
    button('保存草稿',async()=>{const saved=await request(endpoint,'PUT',{preset:petStudio.capture(),expectedRevision:revision});revision=saved.revision;data=saved;dirty=false;status.textContent='草稿已保存，仅家长可见；保存为奖励后孩子才可解锁';});
    button('载入草稿',async()=>{if(dirty&&!confirm('放弃当前未保存修改并载入草稿？'))return;data=await request(endpoint);revision=data.revision;defaults();dirty=false;status.textContent='已载入家长草稿';});
    window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
  }
  document.body.dataset.studioStage='home-runtime';
  if(!parent)window.meowHome=mountHomeRuntime(petStudio,data,initial);
  document.body.classList.remove('studio-loading');document.body.dataset.studioReady='true';document.body.dataset.studioStage='ready';document.body.dataset.studioFull='true';
  if(embedded)window.parent.postMessage({type:'meow:ready'},location.origin);
  // Keep authentication enforced in a page that can stay open longer than a parent session.
  let checkingSession=false;
  async function checkSession(){
    clearTimeout(pollTimer);
    if(stopped||checkingSession)return;
    checkingSession=true;
    try{
      const next=await request(endpoint);
      if(stopped)return;
      if(!parent){
        if(!embedded&&(next.revision!==revision||next.state.version!==data.state.version)){data=next;defaults();}
        window.meowHome?.applyState(next.state);petStudio.setAccess(next.access);data=next;revision=next.revision;
      }
    }catch(e){
      if(stopped)return;
      if(e.status===401){expire();return;}
      status.textContent='连接暂时中断，稍后自动重试';
    }finally{
      checkingSession=false;
      if(!stopped)pollTimer=setTimeout(checkSession,15000);
    }
  }
  pollTimer=setTimeout(checkSession,15000);
  const visibilityChanged=()=>{
    if(stopped)return;
    if(document.hidden){clearTimeout(playTimer);window.meowHome?.overlay(true);petStudio.clearKeys();petStudio.stop();}
    else{window.meowHome?.overlay(false);void checkSession();}
  };
  document.addEventListener('visibilitychange',visibilityChanged);
  removeVisibilityListener=()=>document.removeEventListener('visibilitychange',visibilityChanged);
} catch(e) {
  if(stopped)return;
  stopStudio();
  delete document.body.dataset.studioReady;document.body.dataset.studioStage='failed';document.body.dataset.studioError=e.message;
  status.textContent=e.status===401?'请先返回登录，再进入原版互动。':`原版互动未能载入：${e.message}`;
  document.getElementById('initial-loader')?.remove();
  if(embedded)window.parent.postMessage({type:'meow:error',message:status.textContent},location.origin);
}
}
// Register before initialization awaits so a late fetch/import cannot reopen a closed stage.
window.addEventListener('pagehide',stopStudio);
void startStudio();
