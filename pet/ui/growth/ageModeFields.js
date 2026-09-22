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

/** Age is deliberately blank until a parent chooses it; a recommendation is not a diagnosis. */
export function attachAgeModeFields(form,profile=null){
  const box=node('fieldset','growth-age');box.append(node('legend','','年龄与成长模式'));
  const age=select([['','请选择孩子周岁'],...Array.from({length:8},(_,i)=>[i+3,`${i+3}岁`])],'age');age.required=true;
  const enrolled=select([['false','尚未进入小学'],['true','已进入小学']],'enrolled');
  const mode=select([['','请家长确认成长模式'],...M.map(m=>[m.id,m.name])],'mode');mode.required=true;
  const hint=node('p','note');const enrollment=label('入学情况（帮助推荐，不锁定模式）',enrolled);
  box.append(label('孩子年龄（必填，不收集完整生日）',age),enrollment,label('适用模式（由家长决定）',mode),hint);
  let manual=!!profile;
  function update(recommend=false){enrollment.hidden=age.value!=='6';const rec=age.value?modeOf(recommendMode(Number(age.value),enrolled.value==='true')):null;if(recommend&&!manual&&rec)mode.value=rec.id;
    hint.textContent=rec?`年龄建议：${rec.name}。${modeOf(mode.value)?.description||''} 模式不是能力等级，成人帮助不减分。`:'请先填写年龄。可依据实际需要选择模式，不按每个年龄单独评分。';}
  age.addEventListener('change',()=>update(true));enrolled.addEventListener('change',()=>update(true));mode.addEventListener('change',()=>{manual=true;update();});
  if(profile){age.value=String(profile.age);mode.value=profile.mode;enrolled.value=String(profile.enrolled);}
  const anchor=form.querySelector('button[type=submit]');if(anchor)anchor.before(box);else form.append(box);update();
  return {read:()=>({age:Number(age.value),mode:mode.value,enrolled:enrolled.value==='true',timeZone:profile?.timeZone||zone(),...(profile?{expectedRevision:profile.revision}:{})}),reset(){manual=false;age.value='';mode.value='';enrolled.value='false';update();}};
}
