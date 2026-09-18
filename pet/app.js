import './style.css';
import {CATEGORY_LABELS} from './presetSchema.mjs';
import {SCENE_SLOTS} from './environmentSchema.mjs';
import './environment.css';
import './child.css';
import { childMarkup, createChildOverlay } from './childLayout.js';
import { rewardPage } from './rewardPages.mjs';
import { createPresetEditor } from './presetEditor.js';
import { createHistoryView } from './history.js';
const parent=document.body.dataset.role==='parent';
const role=parent?'parent':'child';
const $=selector=>document.querySelector(selector);
const el=(tag,cls,content)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(content!==undefined)e.textContent=content;return e;};
const labels=CATEGORY_LABELS;
const icons={coat:'◒',shape:'☁',eyes:'◉',pose:'♧',trick:'✦',capability:'✧',floor:'▤',rug:'▧',bed:'⌂',toy:'●',weather:'☂',lighting:'☀',camera:'◎',effect:'≋',theme:'✿'};
const uid=()=>Array.from(crypto.getRandomValues(new Uint8Array(20)),n=>n.toString(16).padStart(2,'0')).join('');
let state=null,csrf='',scene=null,sceneLoading=null,category='all',view='shop',catalog=null,online=true,selectedReward=null,toastTimer,catalogRevision='',presetEditor=null,historyView=null,childOverlay=null,rewardPageIndex=0,rewardRenderKey='';
const operationKeys=new Map();
function keyFor(intent){if(!operationKeys.has(intent))operationKeys.set(intent,uid());return operationKeys.get(intent);}
function toast(message,error=false){const box=$('#toast');box.textContent=message;box.classList.toggle('error',error);box.hidden=false;const popup=$('#purchase-dialog')?.open?$('#purchase-error'):$('#rewards-dialog')?.open?$('#rewards-message'):null;if(popup){popup.textContent=message;popup.hidden=false;popup.classList.toggle('error',error);}clearTimeout(toastTimer);toastTimer=setTimeout(()=>box.hidden=true,5000);}
async function api(path,method='GET',data,extraHeaders={}) {
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{...(data===undefined?{}:{'Content-Type':'application/json','X-Meow-Client':'points-pet','X-CSRF-Token':csrf}),...extraHeaders},...(data===undefined?{}:{body:JSON.stringify(data)})});
    const result=await response.json();
    if(!response.ok){const error=new Error(result.error||'操作失败');error.status=response.status;throw error;}
    return result;
  }catch(error){if(error.name==='AbortError')throw new Error('连接超时；重试会沿用同一请求 ID，不会重复扣分');throw error;}finally{clearTimeout(timeout);}
}
async function run(button,work){
  if(button?.dataset.busy)return;
  if(button){button.dataset.busy='true';button.disabled=true;}
  try{await work();}catch(error){toast(error.message,true);if(error.status===401&&csrf)lock();}
  finally{if(button){delete button.dataset.busy;button.disabled=false;}}
}
function lock(){csrf='';state=null;childOverlay?.close();document.body.classList.remove('child-active');rewardRenderKey='';presetEditor?.close();historyView?.reset();$('#purchase-dialog')?.close();$('#auth').hidden=false;$('#workspace').hidden=true;$('#login-form').reset();$('#code').focus();}
function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function button(text,action,cls='button'){const b=el('button',cls,text);b.type='button';b.dataset.action=action;return b;}
function statMarkup(){return `<div class="stat"><span>可兑换积分</span><strong id="balance">0</strong><small>兑换只使用这里的积分</small></div><div class="stat growth"><span>累计成长积分</span><strong id="lifetime">0</strong><small>不会因为兑换而减少</small></div><div class="stat"><span>已收集奖励</span><strong id="owned-count">0</strong><small>解锁后可以一直使用</small></div>`;}
$('#app').innerHTML=`
<header class="topbar"><a class="brand" href="./"><span class="brand-mark" aria-hidden="true">m.</span><span>Meow<small>每一点努力，都被看见</small></span></a><div class="top-actions"><span class="role-label">${parent?'家长管理':'我的积分小猫'}</span><a href="${parent?'./':'./parent.html'}">${parent?'孩子页面 ↗':'家长入口'}</a></div></header>
<section id="auth" class="auth-card"><span class="eyebrow">${parent?'PARENT SPACE':'MY LITTLE COMPANION'}</span><h1>${parent?'记录孩子的小小进步':'你好，小伙伴'}</h1><p id="auth-description">${parent?'家长密码只交给大人保管。离开前请锁定页面。':'输入家长给你的进入码，看看小猫的新本领吧。'}</p>
<form id="login-form"><label for="code">${parent?'家长密码':'孩子进入码'}</label><input id="code" name="code" type="password" inputmode="numeric" autocomplete="${parent?'current-password':'off'}" required maxlength="12" pattern="[0-9]{${parent?'6':'4'},12}"><button class="button primary" type="submit">${parent?'进入家长页面':'去见我的小猫'}</button></form>
<form id="setup-form" hidden><p class="note">首次使用：复制启动终端里的一次性口令。家长密码和孩子进入码必须不同。</p><label>一次性初始化口令<input name="setupToken" required autocomplete="off" maxlength="64"></label><div class="form-grid"><label>家长密码（6–12 位数字）<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{6,12}" required autocomplete="new-password"></label><label>孩子进入码（4–12 位数字）<input name="childCode" type="password" inputmode="numeric" pattern="[0-9]{4,12}" required autocomplete="off"></label><label>孩子昵称<input name="childName" value="小朋友" maxlength="20" required></label><label>小猫名字<input name="petName" value="小橘" maxlength="20" required></label></div><button type="submit" class="button primary">创建我们的积分小猫</button></form></section>
<main id="workspace" hidden>${parent?`<div class="page-heading"><div><span class="eyebrow">${parent?'GROW TOGETHER':'A LITTLE BETTER, EVERY DAY'}</span><h1 id="greeting"></h1><p>${parent?'把值得鼓励的事情记下来，让努力变成看得见的成长。':'慢慢积累，慢慢长大。你的每一份努力，小猫都记得。'}</p></div><button type="button" class="button quiet" data-action="logout">${parent?'锁定家长页面':'退出'}</button></div><p id="network" class="network" role="status" hidden>暂时没有连接到服务，正在重连。积分以服务端记录为准。</p><div class="stats">${statMarkup()}</div>
`:""}
${parent?`<nav class="section-tabs" aria-label="家长功能"><button type="button" data-parent-tab="award" aria-selected="true">日常加分</button><button type="button" data-parent-tab="catalog">奖励预设</button><button type="button" data-parent-tab="settings">记录与设置</button></nav>
<section id="panel-award" class="parent-grid"><article class="panel"><span class="eyebrow">NOTICE THE GOOD</span><h2>今天，有什么值得鼓励？</h2><form id="points-form"><label>加分理由（必填）<input name="reason" id="reason" maxlength="120" required placeholder="例如：自己整理好了书包"></label><div class="quick-reasons"><button type="button" data-reason="认真阅读">认真阅读</button><button type="button" data-reason="自主整理">自主整理</button><button type="button" data-reason="坚持运动">坚持运动</button><button type="button" data-reason="友善合作">友善合作</button></div><label>增加积分<input name="delta" id="delta" type="number" min="-10000" max="10000" step="1" value="5" required></label><div class="point-options"><button type="button" data-points="5">+5</button><button type="button" data-points="10">+10</button><button type="button" data-points="20">+20</button></div><p class="note">只奖励已完成的事情。误记时可填负数更正余额；成长积分和已有奖励不会被收回。</p><button id="award-submit" type="submit" class="button primary">确认记录积分</button></form></article><article class="panel"><div class="panel-title"><h2>积分理由与兑换记录</h2><span class="subtle">本地完整记录</span></div><div id="ledger"></div></article></section>
<section id="panel-catalog" class="panel" hidden><div class="panel-title"><div><h2>设计属于你们的小猫奖励</h2><p>直接调节花色、体型、眼睛、姿态与互动参数，预览后保存到本地。兑换消耗为 0 时，达到解锁积分后自动获得。</p></div></div><div class="toolbar"><button class="button primary" type="button" data-action="new-preset">新增奖励预设</button><button class="button" type="button" data-action="save-catalog">保存价格与门槛</button><button class="button" type="button" data-action="export-catalog">导出预设 JSON</button><label class="button file-button">导入预设 JSON<input id="catalog-file" type="file" accept="application/json,.json"></label></div><div id="catalog-stale" class="catalog-stale" hidden><p>目录已有新版本，当前未保存的表格修改仍保留。</p><button type="button" class="button small" data-action="reload-catalog">重新读取目录</button></div><p id="catalog-dirty" class="note" hidden>有尚未保存的奖励设置。</p><div class="table-scroll"><table class="catalog-table"><thead><tr><th>奖励</th><th>类别</th><th>兑换价格</th><th>解锁积分</th><th>参数预设</th></tr></thead><tbody id="catalog-body"></tbody></table></div><p class="note">点击“调参数”修改预设，也可以复制成新奖励；所有保存写入本地数据库。已有奖励的 ID、类别和初始标记不能改变。JSON 导入导出作为可选的批量配置工具。</p></section>
<section id="panel-settings" hidden><div class="local-storage"><strong>本地数据保存位置</strong><p><code id="local-data-path">正在读取…</code></p><p id="local-data-info"></p><p>积分、加分理由、兑换内容和参数预设都保存在运行服务的电脑，不上传 GitHub 或云端。关闭页面、清理浏览器数据不会删除此文件。备份前请停止服务并复制整个数据目录。</p></div><div class="parent-grid"><article class="panel"><h2>我们的小档案</h2><form id="profile-form"><label>孩子昵称<input name="childName" maxlength="20" required></label><label>小猫名字<input name="petName" maxlength="20" required></label><button class="button primary" type="submit">保存名字</button></form><hr><h3>导出成长记录</h3><p class="note">导出包含全部积分流水、当前装扮和奖励设置，不包含密码。这是可查阅的记录，不是自动恢复文件。</p><button class="button" type="button" data-action="export-progress">下载成长记录 JSON</button></article><article class="panel"><h2>密码与进入码</h2><form id="password-form"><label>当前家长密码<input name="currentPin" type="password" inputmode="numeric" required autocomplete="current-password"></label><label>新家长密码（留空不改）<input name="newPin" type="password" inputmode="numeric" pattern="[0-9]{6,12}" autocomplete="new-password"></label><label>新孩子进入码（留空不改）<input name="childCode" type="password" inputmode="numeric" pattern="[0-9]{4,12}" autocomplete="off"></label><p class="note">修改密码会使对应角色的其他设备退出。家长登录在 15 分钟后自动锁定。</p><button type="submit" class="button primary">更新密码</button></form></article></div></section>`:
childMarkup()}
</main><footer class="site-footer">Meow · 一点点努力，一点点长大 <span>数据只保存在运行服务的电脑</span></footer>`;

if(!parent)childOverlay=createChildOverlay({onOpen(nextView){if(nextView!==view){view=nextView;category='all';rewardPageIndex=0;}renderRewards();if(view==='history')historyView?.refresh();}});
historyView=createHistoryView($('#ledger'),{api,parent,paginated:!parent,pageSize:parent?40:5,isActive:()=>parent||!!(childOverlay?.isOpen&&view==='history'),onError:error=>{toast(error.message,true);if(error.status===401&&csrf)lock();}});
if(parent){const link=el('a','button','原版完整参数');link.href='./studio.html?mode=parent';$('#panel-catalog .toolbar').prepend(link);}
if(parent)presetEditor=createPresetEditor({api,onSaved:(next,nextCatalog)=>{
  catalog=nextCatalog;catalogRevision=next.catalogRevision;apply(next);renderCatalog();
  $('#catalog-dirty').hidden=true;$('#catalog-stale').hidden=true;toast('预设已保存到本地，孩子页面会自动更新');
}});
function renderLedger(){historyView?.update(state?.ledger[0]?.id);}
async function reloadCatalog(){
  const next=await api('/api/parent/presets');catalog=next.catalog;catalogRevision=next.revision;
  renderCatalog();$('#catalog-dirty').hidden=true;$('#catalog-stale').hidden=true;
}
async function showStorage(){
  const data=await api('/api/parent/storage');$('#local-data-path').textContent=data.path||'测试模式：内存数据库，不用于正式使用';
  $('#local-data-info').textContent=`${data.persistent?'已启用本地磁盘持久保存':'仅测试使用'} · ${data.ledgerCount} 条流水 · ${data.rewardCount} 项奖励预设`;
}
function allowTableDiscard(){
  if($('#catalog-dirty').hidden)return true;
  if(!confirm('表格里有未保存的价格或门槛。是否放弃这些修改，继续操作？'))return false;
  renderCatalog();$('#catalog-dirty').hidden=true;return true;
}
function renderRewards(){
  if(parent||!state)return;
  $('#reward-panel').hidden=view==='history';$('#history-panel').hidden=view!=='history';
  $('#reward-panel').setAttribute('aria-labelledby',`tab-${view==='owned'?'owned':'shop'}`);
  document.querySelectorAll('[data-view]').forEach(b=>{b.setAttribute('aria-selected',b.dataset.view===view);b.tabIndex=b.dataset.view===view?0:-1;});
  const result=rewardPage(state.rewards,{category,ownedOnly:view==='owned',page:rewardPageIndex});rewardPageIndex=result.page;
  const key=JSON.stringify([view,category,rewardPageIndex,online,state.rewards]);
  if(key===rewardRenderKey)return;rewardRenderKey=key;
  const focused=document.activeElement;const focusId=focused?.dataset.id,focusCategory=focused?.dataset.category;
  if(!$('#categories').children.length){
    for(const [value,name]of [['all','全部'],...Object.entries(labels).filter(([id])=>!SCENE_SLOTS.includes(id)&&id!=='theme')]){const b=button(name,'category','chip');b.dataset.category=value;$('#categories').append(b);}
    const select=el('select','scene-filter');select.id='scene-category';select.setAttribute('aria-label','场景布置分类');
    select.append(new Option('场景布置…',''));for(const slot of [...SCENE_SLOTS,'theme'])select.append(new Option(labels[slot],slot));
    select.addEventListener('change',()=>{if(!select.value)return;category=select.value;rewardPageIndex=0;renderRewards();});
    $('#categories').append(select);
  }
  $('#scene-category').value=[...SCENE_SLOTS,'theme'].includes(category)?category:'';
  $('#categories').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.category===category));
  const root=$('#reward-grid');root.replaceChildren();root.dataset.page=String(result.page+1);root.dataset.pages=String(result.pages);
  $('#reward-prev').disabled=result.page===0;$('#reward-next').disabled=result.page>=result.pages-1;
  $('#reward-page-status').textContent=`第 ${result.page+1} / ${result.pages} 页 · 共 ${result.total} 项`;
  if(!result.items.length)root.append(el('p','empty','这里还没有收藏。去发现一份喜欢的奖励吧。'));
  for(const reward of result.items){
    const card=el('article',`reward-card ${reward.owned?'is-owned':reward.eligible?'':'is-locked'}`);card.dataset.rewardId=reward.id;
    const art=el('div',`reward-art art-${reward.category}`);art.append(el('span','',icons[reward.category]),el('small','',labels[reward.category]));
    art.append(el('span','reward-tag',reward.equipped?'使用中':reward.owned?'已收藏':reward.eligible?'可以兑换':'成长解锁'));
    const content=el('div','reward-content');content.append(el('h3','',reward.title),el('p','',reward.description));
    const foot=el('div','reward-foot');foot.append(el('strong','',reward.owned?'永久拥有':reward.cost===0?'成长礼物':`${reward.cost} 积分`));
    let b;
    if(reward.owned){
      const canRemove=SCENE_SLOTS.includes(reward.category)&&reward.equipped&&!reward.starter;
      b=button(canRemove?'卸下':reward.category==='trick'?'玩一下':reward.equipped?'正在使用':reward.category==='theme'?'应用整套':'换上它',canRemove?'unequip':reward.category==='trick'?'play':'equip','button small');
      if(reward.category==='capability'){b.textContent='进入原版互动';b.dataset.action='studio';}
      b.dataset.slot=reward.category;b.disabled=(!canRemove&&reward.equipped)||!online;
    }
    else if(!reward.eligible){b=button(`还差 ${reward.unlockAt-state.lifetime} 成长分`,'purchase','button small');b.disabled=true;}
    else{b=button(reward.affordable?'兑换':'余额不足','purchase','button small');b.disabled=!reward.affordable||!online;}
    b.dataset.id=reward.id;foot.append(b);content.append(foot);card.append(art,content);root.append(card);
  }
  // Polling must not tear focus away from a keyboard user or a purchase confirmation.
  if(childOverlay?.isOpen&&!$('#purchase-dialog').open&&focusId){const replacement=[...root.querySelectorAll('button')].find(b=>b.dataset.id===focusId);if(replacement&&!replacement.disabled)replacement.focus({preventScroll:true});}
  if(focusCategory&&!focused.isConnected)$('#categories').querySelector(`[data-category="${focusCategory}"]`)?.focus({preventScroll:true});
}
async function updateScene(){
  if(parent||!state)return;
  try{
    if(!sceneLoading)sceneLoading=import('./scene.js').then(({createPetScene})=>scene=createPetScene($('#pet-scene')));
    await sceneLoading;if(!state)return;
    scene.applyState(state);$('#scene-loading').hidden=true;
  }catch(error){$('#scene-loading').hidden=false;$('#scene-loading').textContent='三维小猫暂时没有加载成功，请刷新页面重试。积分和收藏仍然保留。';console.error(error);}
}
function apply(next){
  if(state&&next.version<state.version)return;
  const previous=state;state=next;online=true;$('#network').hidden=true;
  $('#balance').textContent=state.balance;$('#lifetime').textContent=state.lifetime;$('#owned-count').textContent=state.owned.length;
  $('#greeting').textContent=parent?`${state.childName}的成长小花园`:`${state.childName}，今天也很棒`;
  renderLedger();
  if(parent&&catalog&&next.catalogRevision!==catalogRevision)$('#catalog-stale').hidden=false;
  if(!parent){
    $('#pet-name').textContent=state.petName;
    renderRewards();updateScene();
    if(previous){const gifts=state.rewards.filter(r=>r.owned&&!previous.owned.includes(r.id)&&r.cost===0&&!r.starter);if(gifts.length)toast(`收到了成长礼物：${gifts.map(r=>r.title).join('、')}`);}
  }
}
function renderCatalog(){
  if(!$('#catalog-filter')){
    const wrap=el('label','scene-catalog-filter','筛选奖励类别');
    const select=el('select','scene-filter');select.id='catalog-filter';
    select.append(new Option('所有奖励','all'));for(const [id,label]of Object.entries(labels))select.append(new Option(label,id));
    select.addEventListener('change',()=>{for(const row of $('#catalog-body').children)row.hidden=select.value!=='all'&&row.dataset.category!==select.value;});
    wrap.append(select);$('#panel-catalog .table-scroll').before(wrap);
  }
  $('#catalog-body').replaceChildren();
  for(const reward of catalog.rewards){
    const tr=el('tr');tr.dataset.category=reward.category;tr.hidden=$('#catalog-filter').value!=='all'&&$('#catalog-filter').value!==reward.category;tr.append(el('td','',reward.title),el('td','',labels[reward.category]));
    for(const field of ['cost','unlockAt']){const td=el('td'),input=el('input');input.type='number';input.min='0';input.max='1000000';input.step='1';input.value=reward[field];input.dataset.rewardId=reward.id;input.dataset.field=field;input.setAttribute('aria-label',`${reward.title}的${field==='cost'?'价格':'解锁积分'}`);input.disabled=!!reward.starter;td.append(input);tr.append(td);}
    const td=el('td'),operations=el('div','catalog-operations');
    for(const [action,label]of [['edit-preset','调参数'],['copy-preset','复制']]){const b=button(label,action,'button small');b.dataset.id=reward.id;operations.append(b);}
    td.append(operations);tr.append(td);$('#catalog-body').append(tr);
  }
}
async function enter(result){csrf=result.csrf;if(!parent)document.body.classList.add('child-active');$('#auth').hidden=true;$('#workspace').hidden=false;$('#setup-form').hidden=true;$('#login-form').hidden=false;apply(result.state);if(parent){$('#profile-form').elements.childName.value=state.childName;$('#profile-form').elements.petName.value=state.petName;await reloadCatalog();await showStorage();}}
$('#login-form').addEventListener('submit',event=>{event.preventDefault();run(event.submitter,async()=>{await enter(await api(`/api/${role}/login`,'POST',{code:$('#code').value}));$('#login-form').reset();});});
$('#setup-form').addEventListener('submit',event=>{event.preventDefault();run(event.submitter,async()=>{await enter(await api('/api/parent/setup','POST',Object.fromEntries(new FormData(event.currentTarget))));$('#setup-form').reset();toast('已经准备好啦。把孩子进入码告诉孩子，家长密码请自己保管。');});});
if(parent){
  $('#points-form').addEventListener('submit',event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));data.delta=Number(data.delta);data.reason=data.reason.trim();if(!data.reason){toast('请填写加分理由，不能只输入空格',true);$('#reason').focus();return;}const intent=JSON.stringify(data);data.idempotencyKey=keyFor(intent);run(event.submitter,async()=>{apply(await api('/api/parent/points','POST',data));operationKeys.delete(intent);toast(data.delta>0?`已记录 ${data.delta} 积分，孩子页面会自动更新`:'余额更正已记录');$('#reason').value='';});});
  $('#profile-form').addEventListener('submit',event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));run(event.submitter,async()=>{apply(await api('/api/parent/profile','PUT',data));toast('名字已保存');});});
  $('#password-form').addEventListener('submit',event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));run(event.submitter,async()=>{const result=await api('/api/parent/credentials','PUT',data);csrf=result.csrf;$('#password-form').reset();toast('密码已更新，对应角色的其他设备需要重新登录');});});
  $('#catalog-body').addEventListener('input',()=>$('#catalog-dirty').hidden=false);
  $('#catalog-file').addEventListener('change',event=>{const file=event.target.files[0];if(!file)return;if(!allowTableDiscard()){event.target.value='';return;}run(null,async()=>{if(file.size>131072)throw new Error('预设文件不能超过 128 KB');const next=JSON.parse(await file.text());apply(await api('/api/parent/catalog','PUT',next,{'If-Match':catalogRevision}));await reloadCatalog();$('#catalog-dirty').hidden=true;toast('预设已导入并保存');}).finally(()=>event.target.value='');});
}
document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.parentTab){document.querySelectorAll('[data-parent-tab]').forEach(t=>t.setAttribute('aria-selected',t===b));for(const tab of ['award','catalog','settings'])$(`#panel-${tab}`).hidden=tab!==b.dataset.parentTab;if(b.dataset.parentTab==='settings')run(null,showStorage);return;}
  if(b.dataset.reason){$('#reason').value=b.dataset.reason;return;}
  if(b.dataset.points){$('#delta').value=b.dataset.points;return;}
  if(b.dataset.view){view=b.dataset.view;category='all';rewardPageIndex=0;$('#rewards-message').hidden=true;renderRewards();if(view==='history')historyView.refresh();return;}
  const action=b.dataset.action;if(!action)return;
  if(action==='category'){category=b.dataset.category;rewardPageIndex=0;renderRewards();return;}
  if(action==='reward-prev'||action==='reward-next'){rewardPageIndex+=action==='reward-next'?1:-1;renderRewards();return;}
  if(action==='close-rewards'){childOverlay.close();return;}
  if(action==='open-rewards'){childOverlay.open('shop',b);return;}
  if(action==='collection'){childOverlay.open('owned',b);return;}
  if(action==='purchase'){selectedReward=state.rewards.find(r=>r.id===b.dataset.id);$('#purchase-title').textContent=`把「${selectedReward.title}」带回家？`;$('#purchase-description').textContent=selectedReward.description+(selectedReward.category==='theme'?' 本次扣除整套价格；已有物品不会重复发放，暂不按已有物品折价。':'');$('#purchase-balance').textContent=`使用 ${selectedReward.cost} 积分 · 兑换后剩余 ${state.balance-selectedReward.cost} 积分`;$('#purchase-error').hidden=true;$('#purchase-dialog').showModal();return;}
  run(b,async()=>{
    if(['new-preset','edit-preset','copy-preset'].includes(action)){
      if(!allowTableDiscard())return;
      await presetEditor.open(b.dataset.id||null,action==='copy-preset');
    }
    if(action==='reload-catalog'){if(allowTableDiscard())await reloadCatalog();}
    if(action==='logout'){await api(`/api/${role}/logout`,'POST',{});lock();}
    if(action==='unequip'){apply(await api('/api/unequip','POST',{slot:b.dataset.slot}));childOverlay.close();toast('已卸下场景物品，拥有权仍然保留');}
    if(action==='studio'){location.href='./studio.html';return;}
    if(action==='equip'){apply(await api('/api/equip','POST',{rewardId:b.dataset.id}));childOverlay.close();toast('已经应用，回到小猫看看吧');}
    if(action==='play'){const result=await api('/api/play','POST',{rewardId:b.dataset.id});await updateScene();if(!scene)throw new Error('三维小猫尚未准备好，请刷新后重试');childOverlay.close();scene.play(result.action,result.motion);toast(matchMedia('(prefers-reduced-motion: reduce)').matches?'小猫完成了互动（已遵循减少动态效果设置）':'小猫来表演啦');}
    if(action==='confirm-purchase'){const reward=selectedReward;if(!reward)return;const intent=`purchase:${reward.id}:${reward.cost}`;apply(await api('/api/purchase','POST',{rewardId:reward.id,expectedCost:reward.cost,idempotencyKey:keyFor(intent)}));operationKeys.delete(intent);$('#purchase-dialog').close();toast(`已经收藏「${reward.title}」，去试试看吧`);}
    if(action==='save-catalog'){
      const next=structuredClone(catalog);for(const input of document.querySelectorAll('#catalog-body input')){if(!input.checkValidity()||input.value==='')throw new Error('请填写有效的整数价格和成长门槛');next.rewards.find(r=>r.id===input.dataset.rewardId)[input.dataset.field]=Number(input.value);}
      const result=await api('/api/parent/catalog','PUT',next,{'If-Match':catalogRevision});catalog=next;catalogRevision=result.catalogRevision;apply(result);$('#catalog-dirty').hidden=true;$('#catalog-stale').hidden=true;toast('价格与解锁积分已保存到本地');
    }
    if(action==='export-catalog')download('meow-rewards.json',await api('/api/parent/catalog'));
    if(action==='export-progress')download('meow-progress.json',await api('/api/parent/export'));
  });
});
async function refresh(){if(!csrf||document.hidden)return;try{apply(await api(parent?'/api/parent/state':'/api/state'));}catch(error){if(error.status===401){lock();toast(error.message,true);}else{online=false;$('#network').hidden=false;if(!parent&&state)renderRewards();}}}
setInterval(refresh,4000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('pagehide',event=>{if(!event.persisted){scene?.dispose();presetEditor?.close();}});
(async()=>{try{const status=await api('/api/status');if(!status.configured){if(parent){$('#login-form').hidden=true;$('#setup-form').hidden=false;}else $('#auth-description').textContent='请先请家长在家长页面完成初始化，再把孩子进入码告诉你。';return;}try{await enter(await api(`/api/${role}/session`));}catch(error){if(error.status!==401)throw error;}}catch(error){toast(`无法连接积分服务：${error.message}`,true);}})();

if(!parent)document.querySelector('[role=tablist]').addEventListener('keydown',event=>{
  const tabs=[...document.querySelectorAll('[data-view]')],index=tabs.indexOf(event.target);
  if(index<0||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  tabs[next].click();tabs[next].focus();
});
