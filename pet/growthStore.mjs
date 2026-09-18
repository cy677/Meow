import { randomUUID } from 'node:crypto';
import { fail, object, text, integer } from './validation.mjs';
import { DEFAULT_GROWTH_TASKS, GROWTH_CATEGORIES, GROWTH_MODES, SCORE_LEVELS, categoryOf, modeOf } from './growthCatalog.mjs';

const scores = [0,1,2,3,5];
const decodeTask = row => row ? {...JSON.parse(row.definition),revision:row.revision,active:!!row.active,archived:!!row.archived} : null;
const validRecord = "NOT EXISTS (SELECT 1 FROM growth_corrections c WHERE c.ledgerId=l.id)";
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
  tx(()=>{
    db.exec(`CREATE TABLE IF NOT EXISTS growth_tasks(id TEXT PRIMARY KEY,definition TEXT NOT NULL,revision INTEGER NOT NULL,active INTEGER NOT NULL,archived INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS growth_submissions(id TEXT PRIMARY KEY,taskId TEXT NOT NULL,snapshot TEXT NOT NULL,reason TEXT NOT NULL,occurredAt TEXT NOT NULL,awardDay TEXT NOT NULL,stepId TEXT NOT NULL,status TEXT NOT NULL,ledgerId TEXT,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS growth_audit(id TEXT PRIMARY KEY,kind TEXT NOT NULL,detail TEXT NOT NULL,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS growth_corrections(ledgerId TEXT PRIMARY KEY,correctionId TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS growth_submissions_pending ON growth_submissions(taskId,status,awardDay);`);
    const insert=db.prepare('INSERT OR IGNORE INTO growth_tasks VALUES (?,?,1,0,0)');
    for(const task of DEFAULT_GROWTH_TASKS)insert.run(task.id,JSON.stringify(task));
  });
  const profile=()=>JSON.parse(getSetting('growthProfile')||'null');
  const requireProfile=()=>{const p=profile();if(!p)fail(409,'请先由家长补全年龄与成长模式，旧积分和记录仍保留');return p;};
  const audit=(kind,detail)=>db.prepare('INSERT INTO growth_audit VALUES (?,?,?,?)').run(randomUUID(),kind,JSON.stringify(detail),new Date().toISOString());
  const task=id=>decodeTask(db.prepare('SELECT * FROM growth_tasks WHERE id=?').get(id));
  function day(iso,p=requireProfile()) {
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:p.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso));
    const get=type=>parts.find(x=>x.type===type).value;return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function occurred(value) {
    if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))fail(400,'请提供含时区的行为发生时间');
    const time=Date.parse(value);if(time>Date.now()+300000||time<Date.UTC(2000,0,1))fail(400,'行为时间不能在未来或早于2000年');return new Date(time).toISOString();
  }
  function count(t,date,stepId='') {
    const vals=[t.id],clauses=['l.taskId=?',"l.kind IN ('earn','observation')",validRecord];
    if(t.steps.length){clauses.push("json_extract(l.growthSnapshot,'$.stepId')=?");vals.push(stepId);}
    else if(t.frequency==='daily'){clauses.push('l.awardDay=?');vals.push(date);}
    return db.prepare('SELECT count(*) AS n FROM ledger l WHERE '+clauses.join(' AND ')).get(...vals).n;
  }
  function checkFrequency(t,date,stepId='') {
    if(count(t,date,stepId)>=(t.steps.length||t.frequency==='once'?1:t.dailyLimit))fail(409,'这个约定或步骤已经记录，不会重复计分；误录请使用更正');
  }
  function revision(t,expected) { if(expected!==t.revision)fail(409,'项目已在其他页面修改，请重新查看完成条件再确认'); }
  function read(parent=false,{days=7}={}) {
    integer(days,'统计天数',1,365);const p=profile();
    const now=new Date().toISOString(),today=p?day(now,p):now.slice(0,10);
    const tasks=db.prepare('SELECT * FROM growth_tasks ORDER BY rowid').all().map(decodeTask).filter(t=>parent||t.active&&!t.archived).map(t=>({...t,
      recorded:count(t,today),completedSteps:t.steps.filter(s=>count(t,today,s.id)>0).map(s=>s.id)}));
    const since=new Date(Date.parse(today+'T00:00:00Z')-(days-1)*86400000).toISOString().slice(0,10);
    const rows=db.prepare(`SELECT growthCategory AS category,count(*) AS count,COALESCE(sum(delta),0) AS points FROM ledger l WHERE growthCategory IS NOT NULL AND awardDay>=? AND awardDay<=? AND kind IN ('earn','observation') AND ${validRecord} GROUP BY growthCategory`).all(since,today);
    const submissions=db.prepare("SELECT * FROM growth_submissions WHERE status='pending' ORDER BY createdAt LIMIT 100").all().map(r=>({...r,snapshot:JSON.parse(r.snapshot)}));
    const recent=db.prepare(`SELECT id,reason,delta,occurredAt,createdAt,growthCategory,growthSnapshot FROM ledger l WHERE growthCategory IS NOT NULL AND kind IN ('earn','observation') AND ${validRecord} ORDER BY rowid DESC LIMIT 100`).all().map(r=>({...r,growthSnapshot:JSON.parse(r.growthSnapshot||'null')}));
    return {profile:p,tasks,submissions,recent,days,since,today,
      summary:GROWTH_CATEGORIES.map(c=>({category:c.id,...(rows.find(r=>r.category===c.id)||{count:0,points:0})})),
      ...(parent?{unclassified:db.prepare("SELECT count(*) AS n FROM ledger WHERE kind IN ('earn','observation') AND growthCategory IS NULL").get().n}:{}),version:db.prepare('SELECT version FROM profile WHERE id=1').get().version};
  }
  function initialize(p) { setSetting('growthProfile',JSON.stringify(p));audit('profile',p); }
  function configure(input) {
    tx(()=>{const previous=profile();if(previous&&input.expectedRevision!==previous.revision)fail(409,'年龄或模式已在另一页面修改，请重新读取');const p=validateGrowthProfile(input,previous);initialize(p);bump();});
    return snapshot(true);
  }
  function saveTask(input) {
    const clean=validateTask(input);
    tx(()=>{
      requireProfile();const old=task(clean.id);
      if(old)revision(old,input.expectedRevision);
      else {if(input.expectedRevision!==undefined&&input.expectedRevision!==0)fail(409,'项目不存在');if(db.prepare('SELECT count(*) AS n FROM growth_tasks').get().n>=250)fail(409,'项目库已达250项，请编辑已有项目');}
      if(old?.steps.length&&db.prepare('SELECT 1 FROM ledger WHERE taskId=? LIMIT 1').get(old.id)&&JSON.stringify(old.steps)!==JSON.stringify(clean.steps))fail(409,'已有记录的多日项目不能改写步骤，请复制成新项目');
      const {active,archived,...definition}=clean;
      definition.sourceIds=old?.sourceIds??[];
      db.prepare('INSERT INTO growth_tasks VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition,revision=excluded.revision,active=excluded.active,archived=excluded.archived').run(clean.id,JSON.stringify(definition),(old?.revision??0)+1,active&&!archived?1:0,archived?1:0);
      audit('task', {previous:old,next:clean});bump();
    });return read(true);
  }
  function award(input) {
    object(input,['taskId','category','title','expectedRevision','delta','reason','occurredAt','assistance','scoreReason','basisConfirmed','stepId','submissionId','idempotencyKey']);
    const delta=score(input.delta),reason=text(input.reason,'具体理由',120),at=occurred(input.occurredAt);
    if(input.basisConfirmed!==true)fail(400,'请先确认完成条件已说明，且记录的是具体行动');
    const assistance=text(input.assistance??'按约定提供帮助','完成时的帮助',200),scoreReason=text(input.scoreReason??'','分值调整依据',120,0);
    mutate(input.idempotencyKey,{operation:'growth-award',...input},()=>{
      const p=requireProfile(),date=day(at,p);let t=null,submission=null;
      if(input.submissionId){submission=db.prepare('SELECT * FROM growth_submissions WHERE id=?').get(input.submissionId);if(!submission||submission.status!=='pending')fail(409,'这条提交已处理或不存在');t=JSON.parse(submission.snapshot);
        if(submission.taskId!==input.taskId||submission.stepId!==(input.stepId??'')||submission.occurredAt!==at)fail(409,'提交内容不一致，请重新打开待确认记录');
      } else if(input.taskId){t=task(input.taskId);if(!t||t.archived)fail(404,'成长项目不存在或已归档');revision(t,input.expectedRevision);}
      const category=t?.category??input.category;if(!categoryOf(category))fail(400,'请选择六个成长分类之一');
      const title=t?.title??text(input.title,'行动名称',80);let agreed=t?.points??2;
      if(t){
        if(t.steps.length){const s=t.steps.find(s=>s.id===input.stepId);if(!s)fail(400,'请指定多日项目中的一个步骤，不能重复领取总分');agreed=s.points;}
        else if(input.stepId)fail(400,'此项目没有多日步骤');
        checkFrequency(t,date,input.stepId);
        const pending=db.prepare("SELECT id FROM growth_submissions WHERE taskId=? AND stepId=? AND status='pending' AND (awardDay=? OR ?='once')").get(t.id,input.stepId??'',date,t.frequency);
        if(pending&&pending.id!==submission?.id)fail(409,'孩子已提交这项行动，请从待确认记录处理，避免重复加分');
      }
      if(t?.steps.length&&delta!==agreed&&delta!==0)fail(400,'多日项目按预先约定的步骤积分结算');
      if(delta!==agreed&&delta!==0&&!scoreReason)fail(400,'调整默认分值时，请填写事先约定的加分依据；成人帮助不是减分理由');
      const account=db.prepare('SELECT balance,lifetime FROM profile WHERE id=1').get();
      if(account.balance+delta>10000000||account.lifetime+delta>10000000)fail(409,'积分已达上限');
      db.prepare('UPDATE profile SET balance=balance+?,lifetime=lifetime+? WHERE id=1').run(delta,delta);
      const evidence={schemaVersion:1,title,category,mode:p.mode,age:p.age,task:t,stepId:input.stepId??'',assistance,scoreReason,agreedPoints:agreed,awardedPoints:delta,actor:'parent',basisConfirmed:true};
      const id=log(delta?'earn':'observation',delta,reason,null,{growthCategory:category,growthSnapshot:evidence,taskId:t?.id??null,occurredAt:at,awardDay:date});
      if(submission)db.prepare('UPDATE growth_submissions SET status=?,ledgerId=? WHERE id=?').run(delta?'approved':'recorded',id,submission.id);
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
      if(db.prepare("SELECT 1 FROM growth_submissions WHERE taskId=? AND stepId=? AND status='pending' AND (awardDay=? OR ?='once')").get(t.id,stepId,date,t.frequency))fail(409,'已经提交，请和家长一起确认，不会重复加分');
      db.prepare('INSERT INTO growth_submissions VALUES (?,?,?,?,?,?,?,?,NULL,?)').run(randomUUID(),t.id,JSON.stringify(t),reason,at,date,stepId,'pending',new Date().toISOString());
    });return snapshot();
  }
  function cancelSubmission(input) {
    object(input,['id','reason','idempotencyKey']);const reason=text(input.reason,'处理说明',120);
    mutate(input.idempotencyKey,{operation:'growth-cancel',...input},()=>{const r=db.prepare('SELECT * FROM growth_submissions WHERE id=?').get(input.id);if(!r||r.status!=='pending')fail(409,'提交已处理');db.prepare("UPDATE growth_submissions SET status='cancelled' WHERE id=?").run(r.id);audit('submission-cancel',{id:r.id,reason});});return snapshot(true);
  }
  function classify(input) {
    object(input,['recordId','category','reason','idempotencyKey']);if(!categoryOf(input.category))fail(400,'请选择六类之一');const why=text(input.reason,'归类依据',120);
    mutate(input.idempotencyKey,{operation:'growth-classify',...input},()=>{
      const r=db.prepare('SELECT * FROM ledger WHERE id=?').get(input.recordId);if(!r||!['earn','observation'].includes(r.kind)||r.growthCategory!==null)fail(409,'仅可归类尚未分类的旧成长记录');
      const p=requireProfile();db.prepare('UPDATE ledger SET growthCategory=?,growthSnapshot=?,occurredAt=?,awardDay=? WHERE id=?').run(input.category,JSON.stringify({schemaVersion:1,legacy:true,title:r.reason,classificationReason:why,actor:'parent'}),r.createdAt,day(r.createdAt,p),r.id);
      audit('legacy-classification',{recordId:r.id,category:input.category,reason:why});
    });return snapshot(true);
  }
  function correct(input) {
    object(input,['recordId','reason','idempotencyKey']);const why=text(input.reason,'误录更正原因',120);
    mutate(input.idempotencyKey,{operation:'growth-correct',...input},()=>{
      const r=db.prepare("SELECT * FROM ledger WHERE id=? AND kind IN ('earn','observation')").get(input.recordId);
      if(!r||db.prepare('SELECT 1 FROM growth_corrections WHERE ledgerId=?').get(r.id))fail(409,'记录不存在或已经更正');
      const {balance}=db.prepare('SELECT balance FROM profile WHERE id=1').get();if(balance<r.delta)fail(409,'该误录积分已被使用，请先核对；不会透支或自动回收已拥有物品');
      db.prepare('UPDATE profile SET balance=balance-? WHERE id=1').run(r.delta);
      const correctionId=log('adjustment',-r.delta,why,null,{growthSnapshot:{correctionOf:r.id,originalReason:r.reason,actor:'parent'}});
      db.prepare('INSERT INTO growth_corrections VALUES (?,?)').run(r.id,correctionId);audit('correction',{recordId:r.id,correctionId,reason:why});
    });return snapshot(true);
  }
  return {profile,initialize,configure,read,saveTask,award,submit,cancelSubmission,classify,correct,
    exportData(){return {schemaVersion:1,profile:profile(),tasks:db.prepare('SELECT * FROM growth_tasks ORDER BY rowid').all().map(decodeTask),submissions:db.prepare('SELECT * FROM growth_submissions ORDER BY createdAt').all().map(r=>({...r,snapshot:JSON.parse(r.snapshot)})),audit:db.prepare('SELECT * FROM growth_audit ORDER BY rowid').all(),corrections:db.prepare('SELECT * FROM growth_corrections').all()};}};
}
