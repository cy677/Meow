import assert from 'node:assert/strict';
import {mkdirSync,readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createPetServer} from '../server.mjs';
import {revealReward} from './ui-helpers.mjs';
const {chromium}=await import(process.env.MEOW_PLAYWRIGHT||'playwright');
const app=await createPetServer({dbPath:':memory:'});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${app.server.address().port}`;
let browser;const errors=[];mkdirSync('output/random-script',{recursive:true});
try {
  const setup=await fetch(origin+'/api/parent/setup',{method:'POST',headers:{'Content-Type':'application/json','X-Meow-Client':'points-pet'},body:JSON.stringify({setupToken:app.setupToken,age:6,mode:'school_basic',timeZone:'UTC',pin:'864209',childCode:'2468',childName:'测试',petName:'小橘'})});
  assert.equal(setup.status,200);
  app.store.points({delta:500,reason:'测试',idempotencyKey:randomUUID()});
  for(const id of ['pose-banana','trick-jump']){
    const r=app.store.catalog().rewards.find(r=>r.id===id);
    app.store.purchase({rewardId:id,expectedCost:r.cost,idempotencyKey:randomUUID()});
  }
  const business=()=>{const s=app.store.snapshot();return {balance:s.balance,owned:s.owned,equipped:s.equipped,ledger:s.ledger};};
  const before=business();
  browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const page=await browser.newPage({viewport:{width:1024,height:768},hasTouch:true});
  page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.locator('#code').fill('2468');await page.locator('#login-form button').click();
  await page.locator('#workspace').waitFor({state:'visible'});
  for(const id of ['pose-banana','trick-jump']){
    const card=await revealReward(page,id,'owned');
    await card.getByRole('button',{name:'加入随机脚本',exact:true}).click();
    await card.getByRole('button',{name:'从脚本中删除',exact:true}).waitFor();
    assert.ok(app.store.snapshot().randomScript.some(r=>r.id===id));
    await card.getByRole('button',{name:'从脚本中删除',exact:true}).click();
    await card.getByRole('button',{name:'加入随机脚本',exact:true}).waitFor();
    assert.ok(!app.store.snapshot().randomScript.some(r=>r.id===id));
  }
  assert.deepEqual(business(),before);
  await page.reload();await page.locator('#workspace').waitFor({state:'visible'});
  const restored=await revealReward(page,'pose-banana','owned');
  assert.equal(await restored.getByRole('button',{name:'加入随机脚本',exact:true}).count(),1);
  await page.screenshot({path:'output/random-script/rewards.png'});
  await page.locator('[data-action=close-rewards]').click();
  const scene=page.frameLocator('iframe.home-scene');
  await scene.locator('body[data-studio-ready=true]').waitFor();
  for(const mode of ['card','together']){
    await scene.locator(mode==='card'?'#btn-export-png':'#btn-photo-together').click();
    if(mode==='together')await scene.locator('#viewport[data-device-photo-state=ready]').waitFor();
    const button=scene.getByRole('button',{name:'切换姿势',exact:true});await button.waitFor({state:'visible'});
    const old=await scene.locator('#viewport').getAttribute('data-cat-pose');
    await button.click();
    const current=await scene.locator('#viewport').getAttribute('data-photo-pose');
    assert.notEqual(current,old);assert.ok(app.store.snapshot().access.poses.includes(current));
    assert.equal(await scene.locator('#viewport').getAttribute('data-cat-pose'),current);
    await page.screenshot({path:`output/random-script/${mode}.png`});
    const [download]=await Promise.all([page.waitForEvent('download'),scene.locator('.share-card-capture-button').click()]);
    const bytes=readFileSync(await download.path());assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    await scene.locator('.share-card-close-button').click();
  }
  assert.deepEqual(business(),before);assert.deepEqual(errors,[]);
  console.log('PASS: pose/action add-remove, reload, preserved ownership/balance, both photo pose controls and PNG downloads; no page errors');
} finally {await browser?.close();await app.close();assert.equal(app.server.listening,false);}
