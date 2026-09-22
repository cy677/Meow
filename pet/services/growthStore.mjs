import { createGrowthSummary } from './growthSummary.mjs';
import { createGrowthRepository } from '../repositories/growthRepository.mjs';
import { randomUUID } from 'node:crypto';
import { fail, object, text, integer } from '../validation.mjs';
import { DEFAULT_GROWTH_TASKS, GROWTH_CATEGORIES, GROWTH_MODES, SCORE_LEVELS, categoryOf, modeOf } from '../growthCatalog.mjs';

const scores = [0,1,2,3,5];
const decodeTask = row => row ? {...JSON.parse(row.definition),revision:row.revision,active:!!row.active,archived:!!row.archived} : null;
function score(n) { if(!scores.includes(n))fail(400,'请选择仅记录或 +1、+2、+3、+5'); return n; }
function bool(value,name) { if(typeof value!=='boolean')fail(400,`${name}必须为布尔值`); return value; }
export function validateGrowthProfile(input, previous=null) {
  object(input,['age','mode','enrolled','timeZone','expectedRevision']);
  const age=input.age===undefined?previous?.age:integer(input.age,'孩子周岁',3,10);
  const mode=input.mode??previous?.mode;
  if(age===undefined||!modeOf(mode))fail(400,'请由家长填写3—10岁年龄并确认成长模式');
  const enrolled=input.enrolled===undefined?(previous?.enrolled??false):bool(input.enrolled,'入学情况');
  const timeZone=input.timeZone??previous?.timeZone??'UTC';
  if(typeof timeZone!=='string'||timeZone.length>80)fail(400,'时区无效');
  try { new Intl.DateTimeFormat('en',{timeZone}).format(); } catch { fail(400,'时区无效'); }
  return {age,mode,enrolled,timeZone,revision:(previous?.revision??0)+1};
}
function validateTask(input) {
  object(input,['id','title','category','modes','points','condition','assistance','reasonExample','frequency','dailyLimit','steps','sourceIds','active','archived','expectedRevision']);
  const id=input.id??`custom-${randomUUID()}`;
  if(typeof id!=='string'||!/^[a-z][a-z0-9_-]{2,80}$/.test(id))fail(400,'成长项目 ID 无效');
  if(!categoryOf(input.category))fail(400,'请选择六个成长分类之一');
  if(!Array.isArray(input.modes)||!input.modes.length||input.modes.length>3||input.modes.some(m=>!modeOf(m)))fail(400,'项目适用模式无效');
  if(!['daily','once'].includes(input.frequency))fail(400,'计分频次无效');
  const steps=input.steps??[];
  if(!Array.isArray(steps)||steps.length>12)fail(400,'项目步骤最多12项');
  const ids=new Set();
  const checkedSteps=steps.map(s=>{
    object(s,['id','title','points']);
    const sid=text(s.id,'步骤 ID',64);
    if(!/^[a-z0-9_-]+$/.test(sid)||ids.has(sid))fail(400,'步骤 ID 无效或重复');ids.add(sid);
    return {id:sid,title:text(s.title,'步骤名称',100),points:score(s.points)};
  });
  return {id,title:text(input.title,'项目名称',80),category:input.category,modes:[...new Set(input.modes)],
    points:checkedSteps.length?checkedSteps.reduce((n,s)=>n+s.points,0):score(input.points),
    condition:text(input.condition,'完成条件',400),assistance:text(input.assistance,'允许的帮助',200),
    reasonExample:text(input.reasonExample??'','理由示例',120,0),frequency:checkedSteps.length?'once':input.frequency,
    dailyLimit:integer(input.dailyLimit??1,'每日计分次数',1,4),steps:checkedSteps,
    sourceIds:[],active:bool(input.active??false,'启用状态'),archived:bool(input.archived??false,'归档状态')};
}

/** Extends the existing SQLite account; never deletes/reprices/reclassifies legacy data. */
export function createGrowthStore({db,tx,mutate,bump,log,getSetting,setSetting,snapshot}) {
  const repo = createGrowthRepository(db);
  tx(()=>{
    repo.initialize();
    const insert=repo.seedTask;
    for(const task of DEFAULT_GROWTH_TASKS)insert(task.id,JSON.stringify(task));
  });
  const profile=()=>JSON.parse(getSetting('growthProfile')||'null');
  const requireProfile=()=>{const p=profile();if(!p)fail(409,'请先由家长补全年龄与成长模式，旧积分和记录仍保留');return p;};
  const audit=(kind,detail)=>repo.audit(randomUUID(),kind,JSON.stringify(detail),new Date().toISOString());
  const task=id=>decodeTask(repo.task(id));
  function day(iso,p=requireProfile()) {
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:p.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso));
    const get=type=>parts.find(x=>x.type===type).value;return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function occurred(value) {
    if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))fail(400,'请提供含时区的行为发生时间');
    const time=Date.parse(value);if(time>Date.now()+300000||time<Date.UTC(2000,0,1))fail(400,'行为时间不能在未来或早于2000年');return new Date(time).toISOString();
  }
  const count = repo.count;
  function checkFrequency(t,date,stepId='') {
    if(count(t,date,stepId)>=(t.steps.length||t.frequency==='once'?1:t.dailyLimit))fail(409,'这个约定或步骤已经记录，不会重复计分；误录请使用更正');
  }
  function revision(t,expected) { if(expected!==t.revision)fail(409,'项目已在其他页面修改，请重新查看完成条件再确认'); }
  function read(parent=false,{days=7}={}) {
    integer(days,'统计天数',1,365);const p=profile();
    const now=new Date().toISOString(),today=p?day(now,p):now.slice(0,10);
    const tasks=repo.tasks().map(decodeTask).filter(t=>parent||t.active&&!t.archived).map(t=>({...t,
      recorded:count(t,today),completedSteps:t.steps.filter(s=>count(t,today,s.id)>0).map(s=>s.id)}));
    const since=new Date(Date.parse(today+'T00:00:00Z')-(days-1)*86400000).toISOString().slice(0,10);
    const rows=repo.categorySummary(since,today);
    const submissions=repo.pending().map(r=>({...r,snapshot:JSON.parse(r.snapshot)}));
    const recent=repo.recent().map(r=>({...r,growthSnapshot:JSON.parse(r.growthSnapshot||'null')}));
    return {profile:p,tasks,submissions,recent,days,since,today,
      summary:GROWTH_CATEGORIES.map(c=>({category:c.id,...(rows.find(r=>r.category===c.id)||{count:0,points:0})})),
      ...(parent?{unclassified:repo.unclassifiedCount().n}:{}),version:repo.version().version};
  }
  function initialize(p) { setSetting('growthProfile',JSON.stringify(p));audit('profile',p); }
  function configure(input) {
    object(input,['age','mode','enrolled','timeZone','expectedRevision']);
    tx(()=>{const previous=profile();if(previous&&input.expectedRevision!==previous.revision)fail(409,'年龄或模式已在另一页面修改，请重新读取');const p=validateGrowthProfile(input,previous);initialize(p);bump();});
    return snapshot(true);
  }
  function saveTask(input) {
    const clean=validateTask(input);
    tx(()=>{
      requireProfile();const old=task(clean.id);
      if(old)revision(old,input.expectedRevision);
      else {if(input.expectedRevision!==undefined&&input.expectedRevision!==0)fail(409,'项目不存在');if(repo.taskCount().n>=250)fail(409,'项目库已达250项，请编辑已有项目');}
      if(old?.steps.length&&repo.hasTaskHistory(old.id)&&JSON.stringify(old.steps)!==JSON.stringify(clean.steps))fail(409,'已有记录的多日项目不能改写步骤，请复制成新项目');
      const {active,archived,...definition}=clean;
      definition.sourceIds=old?.sourceIds??[];
      repo.saveTask(clean.id,JSON.stringify(definition),(old?.revision??0)+1,active&&!archived?1:0,archived?1:0);
      audit('task', {previous:old,next:clean});bump();
    });return read(true);
  }
  function award(input) {
    object(input,['taskId','category','title','expectedRevision','delta','reason','occurredAt','assistance','scoreReason','basisConfirmed','stepId','submissionId','idempotencyKey']);
    const delta=score(input.delta),reason=text(input.reason??'','具体理由',120,input.taskId?0:1),at=occurred(input.occurredAt);
    const scoreReason=text(input.scoreReason??'','分值调整依据',120,0);
    mutate(input.idempotencyKey,{operation:'growth-award',...input},()=>{
      const p=requireProfile(),date=day(at,p);let t=null,submission=null;
      if(input.submissionId){submission=repo.submission(input.submissionId);if(!submission||submission.status!=='pending')fail(409,'这条提交已处理或不存在');t=JSON.parse(submission.snapshot);
        if(submission.taskId!==input.taskId||submission.stepId!==(input.stepId??'')||submission.occurredAt!==at)fail(409,'提交内容不一致，请重新打开待确认记录');
      } else if(input.taskId){t=task(input.taskId);if(!t||t.archived)fail(404,'成长项目不存在或已归档');revision(t,input.expectedRevision);}
      const category=t?.category??input.category;if(!categoryOf(category))fail(400,'请选择六个成长分类之一');
      const title=t?.title??text(input.title,'行动名称',80);let agreed=t?.points??2;
      if(t){
        if(t.steps.length){const s=t.steps.find(s=>s.id===input.stepId);if(!s)fail(400,'请指定多日项目中的一个步骤，不能重复领取总分');agreed=s.points;}
        else if(input.stepId)fail(400,'此项目没有多日步骤');
        checkFrequency(t,date,input.stepId);
        const pending=repo.pendingForTask(t.id,input.stepId??'',date,t.frequency);
        if(pending&&pending.id!==submission?.id)fail(409,'孩子已提交这项行动，请从待确认记录处理，避免重复加分');
      }
      if(t?.steps.length&&delta!==agreed&&delta!==0)fail(400,'多日项目按预先约定的步骤积分结算');
      const account=repo.account();
      if(account.balance+delta>10000000||account.lifetime+delta>10000000)fail(409,'积分已达上限');
      repo.addPoints(delta,delta);
      const evidence={schemaVersion:1,title,category,mode:p.mode,age:p.age,task:t,stepId:input.stepId??'',scoreReason,agreedPoints:agreed,awardedPoints:delta,actor:'parent'};
      const defaultReason=t?.steps.length?`${title} · ${t.steps.find(s=>s.id===input.stepId).title}`:title;
      const id=log(delta?'earn':'observation',delta,reason||defaultReason,null,{growthCategory:category,growthSnapshot:evidence,taskId:t?.id??null,occurredAt:at,awardDay:date});
      if(submission)repo.settleSubmission(delta?'approved':'recorded',id,submission.id);
    });return snapshot(true);
  }
  function submit(input) {
    object(input,['taskId','expectedRevision','reason','occurredAt','stepId','idempotencyKey']);
    const reason=text(input.reason??'','完成说明',120,0),at=occurred(input.occurredAt);
    mutate(input.idempotencyKey,{operation:'growth-submit',...input},()=>{
      const p=requireProfile();if(p.mode==='preschool')fail(403,'学前模式由家长陪伴记录');
      const t=task(input.taskId);if(!t||!t.active||t.archived)fail(403,'只能提交当前启用的目标');revision(t,input.expectedRevision);
      const stepId=input.stepId??'';
      if(t.steps.length?!t.steps.some(s=>s.id===stepId):!!stepId)fail(400,'项目步骤无效');
      const date=day(at,p);checkFrequency(t,date,stepId);
      if(repo.hasPending(t.id,stepId,date,t.frequency))fail(409,'已经提交，请和家长一起确认，不会重复加分');
      repo.saveSubmission(randomUUID(),t.id,JSON.stringify(t),reason,at,date,stepId,'pending',new Date().toISOString());
    });return snapshot();
  }
  function cancelSubmission(input) {
    object(input,['id','reason','idempotencyKey']);const reason=text(input.reason,'处理说明',120);
    mutate(input.idempotencyKey,{operation:'growth-cancel',...input},()=>{const r=repo.submission(input.id);if(!r||r.status!=='pending')fail(409,'提交已处理');repo.cancelSubmission(r.id);audit('submission-cancel',{id:r.id,reason});});return snapshot(true);
  }
  function classify(input) {
    object(input,['recordId','category','reason','idempotencyKey']);if(!categoryOf(input.category))fail(400,'请选择六类之一');const why=text(input.reason,'归类依据',120);
    mutate(input.idempotencyKey,{operation:'growth-classify',...input},()=>{
      const r=repo.ledgerRecord(input.recordId);if(!r||!['earn','observation'].includes(r.kind)||r.growthCategory!==null)fail(409,'仅可归类尚未分类的旧成长记录');
      const p=requireProfile();repo.classifyRecord(input.category,JSON.stringify({schemaVersion:1,legacy:true,title:r.reason,classificationReason:why,actor:'parent'}),r.createdAt,day(r.createdAt,p),r.id);
      audit('legacy-classification',{recordId:r.id,category:input.category,reason:why});
    });return snapshot(true);
  }
  function correct(input) {
    object(input,['recordId','reason','points','idempotencyKey']);const why=text(input.reason,'误录更正原因',120);
    const points=integer(input.points??0,'更正后的分值',0,10000);
    mutate(input.idempotencyKey,{operation:'growth-correct',...input},()=>{
      const r=repo.earnedRecord(input.recordId);
      if(!r||repo.hasCorrection(r.id))fail(409,'记录不存在或已经更正');
      const previous=JSON.parse(r.growthSnapshot||'{}')||{};
      const credited=Math.max(previous.creditedPoints??r.delta,r.delta),extra=Math.max(0,points-credited);
      const {balance,lifetime}=repo.account();
      if(balance+points-r.delta<0)fail(409,'更正所需的积分已被使用，请先核对；不会透支或自动回收已拥有物品');
      if(balance+points-r.delta>10000000||lifetime+extra>10000000)fail(409,'积分已达上限');
      repo.addPoints(points-r.delta,extra);
      const correctionId=log('adjustment',-r.delta,why,null,{growthSnapshot:{correctionOf:r.id,originalReason:r.reason,originalPoints:r.delta,correctedPoints:points,actor:'parent'}});
      repo.saveCorrection(r.id,correctionId);
      const replacementId=points?log('earn',points,r.reason,null,{growthCategory:r.growthCategory,taskId:r.taskId,occurredAt:r.occurredAt,awardDay:r.awardDay,growthSnapshot:{...previous,correctionOf:r.id,originalReason:r.reason,correctionReason:why,awardedPoints:points,creditedPoints:Math.max(credited,points),actor:'parent'}}):null;
      audit('correction',{recordId:r.id,correctionId,replacementId,originalPoints:r.delta,points,reason:why});
    });return snapshot(true);
  }
  return {summary:createGrowthSummary({repo,profile}),profile,initialize,configure,read,saveTask,award,submit,cancelSubmission,classify,correct,
    exportData(){return {schemaVersion:1,profile:profile(),tasks:repo.tasks().map(decodeTask),submissions:repo.submissions().map(r=>({...r,snapshot:JSON.parse(r.snapshot)})),audit:repo.audits(),corrections:repo.corrections()};}};
}
