import './studio.css';
import { CLIPS } from './motionPrograms.mjs';
import { rugSeedForStyle } from './environment/upstreamAdapters.js';
import { containerSeed } from './environment/containerAdapter.js';
import { RUG_CHOICES } from './environmentSchema.mjs';

const parent=new URLSearchParams(location.search).get('mode')==='parent';
const endpoint=parent?'/api/parent/studio':'/api/studio';
const home=parent?'./parent.html':'./';
document.body.classList.add('studio-loading');
const bar=document.createElement('nav');bar.className='studio-bar';bar.setAttribute('aria-label','原版互动导航');
const back=document.createElement('a');back.href=home;back.textContent=parent?'返回家长页':'返回奖励小屋';bar.append(back);
const status=document.createElement('span');status.setAttribute('role','status');status.textContent='正在读取已解锁内容…';bar.append(status);document.body.append(bar);
const barSize=new ResizeObserver(()=>document.body.style.setProperty('--studio-toolbar-height',`${bar.getBoundingClientRect().height}px`));barSize.observe(bar);
let csrf='',revision='0',dirty=false,stopped=false,playTimer,pollTimer,runtime;
async function request(path,method='GET',data){
  const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers:data?{'Content-Type':'application/json','X-Meow-Client':'points-pet','X-CSRF-Token':csrf}:{},body:data?JSON.stringify(data):undefined});
  const result=await response.json();if(!response.ok){const error=new Error(result.error);error.status=response.status;throw error;}return result;
}
function button(label,fn){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',async()=>{if(stopped)return;b.disabled=true;try{await fn();}catch(e){status.textContent=e.message;if(e.status===401)expire();}finally{b.disabled=stopped;}});bar.append(b);return b;}
function expire(){stopped=true;clearTimeout(playTimer);clearTimeout(pollTimer);runtime?.lock();document.body.classList.add('studio-loading');for(const control of bar.querySelectorAll('button,select'))control.disabled=true;status.textContent='登录已过期，请返回重新登录。';}
try {
  const session=await request(`/api/${parent?'parent':'child'}/session`);csrf=session.csrf;
  let data=await request(endpoint);revision=data.revision;
  const {petStudio}=await import('../src/main.js');
  runtime=petStudio;
  const rawDefaults=petStudio.capture();
  const full=data.access.full;
  const permitted=cap=>parent||full||data.access.capabilities.includes(cap);
  if(!permitted('music'))petStudio.pauseAudio();
  document.body.classList.toggle('studio-limited',!full);
  const defaults=()=>{
    if(full){petStudio.restore(Object.keys(data.preset).length?data.preset:{params:data.state.params});return;}
    const s=data.state.sceneParams,p={...data.state.params,motionDebug:false,containerSoftCollision:false};
    if(s.bed.kind!=='none'&&s.bed.kind!=='cushion'&&s.bed.placement==='inside')Object.assign(p,{pose:'containerCrouch',containerSeed:containerSeed(s.bed.kind,s.bed.seed),containerSize:Math.min(1.5,Math.max(.72,s.bed.size))});
    const rug={enabled:s.rug.style!=='none',seed:s.rug.style==='none'?7:rugSeedForStyle(s.rug.seed,RUG_CHOICES.findIndex(([id])=>id===s.rug.style))};
    const floor=Object.fromEntries(Object.entries(s.floor).filter(([k])=>k!=='kind'));
    const w=s.weather;const weather={mode:['rain','thunder','fishRain'].includes(w.mode)?'fishRain':w.mode,thunder:w.mode==='thunder'&&w.lightning,rain:w.rainAmount,cloud:w.cloudAmount,fish:w.mode==='fishRain'?w.fishAmount:0};
    petStudio.restore({...rawDefaults,params:p,floor,rug,weather});
    petStudio.restrict({floor:s.floor.kind==='wood',toy:s.toy.kind,count:s.toy.count,cushion:s.bed.kind==='cushion'});
  };
  defaults();
  status.textContent=parent?'家长原版参数 · 预览后保存':full?'完整原版已解锁':'触摸、揉捏、提起与视角操作免费开放';
  const bgm=document.getElementById('bgm-toggle');if(bgm)bgm.closest('.music-tool').hidden=!permitted('music');
  for(const [id,cap]of [['btn-export-png','capture'],['btn-export-glb','export'],['btn-codex-pet','export']]){
    const target=document.getElementById(id);target.hidden=!permitted(cap);
    if(!full&&permitted(cap))button(target.textContent.trim(),()=>target.click());
  }
  if(!full){
    const select=document.createElement('select');select.setAttribute('aria-label','已解锁原版动作');select.append(new Option('选择已解锁动作',''));
    for(const action of data.access.actions.filter(a=>CLIPS.some(c=>c.id===a.action)))select.append(new Option(action.title,action.id));bar.append(select);
    button('播放动作',async()=>{
      if(!select.value)return;
      const result=await request('/api/play','POST',{rewardId:select.value});
      clearTimeout(playTimer);window.__setAnimation({enabled:true,stateMachine:false,action:result.action,speed:result.motion?.speed??1,intensity:result.motion?.intensity??1});
      playTimer=setTimeout(()=>petStudio.stop(),1000*(result.motion?.duration??3));
    });
    if(permitted('keyboard'))button('自由行走',()=>{clearTimeout(playTimer);window.__setAnimation({enabled:true,stateMachine:true,action:'idle'});const canvas=document.getElementById('scene');canvas.tabIndex=0;canvas.focus();status.textContent='WASD 移动 · Shift 奔跑 · Space 跳跃；也可以使用下方触摸按键';});
    button('停止 / 还原',()=>{clearTimeout(playTimer);petStudio.stop();defaults();});
  }
  // Physical keyboards and tablets share the upstream state machine.
  if(permitted('keyboard')){
    const pad=document.createElement('div');pad.className='studio-pad';pad.setAttribute('aria-label','小猫行动按键');
    for(const [code,label]of [['KeyW','前进'],['KeyA','左转'],['KeyS','后退'],['KeyD','右转'],['ShiftLeft','奔跑'],['Space','跳跃']]){
      const b=document.createElement('button');b.type='button';b.textContent=label;
      b.addEventListener('pointerdown',e=>{e.preventDefault();clearTimeout(playTimer);b.setPointerCapture(e.pointerId);const a=window.__getAnimation();if(!a.enabled||!a.stateMachine)window.__setAnimation({enabled:true,stateMachine:true});petStudio.motionKey(code,true);});
      for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,()=>petStudio.motionKey(code,false));pad.append(b);
    }document.body.append(pad);
  }
  if(parent){
    const edit=()=>{dirty=true;status.textContent='原版参数有未保存修改';};
    document.getElementById('panel').addEventListener('input',edit);
    document.getElementById('panel').addEventListener('click',e=>{if(e.target.closest('.chip,.section-action,#btn-random'))edit();});
    for(const el of document.querySelectorAll('#weather-control,#light-orb')){el.addEventListener('input',edit);el.addEventListener('pointerup',edit);}
    button('保存完整方案',async()=>{const saved=await request(endpoint,'PUT',{preset:petStudio.capture(),expectedRevision:revision});revision=saved.revision;data=saved;dirty=false;status.textContent='已保存到本地，完整解锁后进入原版互动会使用此方案';});
    button('载入已保存方案',async()=>{if(dirty&&!confirm('放弃当前未保存修改并载入本地方案？'))return;data=await request(endpoint);revision=data.revision;defaults();dirty=false;status.textContent='已载入本地方案';});
    window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
  }
  document.body.classList.remove('studio-loading');document.body.dataset.studioReady='true';document.body.dataset.studioFull=String(full);
  // Keep authentication enforced in a page that can stay open longer than a parent session.
  async function checkSession(){clearTimeout(pollTimer);if(stopped)return;try{const next=await request(endpoint);if(!parent&&(next.state.version!==data.state.version)){location.reload();return;}}catch(e){if(e.status===401){petStudio.stop();expire();return;}status.textContent='连接暂时中断，稍后自动重试';}pollTimer=setTimeout(checkSession,15000);}
  pollTimer=setTimeout(checkSession,15000);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(playTimer);petStudio.stop();}else checkSession();});
} catch(e) {
  status.textContent=e.status===401?'请先返回登录，再进入原版互动。':`原版互动未能载入：${e.message}`;
  document.getElementById('initial-loader')?.remove();
}
window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(playTimer);clearTimeout(pollTimer);barSize.disconnect();});
