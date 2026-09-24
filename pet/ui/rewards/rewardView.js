import {rewardPage} from '../../rewardPages.mjs';
import {SCENE_SLOTS} from '../../environmentSchema.mjs';
import {CATEGORY_LABELS as labels} from '../../presetSchema.mjs';
const $=selector=>document.querySelector(selector);
const el=(tag,cls,content)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(content!==undefined)e.textContent=content;return e;};
const button=(text,action,cls='button')=>{const b=el('button',cls,text);b.type='button';b.dataset.action=action;return b;};
const icons={model:'✿',coat:'◒',shape:'☁',eyes:'◉',pose:'♧',trick:'✦',creation:'✿',capability:'✧',floor:'▤',rug:'▧',bed:'⌂',toy:'●',weather:'☂',lighting:'☀',camera:'◎',effect:'≋',theme:'✿'};
export function createRewardView({onCategoryChange}) {
  let rewardRenderKey='';
function render({state,view,category,online,page,overlayOpen}){
  let rewardPageIndex=page;
  if(!state)return page;
  $('#reward-panel').hidden=view==='history';$('#history-panel').hidden=view!=='history';
  $('#reward-panel').setAttribute('aria-labelledby',`tab-${view==='owned'?'owned':'shop'}`);
  document.querySelectorAll('[data-view]').forEach(b=>{b.setAttribute('aria-selected',b.dataset.view===view);b.tabIndex=b.dataset.view===view?0:-1;});
  const result=rewardPage(state.rewards.filter(r=>!r.menuOnly),{category,ownedOnly:view==='owned',page:rewardPageIndex});rewardPageIndex=result.page;
  const key=JSON.stringify([view,category,rewardPageIndex,online,state.rewards]);
  if(key===rewardRenderKey)return rewardPageIndex;rewardRenderKey=key;
  const focused=document.activeElement;const focusId=focused?.dataset.id,focusCategory=focused?.dataset.category;
  if(!$('#categories').children.length){
    for(const [value,name]of [['all','全部'],...Object.entries(labels).filter(([id])=>!SCENE_SLOTS.includes(id)&&!['theme','capability'].includes(id))]){const b=button(name,'category','chip');b.dataset.category=value;$('#categories').append(b);}
    const select=el('select','scene-filter');select.id='scene-category';select.setAttribute('aria-label','场景布置分类');
    select.append(new Option('场景布置…',''));for(const slot of [...SCENE_SLOTS,'theme'].filter(s=>!['weather','lighting'].includes(s)))select.append(new Option(labels[slot],slot));
    select.addEventListener('change',()=>{if(!select.value)return;onCategoryChange(select.value);});
    $('#categories').append(select);
  }
  $('#scene-category').value=[...SCENE_SLOTS,'theme'].includes(category)?category:'';
  $('#categories').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.category===category));
  const root=$('#reward-grid');root.replaceChildren();root.dataset.page=String(result.page+1);root.dataset.pages=String(result.pages);
  $('#reward-prev').disabled=result.page===0;$('#reward-next').disabled=result.page>=result.pages-1;
  $('#reward-page-status').textContent=`第 ${result.page+1} / ${result.pages} 页 · 共 ${result.total} 项`;
  if(!result.items.length)root.append(el('p','empty','这里还没有收藏。去发现一份喜欢的奖励吧。'));
  for(const reward of result.items){
    const scriptReward=['pose','trick'].includes(reward.category);
    const card=el('article',`reward-card ${reward.owned?'is-owned':reward.eligible?'':'is-locked'}`);card.dataset.rewardId=reward.id;
    const art=el('div',`reward-art art-${reward.category}`);art.append(el('span','',icons[reward.category]),el('small','',labels[reward.category]));
    if(reward.category==='model'){
      const image=el('img','model-reward-thumbnail');image.src=`./models/kenney/previews/${reward.modelId}.png`;image.alt=reward.title;image.loading='eager';
      image.addEventListener('error',()=>image.remove(),{once:true});art.prepend(image);
      art.querySelector('small').textContent=reward.modelGroup;
    }
    art.append(el('span','reward-tag',reward.basicAction?'基础动作 · 默认可用':scriptReward&&reward.owned?(reward.inRandomScript?'已加入脚本':'已兑换'):reward.equipped?'使用中':reward.owned?'已收藏':reward.eligible?'可以兑换':'成长解锁'));
    const content=el('div','reward-content');content.append(el('h3','',reward.title),el('p','',reward.description));
    const foot=el('div','reward-foot');foot.append(el('strong','',reward.basicAction?'无需解锁':reward.owned?'永久拥有':reward.cost===0?'成长礼物':`${reward.cost} 积分`));
    let b;
    if(reward.owned){
      const canRemove=(SCENE_SLOTS.includes(reward.category)||reward.category==='model')&&reward.equipped&&!reward.starter;
      b=button(canRemove?'卸下':reward.category==='trick'?'已加入随机脚本':reward.equipped?'正在使用':reward.category==='theme'?'应用整套':'换上它',canRemove?'unequip':reward.category==='trick'?'play':'equip','button small');
      b.dataset.slot=reward.modelSlot||reward.category;b.disabled=reward.category==='trick'||(!canRemove&&reward.equipped)||!online;
      if(scriptReward){
        b.textContent=reward.inRandomScript?'从脚本中删除':'加入随机脚本';
        b.dataset.action='random-script';b.dataset.enabled=String(!reward.inRandomScript);b.disabled=!online;
        b.setAttribute('aria-pressed',String(!!reward.inRandomScript));
      }
    }
    else if(!reward.eligible){b=button(`还差 ${reward.unlockAt-state.lifetime} 成长分`,'purchase','button small');b.disabled=true;}
    else{b=button(reward.affordable?'兑换':'余额不足','purchase','button small');b.disabled=!reward.affordable||!online;}
    b.dataset.id=reward.id;foot.append(b);content.append(foot);card.append(art,content);root.append(card);
  }
  // Polling must not tear focus away from a keyboard user or a purchase confirmation.
  if(overlayOpen&&!$('#purchase-dialog').open&&focusId){const replacement=[...root.querySelectorAll('button')].find(b=>b.dataset.id===focusId);if(replacement&&!replacement.disabled)replacement.focus({preventScroll:true});}
  if(focusCategory&&!focused.isConnected)$('#categories').querySelector(`[data-category="${focusCategory}"]`)?.focus({preventScroll:true});
  return rewardPageIndex;
}
  return {render,reset(){rewardRenderKey='';}};
}
