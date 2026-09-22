/** Runs inside the existing isolated smoke fixture with Chromium fake media.
 * This verifies browser integration, not a physical iPad or its native Photos UI.
 */
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

export async function checkDevicePhotos({child,scene,out,mark}) {
  await child.bringToFront();
  const requests=[],downloads=[];
  const onRequest=request=>{if(request.method()!=='GET')requests.push({url:request.url(),method:request.method()});};
  const onDownload=download=>downloads.push(download.suggestedFilename());
  child.on('request',onRequest);child.on('download',onDownload);
  const body=scene.locator('body'),viewport=scene.locator('#viewport');
  const business=()=>child.evaluate(async()=>{const s=await(await fetch('/api/state')).json();return Object.fromEntries(['balance','lifetime','params','sceneParams','equipped','owned','creation'].map(k=>[k,s[k]]));});
  const before=await business();
  await body.evaluate(()=>{
    const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.photoProbe={requests:[],streams:[],shareCalls:[],revoked:[],deny:false};
    navigator.mediaDevices.getUserMedia=async options=>{
      photoProbe.requests.push(options);
      if(photoProbe.deny)throw new DOMException('Test permission denial','NotAllowedError');
      const stream=await original(options);photoProbe.streams.push(stream);return stream;
    };
    const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{photoProbe.revoked.push(url);revoke(url);};
    Object.defineProperty(navigator,'canShare',{configurable:true,value:({files})=>files?.[0] instanceof File});
    Object.defineProperty(navigator,'share',{configurable:true,value:async({files})=>{
      photoProbe.shareCalls.push({type:files[0].type,size:files[0].size,active:navigator.userActivation.isActive});
      throw new DOMException('Cancelled native sheet in contract test','AbortError');
    }});
  });
  await scene.locator('#btn-export-png').click();
  assert.equal(await scene.locator('.share-card-repo').count(),0);
  assert.equal(await body.evaluate(()=>photoProbe.requests.length),0);
  await scene.locator('.device-photo-toggle').click();
  await scene.locator('#viewport[data-device-photo-state="ready"]').waitFor();
  // Exercise several real render clocks: updateWeather must still receive Color/Fog.
  await body.evaluate(()=>new Promise(resolve=>{let count=0;function tick(){if(++count===8)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);}));
  const video=await scene.locator('.device-camera-source').evaluate(v=>({width:v.videoWidth,height:v.videoHeight,inline:v.playsInline,muted:v.muted}));
  assert.ok(video.width>0&&video.height>0);assert.ok(video.inline&&video.muted);
  const sourceBg=await body.evaluate(()=>{let root=window.__getCat();while(root.parent)root=root.parent;return {isColor:root.background.isColor,fog:!!root.fog};});
  assert.ok(sourceBg.isColor&&sourceBg.fog,'photo render must restore the weather background and fog between frames');
  await child.screenshot({path:fileURLToPath(new URL('photo-device-live.png',out))});
  const canvas=scene.locator('#scene'),box=await canvas.boundingBox();
  await child.mouse.move(box.x+box.width/2,box.y+box.height/2);await child.mouse.down();
  await child.mouse.move(box.x+box.width/2+30,box.y+box.height/2+20,{steps:4});await child.mouse.up();
  await scene.locator('.device-photo-reset').click();
  await scene.locator('.device-photo-switch').click();await scene.locator('#viewport[data-device-photo-state="ready"]').waitFor();
  assert.equal(await body.evaluate(()=>photoProbe.streams[0].getTracks().every(t=>t.readyState==='ended')),true);
  await scene.locator('.device-photo-mirror').click();
  await scene.locator('.share-card-capture-button').click();await scene.locator('.device-photo-preview').waitFor({state:'visible'});
  const image=scene.locator('.device-photo-image');await image.evaluate(img=>img.decode());
  const result=await image.evaluate(img=>({width:img.naturalWidth,height:img.naturalHeight,display:getComputedStyle(img.parentElement).display}));
  assert.deepEqual(result,{width:1200,height:1600,display:'flex'});
  assert.equal(await body.evaluate(()=>photoProbe.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))),true);
  assert.equal(await body.evaluate(()=>photoProbe.shareCalls.length),0,'capture must not silently invoke native share');
  await child.screenshot({path:fileURLToPath(new URL('photo-device-preview.png',out))});
  await scene.locator('.device-photo-save').click();
  await scene.locator('.device-photo-save-status').filter({hasText:'已取消'}).waitFor();
  const share=await body.evaluate(()=>photoProbe.shareCalls[0]);assert.ok(share.active);assert.ok(share.size>1000);assert.equal(share.type,'image/png');
  await body.evaluate(()=>Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false}));
  await scene.locator('.device-photo-save').click();await scene.locator('.device-photo-save-status').filter({hasText:'长按'}).waitFor();
  await scene.locator('.device-photo-done').click();assert.ok(await body.evaluate(()=>photoProbe.revoked.length>0));
  mark('Device video, lens switch, reversible render, PNG preview and file-share contract (fake camera / stub share)');

  await body.evaluate(()=>{photoProbe.deny=true;});await scene.locator('.device-photo-toggle').click();
  await scene.locator('.share-card-status').filter({hasText:'相机权限'}).waitFor();
  assert.equal(await scene.locator('.share-card-capture-button').isDisabled(),true);
  await body.evaluate(()=>{photoProbe.deny=false;});await scene.locator('.device-photo-toggle').click();
  await scene.locator('#viewport[data-device-photo-state="ready"]').waitFor();
  await body.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal(await body.evaluate(()=>photoProbe.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))),true);
  await body.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal(await viewport.getAttribute('data-device-photo-state'),'stopped');
  await scene.locator('.device-photo-toggle').click();await scene.locator('#viewport[data-device-photo-state="ready"]').waitFor();
  await scene.locator('.share-card-close-button').click();
  assert.equal(await scene.locator('.device-camera-source').count(),0);
  assert.equal(await body.evaluate(()=>photoProbe.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))),true);
  assert.ok(await body.evaluate(()=>photoProbe.requests.every(r=>r.audio===false)));
  assert.deepEqual(await business(),before);assert.deepEqual(requests,[]);assert.deepEqual(downloads,[]);
  child.off('request',onRequest);child.off('download',onDownload);
  mark('Denial/retry, background/close cleanup, unchanged business data, no photo upload or file download');
}
