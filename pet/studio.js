import './studio.css';

const parent=new URLSearchParams(location.search).get('mode')==='parent';
const embedded=!parent&&new URLSearchParams(location.search).get('embedded')==='1';
document.body.classList.toggle('studio-embedded',embedded);
document.body.classList.toggle('studio-child',!parent);
const endpoint=parent?'/api/parent/studio':'/api/studio';
const home=parent?'./parent.html':'./';
document.body.classList.add('studio-loading');
const bar=document.createElement('nav');bar.className='studio-bar';bar.setAttribute('aria-label','原版互动导航');
const back=document.createElement('a');back.href=home;back.textContent=parent?'返回家长页':'返回奖励小屋';bar.append(back);
const status=document.createElement('span');status.setAttribute('role','status');status.textContent='正在准备小猫…';bar.append(status);document.body.append(bar);
const barSize=new ResizeObserver(()=>document.body.style.setProperty('--studio-toolbar-height',`${bar.getBoundingClientRect().height}px`));barSize.observe(bar);
let csrf='',revision='0',dirty=false,stopped=false,playTimer,pollTimer,runtime;
async function request(path,method='GET',data){
  const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers:data?{'Content-Type':'application/json','X-Meow-Client':'points-pet','X-CSRF-Token':csrf}:{},body:data?JSON.stringify(data):undefined});
  const result=await response.json();if(!response.ok){const error=new Error(result.error);error.status=response.status;throw error;}return result;
}
function button(label,fn){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',async()=>{if(stopped)return;b.disabled=true;try{await fn();}catch(e){status.textContent=e.message;if(e.status===401)expire();}finally{b.disabled=stopped;}});bar.append(b);return b;}
function expire(){stopped=true;clearTimeout(playTimer);clearTimeout(pollTimer);window.meowHome?.dispose();runtime?.lock();document.body.classList.add('studio-loading');for(const control of bar.querySelectorAll('button,select'))control.disabled=true;status.textContent='登录已过期，请返回重新登录。';if(embedded)window.parent.postMessage({type:'meow:error',message:status.textContent},location.origin);}
try {
  const session=await request(`/api/${parent?'parent':'child'}/session`);csrf=session.csrf;
  let data=await request(endpoint);revision=data.revision;
  const {petStudio}=await import('../src/main.js');
  runtime=petStudio;
  const initial=petStudio.capture();
  const defaults=()=>{petStudio.resetRoom();petStudio.restore(initial);petStudio.restore(Object.keys(data.preset).length?data.preset:{params:data.state.params});};
  defaults();
  if(!parent)petStudio.setAccess(data.access);
  status.textContent=parent?'家长创作 · 调整或随机生成后，保存为解锁奖励':'原版互动免费';
  // Physical keyboards and tablets share the upstream state machine.
  {
    const pad=document.createElement('div');pad.className='studio-pad';pad.setAttribute('aria-label','小猫行动按键');
    for(const [code,label]of [['KeyW','前进'],['KeyA','左转'],['KeyS','后退'],['KeyD','右转'],['ShiftLeft','奔跑'],['Space','跳跃']]){
      const b=document.createElement('button');b.type='button';b.textContent=label;
      b.addEventListener('pointerdown',e=>{e.preventDefault();clearTimeout(playTimer);b.setPointerCapture(e.pointerId);const a=window.__getAnimation();if(!a.enabled||!a.stateMachine)window.__setAnimation({enabled:true,stateMachine:true});petStudio.motionKey(code,true);});
      for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,()=>petStudio.motionKey(code,false));pad.append(b);
    }document.body.append(pad);
    const stop=document.createElement('button');stop.type='button';stop.textContent='停止';stop.addEventListener('click',()=>{petStudio.clearKeys();petStudio.stop();});pad.append(stop);
  }
  if(parent){
    const edit=()=>{dirty=true;status.textContent='原版参数有未保存修改';};
    document.getElementById('panel').addEventListener('input',edit);
    document.getElementById('panel').addEventListener('click',e=>{if(e.target.closest('.chip,.section-action,#btn-random'))edit();});
    for(const el of document.querySelectorAll('#weather-control,#light-orb')){el.addEventListener('input',edit);el.addEventListener('pointerup',edit);}
    const {createCreationEditor}=await import('./creationEditor.js');
    const editor=createCreationEditor({runtime:petStudio,request,onSaved:reward=>{dirty=false;status.textContent=`已保存奖励「${reward.title}」：${reward.unlockAt} 成长分解锁，兑换 ${reward.cost} 积分`;},onError:e=>{if(e.status===401)expire();}});
    const query=new URLSearchParams(location.search);
    if(query.get('reward')){await editor.load(query.get('reward'),query.get('copy')==='1');status.textContent='正在编辑家长作品，保存后更新奖励';}
    button('随机生成',()=>{document.getElementById('btn-random').click();edit();});
    button('保存为解锁奖励',()=>editor.open());
    button('另存为新奖励',()=>editor.open(true));
    button('保存草稿',async()=>{const saved=await request(endpoint,'PUT',{preset:petStudio.capture(),expectedRevision:revision});revision=saved.revision;data=saved;dirty=false;status.textContent='草稿已保存，仅家长可见；保存为奖励后孩子才可解锁';});
    button('载入草稿',async()=>{if(dirty&&!confirm('放弃当前未保存修改并载入草稿？'))return;data=await request(endpoint);revision=data.revision;defaults();dirty=false;status.textContent='已载入家长草稿';});
    window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
  }
  if(embedded){const {mountHomeRuntime}=await import('./homeRuntime.js');window.meowHome=mountHomeRuntime(petStudio,data,initial);}
  document.body.classList.remove('studio-loading');document.body.dataset.studioReady='true';document.body.dataset.studioFull='true';
  if(embedded)window.parent.postMessage({type:'meow:ready'},location.origin);
  // Keep authentication enforced in a page that can stay open longer than a parent session.
  async function checkSession(){clearTimeout(pollTimer);if(stopped)return;try{const next=await request(endpoint);if(!parent){if(!embedded&&(next.revision!==revision||next.state.version!==data.state.version)){data=next;defaults();}window.meowHome?.applyState(next.state);petStudio.setAccess(next.access);data=next;revision=next.revision;}}catch(e){if(e.status===401){petStudio.stop();expire();return;}status.textContent='连接暂时中断，稍后自动重试';}pollTimer=setTimeout(checkSession,15000);}
  pollTimer=setTimeout(checkSession,15000);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(playTimer);window.meowHome?.overlay(true);petStudio.clearKeys();petStudio.stop();}else checkSession();});
} catch(e) {
  status.textContent=e.status===401?'请先返回登录，再进入原版互动。':`原版互动未能载入：${e.message}`;
  document.getElementById('initial-loader')?.remove();
  if(embedded)window.parent.postMessage({type:'meow:error',message:status.textContent},location.origin);
}
window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(playTimer);clearTimeout(pollTimer);barSize.disconnect();window.meowHome?.dispose();runtime?.lock();});
