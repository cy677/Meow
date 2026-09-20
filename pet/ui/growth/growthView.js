import '../../growth.css';
import {GROWTH_CATEGORIES as C, GROWTH_MODES as M, SCORE_LEVELS, categoryOf, modeOf, recommendMode} from '../../growthCatalog.mjs';
const node=(tag,cls='',value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=value;return n;};
const btn=(label,work,cls='button small')=>{const b=node('button',cls,label);b.type='button';if(work)b.addEventListener('click',work);return b;};
const select=(items,name)=>{const n=node('select');n.name=name;for(const [id,title] of items)n.add(new Option(title,id));return n;};
const label=(title,control)=>{const l=node('label','',title);l.append(control);return l;};
const field=(name,value='',max=120)=>{const n=node('input');n.name=name;n.value=value;n.maxLength=max;return n;};
const scoreSelect=name=>select([[0,'仅记录，不加分'],...SCORE_LEVELS.map(s=>[s.points,`＋${s.points} · ${s.name}`])],name);
const id=()=>Array.from(crypto.getRandomValues(new Uint8Array(20)),x=>x.toString(16).padStart(2,'0')).join('');
const localTime=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
const zone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
const values=f=>Object.fromEntries(new FormData(f));
const taskPayload=t=>Object.fromEntries(['id','title','category','modes','points','condition','assistance','reasonExample','frequency','dailyLimit','steps','active','archived'].map(k=>[k,t[k]]));

import {createGrowthApi} from './growthApi.js';
import {attachAgeModeFields} from './ageModeFields.js';
/** Isolated growth UI; never owns balances or modifies the native cat renderer. */
export function createGrowthUI({api,parent,apply,notify,onError,onHistoryRefresh}){
  let data=null,version=-1,sequence=0,busyLoad=false,selectedCategory=C[0].id,selectedTask=null,pending=null,dialogLauncher=null;
  const intents=new Map();
  const dialog=node('dialog','growth-dialog');dialog.id='growth-dialog';dialog.setAttribute('aria-labelledby','growth-dialog-title');
  const heading=node('header','growth-dialog-heading'),title=node('h2','','成长花园');title.id='growth-dialog-title';
  const close=btn('关闭 ×',()=>dialog.close());heading.append(title,close);
  const message=node('p','growth-message');message.setAttribute('role','status');message.hidden=true;
  const body=node('div','growth-dialog-body');dialog.append(heading,message,body);document.body.append(dialog);
  const signal=open=>document.getElementById('pet-scene')?.dispatchEvent(new CustomEvent('meow:overlay-change',{detail:open}));
  dialog.addEventListener('close',()=>{signal(false);if(dialogLauncher?.isConnected&&!document.getElementById('workspace').hidden)dialogLauncher.focus({preventScroll:true});});
  function show(titleText,launch){title.textContent=titleText;message.hidden=true;body.replaceChildren();dialogLauncher=launch||document.activeElement;if(!dialog.open){dialog.showModal();signal(true);}}
  function feedback(text,error=false){notify(text,error);message.textContent=text;message.hidden=false;message.classList.toggle('error',error);if(parent&&status){status.textContent=text;status.classList.toggle('error',error);}}
  async function action(button,work){if(button?.disabled)return;if(button)button.disabled=true;try{await work();}catch(e){feedback(e.message,true);onError?.(e);}finally{if(button?.isConnected)button.disabled=false;}}
  async function write(path,payload,method='POST'){
    const signature=JSON.stringify([path,payload]);if(method==='POST'){if(!intents.has(signature))intents.set(signature,id());payload={...payload,idempotencyKey:intents.get(signature)};}
    const next=await api(path,method,payload);intents.delete(signature);if(next.rewards)apply(next);version=-1;await refresh(true);onHistoryRefresh?.();return next;
  }
  const endpoint=parent?'/api/parent/growth':'/api/growth';
  const growthApi=createGrowthApi(api,{parent});
  let awardForm,status,taskSelect,delta,reason,basis,scoreReason,when,manualTitle,steps,categoryBar,profileBox,pendingBox,summaryBox,modeBadge;
  if(parent){
    const panel=document.querySelector('#panel-award > article');panel.replaceChildren();panel.classList.add('growth-award-panel');
    const top=node('div','panel-title');top.append(node('h2','','记录具体行动'));modeBadge=node('span','growth-mode');top.append(modeBadge);panel.append(top);
    profileBox=node('div','growth-profile');panel.append(profileBox);
    categoryBar=node('div','growth-category-choices');categoryBar.setAttribute('aria-label','六个成长分类');
    for(const c of C){const b=btn(`${c.icon} ${c.childName}`,()=>{selectedCategory=c.id;pending=null;refreshTaskOptions();chooseTask();},`growth-category category-${c.id}`);b.dataset.growthCategory=c.id;b.setAttribute('aria-pressed','false');categoryBar.append(b);}panel.append(categoryBar);
    awardForm=node('form','growth-award-form');awardForm.id='growth-award-form';
    taskSelect=select([['','自定义单次行动']],'taskId');taskSelect.id='growth-task';taskSelect.addEventListener('change',()=>{pending=null;chooseTask();});
    const taskLine=node('div','growth-task-line');const allModes=node('input');allModes.type='checkbox';allModes.id='growth-all-modes';
    allModes.addEventListener('change',()=>{refreshTaskOptions();chooseTask();});taskLine.append(label('项目库',taskSelect),label('查看其他模式项目',allModes));awardForm.append(taskLine);
    manualTitle=field('title','',80);manualTitle.id='growth-title';awardForm.append(label('本次行动名称（自定义时必填）',manualTitle));
    steps=select([['','请选择本次完成的步骤']],'stepId');steps.addEventListener('change',()=>{const s=selectedTask?.steps.find(s=>s.id===steps.value);if(s)delta.value=s.points;showScore();});awardForm.append(label('项目步骤',steps));
    basis=node('section','growth-basis');basis.id='growth-basis';basis.setAttribute('aria-label','家长加分依据');awardForm.append(basis);
    delta=scoreSelect('delta');delta.id='delta';delta.value='2';delta.addEventListener('change',showScore);
    scoreReason=field('scoreReason','',120);scoreReason.id='growth-score-reason';
    reason=field('reason');reason.id='reason';reason.required=true;
    when=field('occurredAt',localTime());when.type='datetime-local';when.required=true;when.id='growth-occurred';
    const grid=node('div','form-grid');grid.append(label('本次分值',delta),label('行动发生时间（与录入时间分开）',when));awardForm.append(grid,label('调整默认分值的依据（非临时加码）',scoreReason),label('具体理由（必填）',reason));
    status=node('p','growth-message');status.setAttribute('role','status');awardForm.append(status);
    const submit=node('button','button primary','确认成长记录');submit.id='award-submit';submit.type='submit';awardForm.append(submit);
    awardForm.addEventListener('submit',event=>{event.preventDefault();action(submit,async()=>{
      if(!data?.profile)throw new Error('请先由家长补充年龄并确认模式');
      if(!selectedTask&&!manualTitle.value.trim())throw new Error('请填写本次行动名称，不能只输入空格');
      if(selectedTask&&!reason.value.trim())throw new Error('请填写加分理由，不能只输入空格');
      const payload={delta:Number(delta.value),reason:selectedTask?reason.value.trim():'',occurredAt:pending?.occurredAt||new Date(when.value).toISOString(),scoreReason:selectedTask?scoreReason.value.trim():'',
        ...(selectedTask?{taskId:selectedTask.id,expectedRevision:selectedTask.revision,...(selectedTask.steps.length?{stepId:steps.value}:{})}:{category:selectedCategory,title:manualTitle.value.trim()}),
        ...(pending?{submissionId:pending.id}:{})};
      await write('/api/parent/growth/award',payload);reason.value='';scoreReason.value='';when.value=localTime();pending=null;chooseTask();feedback(payload.delta?`已保存：＋${payload.delta}喵币与成长经验。`:'成长回忆已保存，没有改变喵币与经验。');
    });});panel.append(awardForm);
    const tools=node('div','toolbar');tools.append(btn('目标与项目库',e=>openLibrary(e.currentTarget)),btn('修改年龄 / 模式',e=>openProfile(e.currentTarget)));panel.append(tools);
    pendingBox=node('section','growth-pending');panel.append(pendingBox);
    summaryBox=node('section','growth-summary');document.querySelector('#panel-settings').prepend(summaryBox);
  }else{
    const launch=btn('✿ 成长花园',e=>openGarden(e.currentTarget),'button child-growth-garden');launch.id='open-growth';launch.setAttribute('aria-haspopup','dialog');launch.setAttribute('aria-controls','growth-dialog');document.querySelector('.child-dock').prepend(launch);
  }
  function refreshTaskOptions(){
    const old=taskSelect.value;taskSelect.replaceChildren(new Option('自定义单次行动',''));
    const all=document.getElementById('growth-all-modes').checked;
    for(const t of data?.tasks||[]){if(t.category!==selectedCategory||t.archived||(!all&&!t.active&&!t.modes.includes(data?.profile?.mode)))continue;taskSelect.add(new Option(`${t.active?'当前目标 · ':''}${t.title}`,t.id));}
    if([...taskSelect.options].some(o=>o.value===old))taskSelect.value=old;
    else if(taskSelect.options.length>1)taskSelect.selectedIndex=1;
    categoryBar.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.growthCategory===selectedCategory));
  }
  function chooseTask(){
    selectedTask=pending?.snapshot||(data?.tasks||[]).find(t=>t.id===taskSelect.value)||null;
    manualTitle.parentElement.hidden=!!selectedTask;manualTitle.required=!selectedTask;
    reason.required=!!selectedTask;reason.parentElement.hidden=!selectedTask;
    steps.replaceChildren(new Option('请选择本次完成的步骤',''));for(const s of selectedTask?.steps||[])steps.add(new Option(`${s.title}（＋${s.points}）`,s.id));steps.parentElement.hidden=!selectedTask?.steps.length;steps.required=!!selectedTask?.steps.length;
    if(pending){steps.value=pending.stepId;const d=new Date(pending.occurredAt);when.value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);when.disabled=true;}else when.disabled=false;
    const agreed=pending?.stepId?selectedTask.steps.find(s=>s.id===pending.stepId)?.points:selectedTask?.points;
    delta.value=String(selectedTask?.steps.length&&!pending?.stepId?0:agreed??2);
    reason.placeholder='';
    basis.replaceChildren();basis.hidden=!selectedTask;
    if(selectedTask)basis.append(node('p','',`完成条件：${selectedTask.condition}`));
    showScore();
  }
  function showScore(){
    const agreed=selectedTask?.steps.length?selectedTask.steps.find(s=>s.id===steps.value)?.points:selectedTask?.points??2;
    scoreReason.required=!!selectedTask&&Number(delta.value)!==0&&Number(delta.value)!==agreed;scoreReason.parentElement.hidden=!scoreReason.required;

  }
  function openProfile(launcher){show('年龄与成长模式',launcher);const form=node('form');const fields=attachAgeModeFields(form,data?.profile);form.append(node('p','note','只更新年龄不会自动更换已确认模式。切换模式保留目标、项目、积分、记录和收藏；推荐项目由家长另行选择。'));
    const submit=node('button','button primary','确认并保存');submit.type='submit';form.append(submit);form.addEventListener('submit',e=>{e.preventDefault();action(submit,async()=>{await write('/api/parent/growth/profile',fields.read(),'PUT');refreshTaskOptions();if(!reason.value.trim())chooseTask();dialog.close();feedback('年龄和模式已保存，历史与已启用目标保持不变。');});});body.append(form);}

  function openLibrary(launcher){
    show('目标与项目库',launcher);if(!data?.profile){body.append(node('p','','请先设置孩子年龄与模式。'));return;}
    const toolbar=node('div','toolbar'),filterMode=select([[data.profile.mode,`推荐：${modeOf(data.profile.mode).name}`],['all','全部模式'],['active','当前目标']],'library-mode'),filterCategory=select([['all','全部六类'],...C.map(c=>[c.id,c.name])],'library-category');
    filterMode.id='library-mode';filterCategory.id='library-category';toolbar.append(filterMode,filterCategory,btn('新增自定义项目',()=>editTask(null)),btn('返回加分',()=>dialog.close()));
    const count=node('p','note',`当前启用 ${data.tasks.filter(t=>t.active&&!t.archived).length} 项；建议先选${data.profile.mode==='school_advanced'?'2—3':'1—2'}项，不要求六类每天打卡。暂停目标和模式切换都保留已得积分。`),list=node('div','growth-library');body.append(toolbar,count,list);
    function render(){list.replaceChildren();for(const t of data.tasks){if(t.archived||filterCategory.value!=='all'&&t.category!==filterCategory.value||filterMode.value==='active'&&!t.active||!['all','active'].includes(filterMode.value)&&!t.modes.includes(filterMode.value))continue;
      const card=node('article','growth-task-card');card.dataset.taskId=t.id;card.append(node('h3','',`${categoryOf(t.category).icon} ${t.title}`),node('p','',t.condition),node('small','',`${t.steps.length?`${t.steps.length}步骤 · 合计${t.points}`:`默认＋${t.points}`} · ${t.active?'当前目标':'项目库'} · ${t.assistance}`));
      const ops=node('div','toolbar');ops.append(btn(t.active?'暂停目标':'启用目标',e=>action(e.currentTarget,async()=>{await write('/api/parent/growth/tasks',{...taskPayload(t),active:!t.active,expectedRevision:t.revision},'PUT');openLibrary(launcher);})),btn('修改规则',()=>editTask(t)),btn('复制',()=>editTask(t,true)),btn('归档',e=>action(e.currentTarget,async()=>{if(!confirm('归档后不再推荐，已得积分、记录和待确认提交保留。继续？'))return;await write('/api/parent/growth/tasks',{...taskPayload(t),archived:true,active:false,expectedRevision:t.revision},'PUT');openLibrary(launcher);})));card.append(ops);list.append(card);}
      if(!list.children.length)list.append(node('p','empty','这里没有项目。可以调整筛选或新增自定义项目。'));}
    filterMode.addEventListener('change',render);filterCategory.addEventListener('change',render);render();
  }
  function editTask(t,copy=false){
    show(copy?'复制为新项目':t?'修改项目规则':'新增自定义项目');const form=node('form','growth-task-editor');
    const name=field('title',copy?`${t.title}（副本）`:t?.title||'',80);name.required=true;
    const category=select(C.map(c=>[c.id,c.name]),'category');category.value=t?.category||selectedCategory;
    const points=scoreSelect('points');points.value=String(t?.points??2);
    const condition=node('textarea');condition.name='condition';condition.maxLength=400;condition.required=true;condition.value=t?.condition||'';
    const help=field('assistance',t?.assistance||'允许提醒、清单、共同完成和主动求助；成人协助不自动减分。',200);
    const frequency=select([['daily','按日记录'],['once','只记录一次 / 多日项目']],'frequency');frequency.value=t?.frequency||'daily';
    const limit=select([1,2,3,4].map(n=>[n,`每天最多${n}次`]),'dailyLimit');limit.value=String(t?.dailyLimit??1);
    const active=node('input');active.type='checkbox';active.checked=copy?false:!!t?.active;
    const modeBox=node('fieldset');modeBox.append(node('legend','','推荐模式（可以多选）'));const modes=M.map(m=>{const c=node('input');c.type='checkbox';c.value=m.id;c.checked=(t?.modes||[data.profile.mode]).includes(m.id);modeBox.append(label(m.name,c));return c;});
    const stepBox=node('fieldset','growth-steps');stepBox.append(node('legend','','多日小项目（可选；学前模式默认不使用）'),node('p','note','按步骤分别结算，不额外发放总分。已有记录的项目不能改写步骤，请复制成新项目。'));
    const stepRows=node('div');const stepInputs=[];
    function addStep(s={}){if(stepInputs.length>=12)return;const row=node('div','growth-step-row'),title=field('stepTitle',s.title||'',80),score=scoreSelect('stepPoints');score.value=String(s.points??1);title.placeholder='步骤名称；留空不使用';row.append(title,score);stepRows.append(row);stepInputs.push({id:s.id||`step-${stepInputs.length+1}`,title,score});}
    for(const s of t?.steps||[])addStep(s);stepBox.append(stepRows,btn('增加一个步骤',()=>addStep()));
    form.append(label('项目名称',name),label('主分类（同一行动只记一次）',category),label('默认分值',points),label('完成条件（具体、适龄，开始前讲清）',condition),label('允许的帮助',help),modeBox,label('计分频次',frequency),label('日计分次数',limit),stepBox,label('加入当前目标',active));
    const submit=node('button','button primary','保存项目');submit.type='submit';form.append(submit,btn('返回项目库',()=>openLibrary()));body.append(form);
    form.addEventListener('submit',e=>{e.preventDefault();action(submit,async()=>{const chosen=stepInputs.filter(s=>s.title.value.trim()).map(s=>({id:s.id,title:s.title.value.trim(),points:Number(s.score.value)}));
      const payload={...(t&&!copy?{id:t.id,expectedRevision:t.revision}:{}),title:name.value,category:category.value,modes:modes.filter(c=>c.checked).map(c=>c.value),points:chosen.length?chosen.reduce((n,s)=>n+s.points,0):Number(points.value),condition:condition.value,assistance:help.value,reasonExample:t?.reasonExample||'',frequency:chosen.length?'once':frequency.value,dailyLimit:Number(limit.value),steps:chosen,active:active.checked,archived:false};
      await write('/api/parent/growth/tasks',payload,'PUT');openLibrary();feedback('项目已保存；过去的完成条件和分值快照不变。');});});
  }
  function renderPending(){pendingBox.replaceChildren(node('h3','',`孩子提交 · 待确认 ${data.submissions.length}`));if(!data.submissions.length){pendingBox.append(node('p','note','孩子的提交不会直接增加积分。'));return;}
    for(const r of data.submissions){const card=node('article','growth-pending-card');card.append(node('strong','',r.snapshot.title),node('p','',r.reason||'孩子提交了完成情况，等待一起确认。'),node('small','',new Date(r.occurredAt).toLocaleString('zh-CN')));
      card.append(btn('查看依据并确认',()=>{pending=r;selectedCategory=r.snapshot.category;refreshTaskOptions();if(![...taskSelect.options].some(o=>o.value===r.taskId))taskSelect.add(new Option(r.snapshot.title,r.taskId));taskSelect.value=r.taskId;chooseTask();reason.value=r.reason;awardForm.scrollIntoView({behavior:'instant',block:'center'});feedback('使用孩子提交时的规则快照。请核对并补充具体理由后确认。');}),btn('暂不计分并处理',e=>action(e.currentTarget,async()=>{const why=prompt('填写处理说明（不扣分、不删除已得奖励）');if(!why)return;await write('/api/parent/growth/cancel',{id:r.id,reason:why});feedback('这条提交已处理，余额未改变。');})));pendingBox.append(card);}
  }
  function renderSummary(){summaryBox.replaceChildren(node('h2','','家庭成长记录分布'),node('p','note','这是家庭记录过的行动，不代表孩子的能力或健康水平；不要求六类数量相等。'));
    const range=select([[7,'近7天'],[30,'近30天']],'range');range.value=String(data.days);range.addEventListener('change',()=>action(range,async()=>{data=await growthApi.read(Number(range.value));renderSummary();}));summaryBox.append(range);
    const grid=node('div','growth-summary-grid');for(const c of C){const r=data.visualization.categoryStats.find(r=>r.category===c.id);const card=node('article',`growth-summary-card category-${c.id}`);card.append(node('strong','',`${c.icon} ${c.name}`),node('p','',`${r.count}条记录 · ${r.points}积分`));grid.append(card);}summaryBox.append(grid,node('p','note',`统计日期 ${data.since} 至 ${data.today} · 家庭时区 ${data.profile?.timeZone||'未设置'} · 待归类旧记录 ${data.unclassified} 条。旧记录由家长在记录列表手动归类，不推断儿童表现。`));
  }
  function renderParent(initial=false){
    modeBadge.textContent=data.profile?`${data.profile.age}岁 · ${modeOf(data.profile.mode).name}`:'待家长设置';profileBox.replaceChildren();
    if(!data.profile){profileBox.append(node('p','growth-notice','旧版数据已保留。请家长补充孩子年龄与成长模式，系统不会替您猜测。'),btn('设置年龄与模式',e=>openProfile(e.currentTarget)));}
    if(initial){refreshTaskOptions();chooseTask();}renderPending();renderSummary();
  }
  let gardenCategory='all',gardenPage=0;
  function openGarden(launcher){show('我的成长花园',launcher);renderGarden();}
  function renderGarden(){body.replaceChildren();if(!data){body.append(node('p','','成长记录正在读取，请稍后重新打开。'));return;}
    body.append(node('p','growth-garden-intro',data.profile?`${modeOf(data.profile.mode).name} · 每一张贴纸，都是一个小故事。`:'请家长先设置年龄和模式。你仍然可以和小猫一起玩。'));
    const garden=node('div','growth-garden');for(const c of C){const rec=data.recent.find(r=>r.growthCategory===c.id);const card=btn('',()=>{gardenCategory=c.id;gardenPage=0;renderGarden();},`growth-garden-card category-${c.id}`);card.dataset.gardenCategory=c.id;card.setAttribute('aria-pressed',gardenCategory===c.id);card.append(node('span','growth-garden-icon',c.icon),node('h3','',c.childName),node('small','',c.scene),node('p','',rec?rec.reason:'这里留给你的成长故事'));garden.append(card);}body.append(garden);
    const targets=node('section','growth-child-targets');targets.append(node('h3','','正在练习的小目标'));
    const active=data.tasks.filter(t=>t.active&&!t.archived);if(!active.length)targets.append(node('p','note','和家长一起选择一两件想练习的事，也可以暂时不选。'));
    for(const t of active){const card=node('article','growth-task-card');card.append(node('strong','',`${categoryOf(t.category).icon} ${t.title}`),node('p','',t.condition));
      const waiting=data.submissions.filter(r=>r.taskId===t.id);
      if(data.profile?.mode==='preschool')card.append(node('small','','和家长一起试试；需要帮助也没关系。'));
      else{const options=t.steps.length?t.steps:[{id:'',title:'我完成了',points:t.points}];for(const step of options){const done=t.steps.length?t.completedSteps.includes(step.id):t.recorded>=(t.frequency==='once'?1:t.dailyLimit),pending=waiting.some(r=>r.stepId===step.id);const b=btn(done?`${step.title} · 已记录`:pending?`${step.title} · 等家长确认`:t.steps.length?`${step.title} · 我完成了`:'我完成了',e=>submitChild(t,step,e.currentTarget));b.disabled=done||pending;card.append(b);}}
      targets.append(card);}body.append(targets);
    const history=node('section','growth-stories');history.append(node('h3','',gardenCategory==='all'?'成长回忆':`${categoryOf(gardenCategory).childName}的回忆`),btn('查看全部六类',()=>{gardenCategory='all';gardenPage=0;renderGarden();}));
    const records=data.recent.filter(r=>gardenCategory==='all'||r.growthCategory===gardenCategory);const pages=Math.max(1,Math.ceil(records.length/5));gardenPage=Math.min(gardenPage,pages-1);
    for(const r of records.slice(gardenPage*5,gardenPage*5+5)){const row=node('article','growth-story');row.append(node('span','growth-sticker',categoryOf(r.growthCategory).icon),node('p','',r.reason),node('small','',`${new Date(r.occurredAt||r.createdAt).toLocaleDateString('zh-CN')} · ${r.delta?`＋${r.delta}喵币`:'成长回忆'}`));history.append(row);}
    if(!records.length)history.append(node('p','note','现在还没有记录，花园会一直在这里。'));
    const pager=node('div','toolbar'),prev=btn('上一页',()=>{gardenPage--;renderGarden();}),next=btn('下一页',()=>{gardenPage++;renderGarden();});prev.disabled=gardenPage===0;next.disabled=gardenPage>=pages-1;pager.append(prev,node('span','',`第${gardenPage+1}/${pages}页`),next);history.append(pager,node('p','note','这里展示最近100条分类回忆；更早的完整记录可在宝藏屋“成长记录”中查询。'));body.append(history);
  }
  function submitChild(t,step,button){action(button,async()=>{const reason=prompt('分享你做了什么（也可以留空，不需要透露隐私）','');if(reason===null)return;
    // The intent key and timestamp stay frozen on retries of this submission dialog.
    const payload={taskId:t.id,expectedRevision:t.revision,reason,occurredAt:new Date().toISOString(),...(step.id?{stepId:step.id}:{})};await write('/api/growth/submit',payload);renderGarden();feedback('已告诉家长啦，确认后才会记录积分。');});}
  async function recordAction(record,kind,launcher){
    show(kind==='classify'?'给旧成长记录归类':'更正误录',launcher);const form=node('form');form.append(node('p','',record.reason));const category=select(C.map(c=>[c.id,c.name]),'category');if(kind==='classify')form.append(label('只选择一个主类别',category));
    const reason=field('reason');reason.required=true;form.append(label(kind==='classify'?'归类依据（不再发放积分）':'误录原因（不能用作表现惩罚）',reason));
    const points=field('points',String(record.delta));points.type='number';points.min='0';points.max='10000';points.step='1';points.required=true;
    if(kind==='correct')form.append(label('更正后的分值（0 表示撤销）',points),node('p','note','余额按新旧分值的差额调整，保留原流水、更正原因和已拥有物品。降低分值不扣累计经验，增加分值只补尚未计入的经验；余额不足时拒绝处理。'));
    const submit=node('button','button primary','确认保存');submit.type='submit';form.append(submit);body.append(form);form.addEventListener('submit',e=>{e.preventDefault();action(submit,async()=>{await write(`/api/parent/growth/${kind}`,{recordId:record.id,reason:reason.value,...(kind==='classify'?{category:category.value}:{points:Number(points.value)})});dialog.close();feedback(kind==='classify'?'旧记录已归类，余额未改变。':'误录已更正，原记录与更正依据已保留。');});});
  }
  async function refresh(force=false){if(busyLoad&&!force)return;const ticket=++sequence;busyLoad=true;try{const next=await growthApi.read(data?.days||7);if(ticket!==sequence)return;const initial=!data;data=next;version=next.version;
      document.body.dataset.growthMode=data.profile?.mode||'preschool';if(parent)renderParent(initial);else if(dialog.open&&title.textContent==='我的成长花园')renderGarden();
    }catch(e){if(ticket===sequence){version=-1;feedback(`成长数据读取失败：${e.message}`,true);onError?.(e);}}finally{if(ticket===sequence)busyLoad=false;}}
  return {update(state){if(state&&version!==state.version&&!busyLoad)void refresh();},refresh,recordAction,
    reset(){sequence++;busyLoad=false;data=null;version=-1;selectedTask=null;pending=null;intents.clear();dialog.close();body.replaceChildren();if(parent){reason.value='';status.textContent='';profileBox.replaceChildren();pendingBox.replaceChildren();summaryBox.replaceChildren();}delete document.body.dataset.growthMode;}};
}
