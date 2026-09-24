import {createSessionState} from './ui/account/sessionState.js';
import {createApiClient} from './ui/apiClient.js';
import {createRewardView} from './ui/rewards/rewardView.js';
import {createGrowthUI,attachAgeModeFields} from './growthUI.js';
import './style.css';
import {CATEGORY_LABELS} from './presetSchema.mjs';
import {SCENE_SLOTS} from './environmentSchema.mjs';
import './environment.css';
import './child.css';
import { childMarkup, createChildOverlay } from './childLayout.js';
import { createPresetEditor } from './presetEditor.js';
import { createHistoryView } from './history.js';
import { isFreeOriginal } from './upstreamRewards.mjs';
const parent=document.body.dataset.role==='parent';
const role=parent?'parent':'child';
const sessionState=createSessionState(role);
const $=selector=>document.querySelector(selector);
const el=(tag,cls,content)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(content!==undefined)e.textContent=content;return e;};
const labels=CATEGORY_LABELS;
const uid=()=>Array.from(crypto.getRandomValues(new Uint8Array(20)),n=>n.toString(16).padStart(2,'0')).join('');
let growthUI=null,setupAge=null;
let state=null,csrf='',scene=null,sceneLoading=null,category='all',view='shop',catalog=null,online=true,selectedReward=null,toastTimer,catalogRevision='',presetEditor=null,historyView=null,childOverlay=null,rewardPageIndex=0,rewardRenderKey='';
const rewardView=createRewardView({onCategoryChange(value){category=value;rewardPageIndex=0;renderRewards();}});
const operationKeys=new Map();
function keyFor(intent){if(!operationKeys.has(intent))operationKeys.set(intent,uid());return operationKeys.get(intent);}
function toast(message,error=false){const box=$('#toast');box.textContent=message;box.classList.toggle('error',error);box.hidden=false;const popup=$('#purchase-dialog')?.open?$('#purchase-error'):$('#rewards-dialog')?.open?$('#rewards-message'):null;if(popup){popup.textContent=message;popup.hidden=false;popup.classList.toggle('error',error);}clearTimeout(toastTimer);toastTimer=setTimeout(()=>box.hidden=true,5000);}
const api=createApiClient({getCsrf:()=>sessionState.csrf});
async function run(button,work){
  if(button?.dataset.busy)return;
  if(button){button.dataset.busy='true';button.disabled=true;}
  try{await work();}catch(error){toast(error.message,true);if(error.status===401&&csrf)lock();}
  finally{if(button){delete button.dataset.busy;button.disabled=false;}}
}
function lock(){sessionState.clear();operationKeys.clear();rewardView.reset();csrf='';state=null;growthUI?.reset();childOverlay?.close();scene?.dispose();scene=null;sceneLoading=null;document.body.classList.remove('child-active');rewardRenderKey='';presetEditor?.close();historyView?.reset();$('#purchase-dialog')?.close();$('#auth').hidden=false;$('#workspace').hidden=true;$('#login-form').reset();$('#code').focus();}
function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function button(text,action,cls='button'){const b=el('button',cls,text);b.type='button';b.dataset.action=action;return b;}
function statMarkup(){return `<div class="stat"><span>喵币余额</span><strong id="balance">0</strong><small>兑换只使用喵币余额</small></div><div class="stat growth"><span>累计成长经验</span><strong id="lifetime">0</strong><small>不会因为兑换而减少</small></div><div class="stat"><span>已收集奖励</span><strong id="owned-count">0</strong><small>解锁后可以一直使用</small></div>`;}
$('#app').innerHTML=`
<header class="topbar"><a class="brand" href="./"><span class="brand-mark" aria-hidden="true">m.</span><span>Meow<small>每一点努力，都被看见</small></span></a><div class="top-actions"><span class="role-label">${parent?'家长管理':'我的积分小猫'}</span>${parent?'<a href="./">孩子页面 ↗</a>':''}</div></header>
<section id="auth" class="auth-card"><span class="eyebrow">${parent?'PARENT SPACE':'MY LITTLE COMPANION'}</span><h1>${parent?'记录孩子的小小进步':'你好，小伙伴'}</h1><p id="auth-description">${parent?'家长密码只交给大人保管。离开前请锁定页面。':'输入家长给你的进入码，看看小猫的新本领吧。'}</p>
<form id="login-form"><label for="code">${parent?'家长密码':'孩子进入码'}</label><input id="code" name="code" type="password" inputmode="numeric" autocomplete="${parent?'current-password':'off'}" required maxlength="12" pattern="[0-9]{${parent?'6':'4'},12}"><button class="button primary" type="submit">${parent?'进入家长页面':'去见我的小猫'}</button></form>
<form id="setup-form" hidden><p class="note">首次使用：复制启动终端里的一次性口令。家长密码和孩子进入码必须不同。</p><label>一次性初始化口令<input name="setupToken" required autocomplete="off" maxlength="64"></label><div class="form-grid"><label>家长密码（6–12 位数字）<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{6,12}" required autocomplete="new-password"></label><label>孩子进入码（4–12 位数字）<input name="childCode" type="password" inputmode="numeric" pattern="[0-9]{4,12}" required autocomplete="off"></label><label>孩子昵称<input name="childName" value="小朋友" maxlength="20" required></label><label>小猫名字<input name="petName" value="小橘" maxlength="20" required></label></div><button type="submit" class="button primary">创建我们的积分小猫</button></form></section>
<main id="workspace" hidden>${parent?`<div class="page-heading"><div><span class="eyebrow">${parent?'GROW TOGETHER':'A LITTLE BETTER, EVERY DAY'}</span><h1 id="greeting"></h1><p>${parent?'把值得鼓励的事情记下来，让努力变成看得见的成长。':'慢慢积累，慢慢长大。你的每一份努力，小猫都记得。'}</p></div><button type="button" class="button quiet" data-action="logout">${parent?'锁定家长页面':'退出'}</button></div><p id="network" class="network" role="status" hidden>暂时没有连接到服务，正在重连。积分以服务端记录为准。</p><div class="stats">${statMarkup()}</div>
`:""}
${parent?`<nav class="section-tabs" aria-label="家长功能"><button type="button" data-parent-tab="award" aria-selected="true">日常加分</button><button type="button" data-parent-tab="growth">成长记录</button><button type="button" data-parent-tab="catalog">奖励预设</button><button type="button" data-parent-tab="settings">家庭设置</button></nav>
<section id="panel-award"><article class="panel"><span class="eyebrow">NOTICE THE GOOD</span><h2>今天，有什么值得鼓励？</h2><div id="growth-award-mount"></div></article></section><section id="panel-growth" hidden><article class="panel"><div class="panel-title"><h2>积分理由与兑换记录</h2><span class="subtle">服务端完整记录</span></div><div id="appearance-milestone-parent"></div><div id="ledger"></div></article></section>
<section id="panel-catalog" class="panel" hidden><div class="panel-title"><div><h2>设计属于你们的小猫奖励</h2><p>直接调节花色、体型、眼睛、姿态与互动参数，预览后保存到服务端。兑换消耗为 0 时，达到解锁积分后自动获得。</p></div></div><div class="toolbar"><button class="button primary" type="button" data-action="new-preset">新增奖励预设</button><button class="button" type="button" data-action="save-catalog">保存价格与门槛</button><button class="button" type="button" data-action="export-catalog">导出预设 JSON</button><label class="button file-button">导入预设 JSON<input id="catalog-file" type="file" accept="application/json,.json"></label></div><div id="catalog-stale" class="catalog-stale" hidden><p>目录已有新版本，当前未保存的表格修改仍保留。</p><button type="button" class="button small" data-action="reload-catalog">重新读取目录</button></div><p id="catalog-dirty" class="note" hidden>有尚未保存的奖励设置。</p><div class="table-scroll"><table class="catalog-table"><thead><tr><th>奖励</th><th>类别</th><th>兑换价格</th><th>解锁积分</th><th>参数预设</th></tr></thead><tbody id="catalog-body"></tbody></table></div><p class="note">点击“调参数”修改预设，也可以复制成新奖励；这些预设写入服务端数据库。已有奖励的 ID、类别和初始标记不能改变。JSON 导入导出作为可选的批量配置工具。</p></section>
<section id="panel-settings" hidden><div class="local-storage"><strong>服务端数据保存位置</strong><p><code id="local-data-path">正在读取…</code></p><p id="local-data-info"></p><p>积分、加分理由、兑换内容和参数预设保存在运行 Node 服务的机器上的 SQLite 数据库。家庭电脑部署时在家庭电脑，公网服务器部署时在该服务器，不在 Pad 浏览器中，也不会自动同步到 GitHub 或其他第三方。关闭页面、清理浏览器数据不会删除服务端数据库。备份前请停止服务并复制整个数据目录。合影照片不写入此数据库，点击拍照即通过浏览器保存 PNG 文件；网页不建立相册或保存照片副本。</p></div><div class="parent-grid"><article class="panel"><h2>我们的小档案</h2><form id="profile-form"><label>孩子昵称<input name="childName" maxlength="20" required></label><label>小猫名字<input name="petName" maxlength="20" required></label><button class="button primary" type="submit">保存名字</button></form><hr><h3>导出成长记录</h3><p class="note">导出包含全部积分流水、当前装扮和奖励设置，不包含密码。这是可查阅的记录，不是自动恢复文件。</p><button class="button" type="button" data-action="export-progress">下载成长记录 JSON</button></article><article class="panel"><h2>密码与进入码</h2><form id="password-form"><label>当前家长密码<input name="currentPin" type="password" inputmode="numeric" required autocomplete="current-password"></label><label>新家长密码（留空不改）<input name="newPin" type="password" inputmode="numeric" pattern="[0-9]{6,12}" autocomplete="new-password"></label><label>新孩子进入码（留空不改）<input name="childCode" type="password" inputmode="numeric" pattern="[0-9]{4,12}" autocomplete="off"></label><p class="note">修改密码会使对应角色的其他设备退出。家长登录在 15 分钟后自动锁定。</p><button type="submit" class="button primary">更新密码</button></form></article></div></section>`:
childMarkup()}
</main><footer class="site-footer">Meow · 一点点努力，一点点长大 <span>业务数据保存在服务端；合影点击拍照保存为 PNG</span></footer>`;

if(!parent)childOverlay=createChildOverlay({onOpen(nextView){if(nextView!==view){view=nextView;category='all';rewardPageIndex=0;}renderRewards();if(view==='history')historyView?.refresh();}});
historyView=createHistoryView($('#ledger'),{api,parent,paginated:!parent,pageSize:parent?40:5,isActive:()=>parent||!!(childOverlay?.isOpen&&view==='history'),onError:error=>{toast(error.message,true);if(error.status===401&&csrf)lock();},onRecordAction:(record,kind,launcher)=>growthUI?.recordAction(record,kind,launcher),onCategoryChange:value=>growthUI?.historyCategory(value)});
setupAge=attachAgeModeFields($('#setup-form'));
growthUI=createGrowthUI({api,parent,apply,notify:toast,onError:error=>{if(error.status===401&&csrf)lock();},onHistoryRefresh:()=>historyView?.reload(),onHistoryCategory:value=>historyView?.setCategory(value)});
if(parent){const link=el('a','button','生成奖励 / 参数面板');link.href='./studio.html?mode=parent';$('#panel-catalog .toolbar').prepend(link);}
if(parent)presetEditor=createPresetEditor({api,onSaved:(next,nextCatalog)=>{
  catalog=nextCatalog;catalogRevision=next.catalogRevision;apply(next);renderCatalog();
  $('#catalog-dirty').hidden=true;$('#catalog-stale').hidden=true;toast('预设已保存到服务端，孩子页面会自动更新');
}});
function renderLedger(){historyView?.update(state?.ledger[0]?.id);}
function renderAppearanceMilestone(){
  const mount=$(parent?'#appearance-milestone-parent':'#appearance-milestone');
  const {selected,unlockAt,unlocked}=state.appearance;
  const card=el('section','appearance-milestone');card.dataset.unlocked=String(unlocked);
  const heading=el('div','appearance-milestone-heading');
  heading.append(el('strong','', '小猫外观'),el('span','',unlocked?'已解锁 · 可以切换':`累计 ${state.lifetime} / ${unlockAt} 成长分`));
  const description=el('p','',unlocked?(parent?'叶猫外观已经解锁，孩子可以在成长记录中切换。':'叶猫外观已经解锁，可以随时切换。'):`累计成长分达到 ${unlockAt} 时自动解锁叶猫外观。`);
  const options=el('div','appearance-options');
  for(const [id,name] of [['native','原版小猫'],['leaf','叶猫外观']]){
    const option=el(parent?'span':'button','appearance-option',parent&&selected===id?`${name} · 使用中`:name);
    option.dataset.appearance=id;option.dataset.selected=String(selected===id);
    if(!parent){option.type='button';option.dataset.action='appearance';option.disabled=id==='leaf'&&!unlocked;option.setAttribute('aria-pressed',String(selected===id));}
    else if(id==='leaf'&&!unlocked)option.classList.add('locked');
    options.append(option);
  }
  card.append(heading,description,options);mount.replaceChildren(card);
}
async function reloadCatalog(){
  const next=await api('/api/parent/presets');catalog=next.catalog;catalogRevision=next.revision;
  renderCatalog();$('#catalog-dirty').hidden=true;$('#catalog-stale').hidden=true;
}
async function showStorage(){
  const data=await api('/api/parent/storage');$('#local-data-path').textContent=data.path||'测试模式：内存数据库，不用于正式使用';
  $('#local-data-info').textContent=`${data.persistent?'已启用服务端磁盘持久保存':'仅测试使用'} · ${data.ledgerCount} 条流水 · ${data.rewardCount} 项奖励预设`;
}
function allowTableDiscard(){
  if($('#catalog-dirty').hidden)return true;
  if(!confirm('表格里有未保存的价格或门槛。是否放弃这些修改，继续操作？'))return false;
  renderCatalog();$('#catalog-dirty').hidden=true;return true;
}
function renderRewards(){if(!parent)rewardPageIndex=rewardView.render({state,view,category,online,page:rewardPageIndex,overlayOpen:childOverlay?.isOpen});}
async function updateScene(){
  if(parent||!state)return;
  try{
    if(!sceneLoading)sceneLoading=import('./homeScene.js').then(({createHomeScene})=>{if(!state)return;scene=createHomeScene($('#pet-scene'));return scene.ready;});
    await sceneLoading;if(!state)return;
    scene.applyState(state);$('#scene-loading').hidden=true;
  }catch(error){if(!state)return;$('#scene-loading').hidden=false;$('#scene-loading').textContent='三维小猫暂时没有加载成功，请刷新页面重试。积分和收藏仍然保留。';console.error(error);}
}
function apply(next){
  if(state&&next.version<state.version)return;
  const previous=state;state=next;online=true;$('#network').hidden=true;
  $('#balance').textContent=state.balance;$('#lifetime').textContent=state.lifetime;$('#owned-count').textContent=state.rewards.filter(r=>r.owned&&!r.menuOnly).length;
  $('#greeting').textContent=parent?`${state.childName}的成长小花园`:`${state.childName}，今天也很棒`;
  renderLedger();renderAppearanceMilestone();growthUI?.update(state);
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
    select.append(new Option('所有奖励','all'));for(const [id,label]of Object.entries(labels).filter(([id])=>id!=='capability'))select.append(new Option(label,id));
    select.addEventListener('change',()=>{for(const row of $('#catalog-body').children)row.hidden=select.value!=='all'&&row.dataset.category!==select.value;});
    wrap.append(select);$('#panel-catalog .table-scroll').before(wrap);
  }
  $('#catalog-body').replaceChildren();
  for(const reward of catalog.rewards){
    if(reward.category==='capability')continue;
    const tr=el('tr');tr.dataset.category=reward.category;tr.hidden=$('#catalog-filter').value!=='all'&&$('#catalog-filter').value!==reward.category;tr.append(el('td','',reward.title),el('td','',labels[reward.category]));
    for(const field of ['cost','unlockAt']){const td=el('td'),input=el('input');input.type='number';input.min='0';input.max='1000000';input.step='1';input.value=reward[field];input.dataset.rewardId=reward.id;input.dataset.field=field;input.setAttribute('aria-label',`${reward.title}的${field==='cost'?'价格':'解锁积分'}`);input.disabled=!!reward.starter||isFreeOriginal(reward);td.append(input);tr.append(td);}
    const td=el('td'),operations=el('div','catalog-operations');
    for(const [action,label]of (reward.category==='model'?[]:[['edit-preset','调参数'],['copy-preset','复制']])){const b=button(label,action,'button small');b.dataset.id=reward.id;operations.append(b);}
    if(reward.category==='model')operations.append(el('span','subtle','本地模型 · 可在本表调整价格与门槛'));
    td.append(operations);tr.append(td);$('#catalog-body').append(tr);
  }
}
async function enter(result){csrf=sessionState.accept(result).csrf;if(!parent)document.body.classList.add('child-active');$('#auth').hidden=true;$('#workspace').hidden=false;$('#setup-form').hidden=true;$('#login-form').hidden=false;apply(result.state);if(!parent)childOverlay.open('shop');if(parent){$('#profile-form').elements.childName.value=state.childName;$('#profile-form').elements.petName.value=state.petName;await reloadCatalog();await showStorage();}}
$('#login-form').addEventListener('submit',event=>{event.preventDefault();run(event.submitter,async()=>{await enter(await api(`/api/${role}/login`,'POST',{code:$('#code').value}));$('#login-form').reset();});});
$('#setup-form').addEventListener('submit',event=>{event.preventDefault();run(event.submitter,async()=>{await enter(await api('/api/parent/setup','POST',{...Object.fromEntries(new FormData(event.currentTarget)),...setupAge.read()}));$('#setup-form').reset();setupAge.reset();toast('已经准备好啦。把孩子进入码告诉孩子，家长密码请自己保管。');});});
if(parent){
  $('#profile-form').addEventListener('submit',event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));run(event.submitter,async()=>{apply(await api('/api/parent/profile','PUT',data));toast('名字已保存');});});
  $('#password-form').addEventListener('submit',event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));run(event.submitter,async()=>{const result=await api('/api/parent/credentials','PUT',data);csrf=sessionState.accept(result).csrf;$('#password-form').reset();toast('密码已更新，对应角色的其他设备需要重新登录');});});
  $('#catalog-body').addEventListener('input',()=>$('#catalog-dirty').hidden=false);
  $('#catalog-file').addEventListener('change',event=>{const file=event.target.files[0];if(!file)return;if(!allowTableDiscard()){event.target.value='';return;}run(null,async()=>{if(file.size>131072)throw new Error('预设文件不能超过 128 KB');const next=JSON.parse(await file.text());apply(await api('/api/parent/catalog','PUT',next,{'If-Match':catalogRevision}));await reloadCatalog();$('#catalog-dirty').hidden=true;toast('预设已导入并保存');}).finally(()=>event.target.value='');});
}
document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.feature){run(b,async()=>{await updateScene();await scene?.feature(b.dataset.feature);});return;}
  if(b.dataset.parentTab){document.querySelectorAll('[data-parent-tab]').forEach(t=>t.setAttribute('aria-selected',t===b));for(const tab of ['award','growth','catalog','settings'])$(`#panel-${tab}`).hidden=tab!==b.dataset.parentTab;if(b.dataset.parentTab==='settings')run(null,showStorage);return;}
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
      if(catalog.rewards.find(r=>r.id===b.dataset.id)?.category==='creation'){
        location.href=`./studio.html?mode=parent&reward=${encodeURIComponent(b.dataset.id)}${action==='copy-preset'?'&copy=1':''}`;return;
      }
      await presetEditor.open(b.dataset.id||null,action==='copy-preset');
    }
    if(action==='reload-catalog'){if(allowTableDiscard())await reloadCatalog();}
    if(action==='logout'){await api(`/api/${role}/logout`,'POST',{});lock();}
    if(action==='unequip'){apply(await api('/api/unequip','POST',{slot:b.dataset.slot}));childOverlay.close();toast('已卸下场景物品，拥有权仍然保留');}
    if(action==='random-script'){const enabled=b.dataset.enabled==='true';apply(await api('/api/random-script','POST',{rewardId:b.dataset.id,enabled}));toast(enabled?'已加入随机脚本':'已从脚本中删除，兑换状态保留');}
    if(action==='appearance'){apply(await api('/api/appearance','POST',{appearance:b.dataset.appearance}));toast('小猫外观已切换');}
    if(action==='equip'){apply(await api('/api/equip','POST',{rewardId:b.dataset.id}));childOverlay.close();toast('已经应用，回到小猫看看吧');}
    if(action==='play'){const result=await api('/api/play','POST',{rewardId:b.dataset.id});await updateScene();if(!scene)throw new Error('三维小猫尚未准备好，请刷新后重试');childOverlay.close();scene.play(result.action,result.motion);toast(matchMedia('(prefers-reduced-motion: reduce)').matches?'小猫完成了互动（已遵循减少动态效果设置）':'小猫来表演啦');}
    if(action==='confirm-purchase'){const reward=selectedReward;if(!reward)return;const intent=`purchase:${reward.id}:${reward.cost}`;apply(await api('/api/purchase','POST',{rewardId:reward.id,expectedCost:reward.cost,idempotencyKey:keyFor(intent)}));operationKeys.delete(intent);$('#purchase-dialog').close();toast(`已经收藏「${reward.title}」，去试试看吧`);}
    if(action==='save-catalog'){
      const next=structuredClone(catalog);for(const input of document.querySelectorAll('#catalog-body input')){if(!input.checkValidity()||input.value==='')throw new Error('请填写有效的整数价格和成长门槛');next.rewards.find(r=>r.id===input.dataset.rewardId)[input.dataset.field]=Number(input.value);}
      const result=await api('/api/parent/catalog','PUT',next,{'If-Match':catalogRevision});catalog=next;catalogRevision=result.catalogRevision;apply(result);$('#catalog-dirty').hidden=true;$('#catalog-stale').hidden=true;toast('价格与解锁积分已保存到服务端');
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
