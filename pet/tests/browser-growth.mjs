/** Real browser regression for the shared local account and age-aware growth UI. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createPetServer} from '../server.mjs';
const app=await createPetServer({dbPath:':memory:'});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${app.server.address().port}`;
const out=new URL('../test-results/',import.meta.url);mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const parentContext=await browser.newContext({viewport:{width:1180,height:820},hasTouch:true});
const childContext=await browser.newContext({viewport:{width:1180,height:820},hasTouch:true});
const parent=await parentContext.newPage(),child=await childContext.newPage();
const errors=[],checks=[],external=[];for(const p of [parent,child]){p.setDefaultTimeout(60000);p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin+'/'))external.push(r.url());});}
const mark=s=>{checks.push(s);console.log('PASS',s);};
const screenshot=(p,name)=>p.screenshot({path:fileURLToPath(new URL(name+'.png',out)),fullPage:true});
async function close(){await parent.locator('#growth-dialog .growth-dialog-heading button').click();}
try{
  await parent.goto(origin+'/parent.html');await parent.locator('#setup-form').waitFor({state:'visible'});
  for(const [name,value]of Object.entries({setupToken:app.setupToken,pin:'864209',childCode:'2468',childName:'小朋友',petName:'小橘'}))await parent.locator(`#setup-form [name=${name}]`).fill(value);
  assert.equal(await parent.locator('#setup-form [name=age]').inputValue(),'');
  await parent.locator('#setup-form [name=age]').selectOption('6');assert.equal(await parent.locator('#setup-form [name=mode]').inputValue(),'preschool');
  await parent.locator('#setup-form [name=enrolled]').selectOption('true');assert.equal(await parent.locator('#setup-form [name=mode]').inputValue(),'school_basic');
  await screenshot(parent,'growth-initialization');await parent.locator('#setup-form button[type=submit]').click();await parent.locator('#workspace').waitFor({state:'visible'});
  await parent.waitForFunction(()=>document.querySelector('#growth-task').options.length>1);mark('家长初始化填年龄，6岁入学推荐，模式可确认');
  assert.equal(await parent.locator('[data-growth-category]').count(),6);assert.deepEqual(await parent.locator('#delta option').evaluateAll(os=>os.map(o=>o.value)),['0','1','2','3','5']);
  assert.equal(app.store.growth.read(true).tasks.length,66);assert.equal(app.store.growth.read().tasks.length,0);
  // Select the agreed preset explicitly; the initial custom-action choice requires its own title.
  await parent.locator('#growth-task').selectOption('school_basic-health-1');
  assert.match(await parent.locator('#growth-basis').innerText(),/完成条件/);assert.equal(await parent.locator('#growth-basis').isVisible(),true);
  await screenshot(parent,'growth-parent');mark('六类、66条示例、默认四档和家长加分依据');
  await parent.locator('#reason').fill('今天和家长一起完成了约定的卫生准备');await parent.locator('#award-submit').click();
  await parent.waitForFunction(()=>document.querySelector('#balance').textContent==='2');assert.equal(app.store.snapshot().lifetime,2);mark('帮助不减分，喵币与经验同时入账');
  await parent.getByRole('button',{name:'目标与项目库',exact:true}).click();assert.equal(await parent.locator('.growth-library .growth-task-card').count(),18);
  await parent.locator('.growth-library .growth-task-card').nth(1).getByRole('button',{name:'启用目标',exact:true}).click();
  await parent.waitForFunction(()=>document.querySelector('.growth-dialog-body').textContent.includes('当前启用 1 项'));await screenshot(parent,'growth-targets');await close();mark('学龄基础推荐18条，目标少量启用');
  await parent.getByRole('button',{name:'家长加分指南',exact:true}).click();assert.equal(await parent.locator('.growth-source').count(),5);assert.match(await parent.locator('.growth-dialog-body').innerText(),/不是指南规定/);await screenshot(parent,'growth-parent-guide');await close();mark('指南离线展示，参考来源与适用年龄明确');
  await child.goto(origin+'/');await child.locator('#code').fill('2468');await child.locator('#login-form button').click();await child.locator('#open-growth').click();await child.locator('.growth-garden-card').first().waitFor();
  assert.equal(await child.locator('.growth-garden-card').count(),6);await screenshot(child,'growth-child-garden');
  assert.ok(await child.locator('.growth-garden-card').evaluateAll(cards=>{const r=cards.map(c=>c.getBoundingClientRect());return r.slice(0,3).every(x=>Math.abs(x.top-r[0].top)<2)&&r.slice(3).every(x=>x.top>r[0].top)&&r.every(x=>Math.abs(x.width-r[0].width)<2);}));mark('1180×820横屏六类等大3×2成长卡片');
  child.once('dialog',d=>d.accept('今天参与了约定的户外活动'));await child.getByRole('button',{name:'我完成了',exact:true}).click();
  await child.waitForFunction(()=>document.querySelector('.growth-child-targets').textContent.includes('等家长确认'));
  assert.equal(await child.locator('#balance').textContent(),'2');await parent.waitForFunction(()=>document.querySelector('.growth-pending').textContent.includes('待确认 1'));
  await parent.getByRole('button',{name:'查看依据并确认',exact:true}).click();await parent.locator('#award-submit').click();await parent.waitForFunction(()=>document.querySelector('#balance').textContent==='5');mark('孩子提交不直接入账，家长按快照确认后增加3分');
  await child.locator('#growth-dialog .growth-dialog-heading button').click();
  await parent.getByRole('button',{name:'修改年龄 / 模式',exact:true}).click();await parent.locator('#growth-dialog [name=age]').selectOption('9');assert.equal(await parent.locator('#growth-dialog [name=mode]').inputValue(),'school_basic');await parent.locator('#growth-dialog [name=mode]').selectOption('school_advanced');await parent.getByRole('button',{name:'确认并保存',exact:true}).click();await parent.locator('#growth-dialog').waitFor({state:'hidden'});assert.equal(app.store.growth.profile().mode,'school_advanced');assert.equal(app.store.growth.read().tasks.length,1);assert.equal(app.store.snapshot().balance,5);mark('年龄不自动切模式，手动进阶保留目标与余额');
  await parent.getByRole('button',{name:'目标与项目库',exact:true}).click();await parent.getByRole('button',{name:'新增自定义项目',exact:true}).click();
  await parent.locator('#growth-dialog [name=title]').fill('制作我的小故事书');await parent.locator('#growth-dialog [name=category]').selectOption('creativity');await parent.locator('#growth-dialog [name=condition]').fill('选择故事，再画一页，允许口述和家长帮助');
  await parent.getByRole('button',{name:'增加一个步骤',exact:true}).click();await parent.locator('#growth-dialog [name=stepTitle]').nth(0).fill('选一个故事');await parent.getByRole('button',{name:'增加一个步骤',exact:true}).click();await parent.locator('#growth-dialog [name=stepTitle]').nth(1).fill('画一页故事');await parent.locator('#growth-dialog [name=stepPoints]').nth(1).selectOption('3');
  await parent.getByRole('button',{name:'保存项目',exact:true}).click();await parent.locator('.growth-library').waitFor();const project=app.store.growth.read(true).tasks.find(t=>t.title==='制作我的小故事书');assert.equal(project.points,4);assert.equal(project.steps.length,2);assert.equal(project.frequency,'once');await close();mark('家长纯表单创建自定义分类项目和多日步骤');
  // A compatibility record demonstrates non-destructive legacy classification, not routine new scoring.
  app.store.points({delta:3,reason:'旧版记录：整理桌面',idempotencyKey:randomUUID()});
  await parent.locator('#history-category').selectOption('unclassified');await parent.locator('#history-entries').getByRole('button',{name:'给旧记录归类',exact:true}).click();await parent.locator('#growth-dialog [name=category]').selectOption('responsibility');await parent.locator('#growth-dialog [name=reason]').fill('家长确认原记录为整理桌面');await parent.getByRole('button',{name:'确认保存',exact:true}).click();await parent.locator('#growth-dialog').waitFor({state:'hidden'});assert.equal(app.store.snapshot().balance,8);assert.equal(app.store.growth.read(true).unclassified,0);mark('旧记录手动归类不重复发放积分');
  await parent.locator('#history-category').selectOption('responsibility');await parent.locator('#history-entries').getByRole('button',{name:'更正误录',exact:true}).click();await parent.locator('#growth-dialog [name=reason]').fill('测试误录更正，关联原记录');await parent.locator('#growth-dialog [name=points]').fill('0');await parent.getByRole('button',{name:'确认保存',exact:true}).click();await parent.locator('#growth-dialog').waitFor({state:'hidden'});assert.equal(app.store.snapshot().balance,5);assert.equal(app.store.snapshot().lifetime,8);mark('误录更正关联原流水，不透支、不回收收藏');
  await parent.locator('[data-parent-tab=settings]').click();assert.equal(await parent.locator('.growth-summary-card').count(),6);assert.match(await parent.locator('.growth-summary').innerText(),/不代表孩子的能力/);await screenshot(parent,'growth-family-distribution');
  // Preserve a pending draft across poll refreshes.
  await parent.locator('[data-parent-tab=award]').click();await parent.locator('[data-growth-category=creativity]').click();await parent.locator('#growth-task').selectOption('');await parent.locator('#growth-title').fill('画出自己的想法');await parent.locator('#delta').selectOption('0');await parent.locator('#award-submit').click();await parent.waitForFunction(()=>document.querySelector('#reason').value==='');assert.equal(app.store.snapshot().balance,5);assert.equal(app.store.history({kind:'observation'}).total,1);mark('仅记录保存成长回忆，不增加喵币或经验');
  // Verify first-time parent guidance through the actual child page and native scene.
  await child.waitForFunction(()=>document.querySelector('#balance').textContent==='5');await child.setViewportSize({width:1024,height:768});await child.locator('#open-growth').click();await screenshot(child,'growth-child-ipad');
  assert.ok(await child.locator('#growth-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await child.locator('#growth-dialog .growth-dialog-heading button').click();
  assert.equal(await child.locator('#pet-scene iframe').count(),1);await child.waitForFunction(()=>document.querySelector('#pet-scene').dataset.ready==='true');mark('1024×768弹窗不横向溢出，原版小猫首页仍正常加载');
  const auth=await(await childContext.request.get(origin+'/api/child/session')).json();const denied=await childContext.request.post(origin+'/api/parent/growth/award',{headers:{'X-Meow-Client':'points-pet','X-CSRF-Token':auth.csrf},data:{delta:5}});assert.equal(denied.status(),401);mark('孩子会话不能调用家长成长写入接口');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);mark('无页面脚本错误，无外部网络请求');
  writeFileSync(new URL('growth-browser-report.json',out),JSON.stringify({ok:true,checks,errors,external},null,2));
}catch(error){await screenshot(parent,'growth-failure-parent').catch(()=>{});await screenshot(child,'growth-failure-child').catch(()=>{});writeFileSync(new URL('growth-browser-report.json',out),JSON.stringify({ok:false,checks,errors,external,error:error.stack},null,2));throw error;}
finally{await browser.close();await app.close();}
