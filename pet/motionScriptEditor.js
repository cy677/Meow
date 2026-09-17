import { CLIPS, MOTION_REWARDS, validateScript } from './motionPrograms.mjs';
const element=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
/** Visual sequence editing, not arbitrary JavaScript execution. */
export function createMotionScriptEditor(host,onChange) {
  let rows=[];
  const list=element('div');list.className='motion-step-list';
  const add=element('button','添加动作步骤');add.type='button';add.className='button small';add.dataset.scriptAdd='';
  host.append(element('h3','按顺序编排动作'),element('p','每个步骤选一个骨骼片段，可调整次数和速度。最多 8 步；动作之间自动平滑过渡。'),list,add);
  function select(choices,value,label){const e=element('select');e.setAttribute('aria-label',label);for(const [id,name]of choices){const o=element('option',name);o.value=id;e.append(o);}e.value=value;return e;}
  function render(){list.replaceChildren();rows.forEach((r,i)=>{
    const row=element('div');row.className='motion-step';row.dataset.scriptStep=String(i);
    const clip=select(CLIPS.map(c=>[c.id,c.name]),r.clip,`步骤 ${i+1} 动作`);
    const cycles=select([1,2,3,4].map(n=>[String(n),`${n} 次`]),String(r.cycles),`步骤 ${i+1} 次数`);
    cycles.disabled=!CLIPS.find(c=>c.id===r.clip)?.loop;
    const speed=select([.5,.75,1,1.25,1.5,2].map(n=>[String(n),`${n} 倍速`]),String(r.speed),`步骤 ${i+1} 速度`);
    if(!speed.value){const option=element('option',`${r.speed} 倍速`);option.value=String(r.speed);speed.append(option);speed.value=String(r.speed);}
    clip.addEventListener('change',()=>{r.clip=clip.value;if(!CLIPS.find(c=>c.id===r.clip).loop)r.cycles=1;render();onChange();});
    cycles.addEventListener('change',()=>{r.cycles=Number(cycles.value);onChange();});speed.addEventListener('change',()=>{r.speed=Number(speed.value);onChange();});
    const operations=element('div');operations.className='motion-step-actions';
    for(const [label,delta]of [['上移',-1],['下移',1],['删除',0]]){const button=element('button',label);button.type='button';button.className='button small';button.disabled=delta===-1?i===0:delta===1?i===rows.length-1:rows.length===1;button.addEventListener('click',()=>{if(delta)[rows[i],rows[i+delta]]=[rows[i+delta],rows[i]];else rows.splice(i,1);render();onChange();});operations.append(button);}
    row.append(element('span',String(i+1)),clip,cycles,speed,operations);list.append(row);
  });add.disabled=rows.length>=8;}
  add.addEventListener('click',()=>{if(rows.length<8){rows.push({clip:'walk',cycles:1,speed:1});render();onChange();}});
  return {read(){return validateScript(rows);},set(script){rows=structuredClone(script??[{clip:'idle-alert',cycles:1,speed:1},{clip:'walk',cycles:2,speed:1},{clip:'sit',cycles:1,speed:1}]);render();}};
}

/** Parent-only UI extension uses the existing versioned catalog API and application callback. */
export function installMotionSamples({api,onSaved}) {
  const toolbar=document.querySelector('#panel-catalog .toolbar');if(!toolbar)return;
  const button=element('button','添加骨骼动作奖励');button.type='button';button.className='button';button.dataset.motionAddRewards='';toolbar.append(button);
  const message=element('p');message.className='note';message.setAttribute('role','status');toolbar.after(message);
  button.addEventListener('click',async()=>{
    if(button.disabled)return;
    const dirty=document.querySelector('#catalog-dirty');
    if(dirty&&!dirty.hidden){message.textContent='请先保存表格中尚未保存的价格和门槛，再添加示例动作。';return;}
    button.disabled=true;
    try{
      const latest=await api('/api/parent/presets'),next=structuredClone(latest.catalog);
      const extras=MOTION_REWARDS.filter(r=>!next.rewards.some(existing=>existing.id===r.id));
      if(!extras.length){message.textContent='示例动作奖励已存在，可以直接调参数。';return;}
      next.rewards.push(...extras);
      const result=await api('/api/parent/catalog','PUT',next,{'If-Match':latest.revision});onSaved(result,next);
      document.querySelector('#catalog-stale').hidden=true;
      message.textContent=`已添加 ${extras.length} 项骨骼动作奖励，已有积分、价格与拥有权保持不变。`;
    }catch(error){message.textContent=error.message;}finally{button.disabled=false;}
  });
}
