/** Focused current UI smoke; separate from the older navigation-specific suites.
 * Run after npm run pet:build. Uses an isolated in-memory family, not pet/data.
 */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createPetServer} from '../server.mjs';
import {checkDevicePhotos} from './browser-photo-checks.mjs';
const {chromium}=await import(process.env.MEOW_PLAYWRIGHT||'playwright');
const app=await createPetServer({dbPath:':memory:'});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${app.server.address().port}`;
const out=new URL('../test-results/',import.meta.url);mkdirSync(out,{recursive:true});
let browser;const checks=[],errors=[];
const mark=value=>{checks.push(value);console.log('PASS',value);};
const assertPng=async(download,label)=>{const path=await download.path();assert.ok(path,`${label} download has a temporary file`);const bytes=readFileSync(path);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a',`${label} is PNG`);return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};};
try {
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const setup=await fetch(origin+'/api/parent/setup',{method:'POST',headers:{'Content-Type':'application/json','X-Meow-Client':'points-pet'},body:JSON.stringify({setupToken:app.setupToken,age:6,mode:'school_basic',timeZone:'UTC',pin:'864209',childCode:'2468',childName:'测试',petName:'小橘'})});
  assert.equal(setup.status,200);
  const parent=await browser.newPage({viewport:{width:1280,height:900}});
  const child=await browser.newPage({viewport:{width:1024,height:768},hasTouch:true});
  for(const page of [parent,child]){page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));}
  await parent.goto(origin+'/parent.html');await parent.locator('#code').fill('864209');await parent.locator('#login-form button').click();await parent.locator('#workspace').waitFor({state:'visible'});
  await child.goto(origin+'/');await child.locator('#code').fill('2468');await child.locator('#login-form button').click();await child.locator('#workspace').waitFor({state:'visible'});
  mark('Parent and child login');
  const result=await parent.evaluate(async({key})=>{
    const session=await (await fetch('/api/parent/session')).json();
    const funds=await fetch('/api/parent/points',{method:'POST',headers:{'Content-Type':'application/json','X-Meow-Client':'points-pet','X-CSRF-Token':session.csrf},body:JSON.stringify({delta:50,reason:'测试兑换余额',idempotencyKey:key+'-funds'})});if(!funds.ok)throw new Error('准备积分失败');
    const response=await fetch('/api/parent/growth/award',{method:'POST',headers:{'Content-Type':'application/json','X-Meow-Client':'points-pet','X-CSRF-Token':session.csrf},body:JSON.stringify({category:'health',title:'记录一次准备',delta:3,occurredAt:new Date().toISOString(),idempotencyKey:key})});
    const preferred='/api/parent/growth/summary?days=7';
    const preferredResponse=await fetch(preferred);
    const summaryPath=preferredResponse.ok?preferred:'/api/parent/growth?days=7';
    const summary=await(await fetch(summaryPath)).json();
    const points=summary.periodPoints??summary.summary?.find?.(item=>item.category==='health')?.points;
    return {status:response.status,points};
  },{key:randomUUID()});assert.equal(result.status,200);assert.equal(result.points,3);mark('Growth award and summary');
  const bought=await child.evaluate(async key=>{const session=await(await fetch('/api/child/session')).json();const response=await fetch('/api/purchase',{method:'POST',headers:{'Content-Type':'application/json','X-Meow-Client':'points-pet','X-CSRF-Token':session.csrf},body:JSON.stringify({rewardId:'coat-grey',expectedCost:25,idempotencyKey:key})});return {status:response.status,state:await response.json()};},randomUUID());
  assert.equal(bought.status,200);assert.equal(bought.state.balance,28);await child.reload();await child.locator('#workspace').waitFor({state:'visible'});mark('Reward purchase and persisted browser reload');
  const modal=child.locator('#rewards-dialog');if(await modal.isVisible())await child.locator('[data-action=close-rewards]').click();
  const scene=child.frameLocator('iframe.home-scene');await scene.locator('body[data-studio-ready="true"]').waitFor();
  await scene.locator('#btn-export-png').click();const frame=scene.locator('.share-card-live-frame');await frame.waitFor({state:'visible'});
  const box=await frame.boundingBox();assert.ok(box&&box.width>100&&box.height>100,JSON.stringify(box));
  await child.screenshot({path:fileURLToPath(new URL('maintenance-photo.png',out))});
  const [cardDownload]=await Promise.all([child.waitForEvent('download'),scene.locator('.share-card-capture-button').click()]);
  const cardSize=await assertPng(cardDownload,'share card');assert.deepEqual([cardSize.width,cardSize.height],[1200,1600]);
  await scene.locator('#viewport[data-share-card-captured="true"]').waitFor();
  await scene.locator('.share-card-close-button').click();await scene.locator('.share-card-overlay').waitFor({state:'hidden'});
  await scene.locator('#btn-export-png').click();await frame.waitFor({state:'visible'});await scene.locator('.share-card-close-button').click();mark('Original card capture downloads PNG and close/reopen restores the stage');
  await checkDevicePhotos({child,scene,out,mark});
  // These are functional checks, not simultaneous software-rendering load tests.
  // Dispose the verified child scene before loading the parent editor.
  await child.close();await parent.bringToFront();
  await parent.goto(origin+'/studio.html?mode=parent');
  async function editorReady(){
    await parent.waitForFunction(()=>['ready','failed','expired'].includes(document.body.dataset.studioStage));
    const state=await parent.evaluate(()=>({stage:document.body.dataset.studioStage,error:document.body.dataset.studioError,status:document.querySelector('.studio-bar [role=status]')?.textContent}));
    assert.equal(state.stage,'ready',JSON.stringify(state));
    await parent.locator('#scene').waitFor({state:'visible'});
    await parent.getByRole('button',{name:'保存草稿',exact:true}).waitFor({state:'visible'});
  }
  await editorReady();
  await parent.getByRole('button',{name:'保存草稿',exact:true}).click();await parent.waitForFunction(()=>document.querySelector('.studio-bar [role=status]')?.textContent.includes('草稿已保存'));
  await parent.reload();await editorReady();mark('Parent draft saved and reloaded');
  assert.deepEqual(errors,[]);writeFileSync(new URL('browser-maintenance.json',out),JSON.stringify({ok:true,checks,errors},null,2));
} catch(error) {
  const diagnostics=[];
  for(const context of browser?.contexts()||[]){
    for(const page of context.pages()){
      try {
        diagnostics.push(await page.evaluate(()=>({url:location.href,visibility:document.visibilityState,stage:document.body.dataset.studioStage,error:document.body.dataset.studioError,status:document.querySelector('.studio-bar [role=status]')?.textContent,body:{width:document.body.getBoundingClientRect().width,height:document.body.getBoundingClientRect().height}})));
        await page.screenshot({path:fileURLToPath(new URL(`maintenance-failure-${diagnostics.length}.png`,out)),timeout:5000});
      } catch(diagnosticError) {diagnostics.push({error:diagnosticError.message});}
    }
  }
  writeFileSync(new URL('browser-maintenance.json',out),JSON.stringify({ok:false,checks,errors,diagnostics,error:error.stack},null,2));throw error;
} finally {await browser?.close();await app.close();assert.equal(app.server.listening,false,'temporary browser test server closed');}
