/** Runs inside the isolated smoke fixture with Chromium fake media.
 * This verifies browser integration, not a physical iPad or its native Photos UI.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

function readPng(download,label) {
  return download.path().then(path => {
    assert.ok(path,`${label} download has a temporary file`);
    const bytes=readFileSync(path);
    assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a',`${label} has a PNG signature`);
    assert.equal(bytes.subarray(12,16).toString('ascii'),'IHDR',`${label} has a PNG IHDR`);
    return {bytes,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  });
}

const twoFrames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

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
    const media=navigator.mediaDevices;
    const original=media.getUserMedia.bind(media);
    const cameras=[
      {kind:'videoinput',deviceId:'front-camera',label:'Front camera',groupId:'front-group'},
      {kind:'videoinput',deviceId:'rear-camera',label:'Back camera',groupId:'rear-group'},
    ];
    window.photoProbe={requests:[],streams:[],revoked:[],deny:false,cameras};
    Object.defineProperty(media,'enumerateDevices',{configurable:true,value:async()=>cameras.map(device=>({...device}))});
    media.getUserMedia=async options=>{
      photoProbe.requests.push(options);
      if(photoProbe.deny)throw new DOMException('Test permission denial','NotAllowedError');
      // Chromium's single synthetic camera does not know the test-only second
      // device id. Preserve the app request for assertions while forwarding a
      // compatible facing-mode request to fake media.
      let forwarded=options;
      if(options?.video?.deviceId?.exact){forwarded={...options,video:{...options.video}};delete forwarded.video.deviceId;}
      const stream=await original(forwarded);photoProbe.streams.push(stream);return stream;
    };
    const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{photoProbe.revoked.push(url);revoke(url);};
  });

  // The dedicated entrance sits directly after the regular photo button.
  assert.equal(await scene.locator('#btn-photo-together').count(),1);
  assert.equal(await scene.locator('#btn-export-png').evaluate(element=>element.nextElementSibling?.id),'btn-photo-together');

  // Preserve the ordinary card export contract while checking that its old
  // repository link remains absent.
  await scene.locator('#btn-export-png').click();
  const frame=scene.locator('.share-card-live-frame');await frame.waitFor({state:'visible'});
  assert.equal(await scene.locator('.share-card-repo').count(),0);
  const cardBox=await frame.boundingBox();assert.ok(cardBox&&cardBox.width>100&&cardBox.height>100,JSON.stringify(cardBox));
  const [cardDownload]=await Promise.all([child.waitForEvent('download'),scene.locator('.share-card-capture-button').click()]);
  const cardPng=await readPng(cardDownload,'share card');assert.deepEqual([cardPng.width,cardPng.height],[1200,1600]);
  await scene.locator('#viewport[data-share-card-captured="true"]').waitFor();
  await child.screenshot({path:fileURLToPath(new URL('photo-card-landscape.png',out))});
  await scene.locator('.share-card-close-button').click();await scene.locator('.share-card-overlay').waitFor({state:'hidden'});

  // Dedicated together mode is a full-viewport live view, with the card frame
  // hidden and the parent shell expanded around the iframe.
  await scene.locator('#btn-photo-together').click();
  await scene.locator('#viewport[data-device-photo-state="ready"]').waitFor();
  await child.waitForFunction(()=>document.body.classList.contains('child-together-open'));
  const full=await viewport.evaluate(element=>{const r=element.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height,innerWidth,innerHeight};});
  assert.ok(Math.abs(full.width-full.innerWidth)<=1&&Math.abs(full.height-full.innerHeight)<=1,JSON.stringify(full));
  assert.equal(await viewport.evaluate(element=>element.classList.contains('device-photo-fullscreen')),true);
  assert.equal(await scene.locator('.share-card-live-frame').isVisible(),false,'together mode hides the card frame');
  assert.equal(await scene.locator('.share-card-repo').count(),0);
  const shell=await scene.locator('.share-card-shell').boundingBox();assert.ok(shell&&shell.width>=full.width*.98&&shell.height>=full.height*.98,JSON.stringify({shell,full}));
  const parentBox=await child.locator('#pet-scene').boundingBox();const parentSize=await child.evaluate(()=>({width:innerWidth,height:innerHeight}));
  assert.ok(parentBox&&parentBox.width>=parentSize.width*.98&&parentBox.height>=parentSize.height*.98,JSON.stringify({parentBox,parentSize}));

  // Both cat-size controls are live and change the rendered canvas. Freeze the
  // optional motion loop so this comparison isolates the zoom action.
  await body.evaluate(()=>window.__setAnimation?.({enabled:false,restart:true}));await twoFrames(body);
  const larger=scene.locator('.device-photo-larger'),smaller=scene.locator('.device-photo-smaller');
  assert.equal(await larger.count(),1);assert.equal(await smaller.count(),1);
  assert.equal(await larger.isEnabled(),true);assert.equal(await smaller.isEnabled(),true);
  const beforeZoom=await scene.locator('#scene').screenshot();
  await larger.click();await twoFrames(body);const afterZoom=await scene.locator('#scene').screenshot();
  assert.notDeepEqual(afterZoom,beforeZoom,'放大按钮 must change the live cat framing');
  await smaller.click();await twoFrames(body);
  const rotateLeft=scene.locator('.device-photo-rotate-left'),rotateRight=scene.locator('.device-photo-rotate-right');
  assert.equal(await rotateLeft.count(),1);assert.equal(await rotateRight.count(),1);
  assert.equal(await rotateLeft.isEnabled(),true);assert.equal(await rotateRight.isEnabled(),true);
  const zoomBox=await scene.locator('.device-photo-zoom').boundingBox(),rotateBox=await scene.locator('.device-photo-rotate').boundingBox();
  assert.ok(zoomBox&&rotateBox&&rotateBox.y>zoomBox.y,'rotation controls sit below zoom controls');
  const actionQuaternion=await body.evaluate(()=>{const q=window.__getCat()?.quaternion;return q?[q.x,q.y,q.z,q.w]:null;});
  const beforeRotation=await scene.locator('#scene').screenshot();
  await rotateRight.click();await twoFrames(body);const afterRotation=await scene.locator('#scene').screenshot();
  assert.notDeepEqual(afterRotation,beforeRotation,'右转按钮 must change the rendered cat');
  await rotateLeft.click();await twoFrames(body);const cancelledRotation=await scene.locator('#scene').screenshot();
  assert.notDeepEqual(cancelledRotation,afterRotation,'左转 button must cancel the matching right turn');
  await rotateRight.click();await twoFrames(body);
  const mirror=scene.locator('.device-photo-mirror');await mirror.click();assert.equal(await mirror.getAttribute('aria-pressed'),'false');await mirror.click();assert.equal(await mirror.getAttribute('aria-pressed'),'true');

  // Permission is granted before the camera list is exposed. The second
  // camera must be requested with an exact id, not just an ideal facing mode.
  const switchButton=scene.locator('.device-photo-switch');await switchButton.waitFor({state:'visible'});
  const firstStreamCount=await body.evaluate(()=>photoProbe.streams.length);
  await switchButton.click();
  for(let attempt=0;attempt<100&&await body.evaluate(()=>photoProbe.streams.length<2);attempt++)await child.waitForTimeout(50);
  await scene.locator('#viewport[data-device-photo-state="ready"]').waitFor();
  const probe=await body.evaluate(()=>({requests:photoProbe.requests.map(request=>({audio:request.audio,facingMode:request.video.facingMode?.ideal,deviceId:request.video.deviceId?.exact})),stopped:photoProbe.streams[0]?.getTracks().every(track=>track.readyState==='ended'),streamCount:photoProbe.streams.length}));
  assert.equal(probe.streamCount,firstStreamCount+1,JSON.stringify(probe));
  assert.equal(probe.stopped,true,'switching lenses releases the previous stream');
  assert.equal(probe.requests[0].audio,false);assert.equal(probe.requests[1].audio,false);
  assert.equal(probe.requests[0].deviceId,undefined);assert.equal(probe.requests[1].deviceId,'rear-camera');
  assert.equal(probe.requests[1].facingMode,'environment');

  // A together capture uses the normal browser saveBlob path and downloads
  // the full canvas dimensions. There is no iPad preview/save step.
  for(const selector of ['.device-photo-preview','.device-photo-save','.device-photo-done','.device-photo-save-status'])assert.equal(await scene.locator(selector).count(),0,`${selector} is removed from the device flow`);
  const expectedSize=await scene.locator('#scene').evaluate(canvas=>[canvas.width,canvas.height]);
  const [togetherDownload]=await Promise.all([child.waitForEvent('download'),scene.locator('.share-card-capture-button').click()]);
  const togetherPng=await readPng(togetherDownload,'together photo');
  assert.deepEqual([togetherPng.width,togetherPng.height],expectedSize,JSON.stringify({expectedSize,actual:[togetherPng.width,togetherPng.height]}));
  assert.match(togetherDownload.suggestedFilename(),/^meow_together_\d+\.png$/);
  assert.ok(await body.evaluate(()=>photoProbe.revoked.length>0),'saveBlob revokes its object URL after download');
  assert.equal(await viewport.getAttribute('data-share-card-captured'),'true');
  await child.screenshot({path:fileURLToPath(new URL('photo-device-landscape.png',out))});
  const afterCaptureQuaternion=await body.evaluate(()=>{const q=window.__getCat()?.quaternion;return q?[q.x,q.y,q.z,q.w]:null;});
  assert.deepEqual(afterCaptureQuaternion,actionQuaternion,'capture leaves the action quaternion unchanged');
  await scene.locator('.device-photo-reset').click();await twoFrames(body);
  const resetFrame=await scene.locator('#scene').screenshot();assert.notDeepEqual(resetFrame,afterRotation,'reset removes the rendered turn');
  assert.deepEqual(await body.evaluate(()=>{const q=window.__getCat()?.quaternion;return q?[q.x,q.y,q.z,q.w]:null;}),actionQuaternion,'reset does not persist a model rotation');

  // The same full-viewport mode remains usable in a narrow portrait layout.
  await child.setViewportSize({width:390,height:844});await child.waitForTimeout(120);
  const narrow=await viewport.evaluate(element=>{const r=element.getBoundingClientRect();return {width:r.width,height:r.height,innerWidth,innerHeight};});
  assert.ok(Math.abs(narrow.width-narrow.innerWidth)<=1&&Math.abs(narrow.height-narrow.innerHeight)<=1,JSON.stringify(narrow));
  const panel=await scene.locator('.device-photo-panel').evaluate(element=>{const r=element.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};});
  assert.ok(panel.left>=-1&&panel.top>=-1&&panel.right<=narrow.width+1&&panel.bottom<=narrow.height+1,JSON.stringify({panel,narrow}));
  const scroll=await child.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}));
  assert.ok(scroll.width<=390&&scroll.height<=844,JSON.stringify(scroll));
  await child.screenshot({path:fileURLToPath(new URL('photo-device-narrow.png',out)),fullPage:true});
  // Return to the landscape harness before exercising the parent shell's
  // docked navigation controls; narrow-mode pixels were captured above.
  await child.setViewportSize({width:1024,height:768});await child.waitForTimeout(120);

  // Closing stops all tracks and restores the ordinary page; reopening and
  // explicitly leaving the camera can then start a fresh stream.
  await scene.locator('.share-card-close-button').click();await scene.locator('.share-card-overlay').waitFor({state:'hidden'});
  assert.equal(await viewport.getAttribute('data-device-photo-state'),'off');
  assert.equal(await viewport.evaluate(element=>element.classList.contains('device-photo-fullscreen')),false);
  assert.equal(await scene.locator('.device-camera-source').count(),0);
  assert.equal(await body.evaluate(()=>photoProbe.streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))),true);

  await scene.locator('#btn-photo-together').click();await scene.locator('#viewport[data-device-photo-state="ready"]').waitFor();
  const reopened=await body.evaluate(()=>photoProbe.streams.length);assert.ok(reopened>=3);
  await scene.locator('.device-photo-toggle').click();await scene.locator('#viewport[data-device-photo-state="off"]').waitFor();
  assert.equal(await body.evaluate(()=>photoProbe.streams.at(-1).getTracks().every(track=>track.readyState==='ended')),true);
  await scene.locator('.device-photo-toggle').click();await scene.locator('#viewport[data-device-photo-state="ready"]').waitFor();
  await scene.locator('.share-card-close-button').click();await scene.locator('.share-card-overlay').waitFor({state:'hidden'});

  // Denial leaves a retryable stopped state and does not retain the failed stream.
  await body.evaluate(()=>{photoProbe.deny=true;});
  await scene.locator('#btn-photo-together').click();
  await scene.locator('#viewport[data-device-photo-state="stopped"]').waitFor();
  assert.match(await scene.locator('.share-card-status').innerText(),/相机权限/);
  await body.evaluate(()=>{photoProbe.deny=false;});
  await scene.locator('.device-photo-toggle').click();await scene.locator('#viewport[data-device-photo-state="ready"]').waitFor();
  await scene.locator('.share-card-close-button').click();await scene.locator('.share-card-overlay').waitFor({state:'hidden'});

  assert.ok(await body.evaluate(()=>photoProbe.requests.every(request=>request.audio===false)));
  assert.deepEqual(await business(),before);assert.deepEqual(requests,[]);
  assert.equal(downloads.length,2,JSON.stringify(downloads));assert.ok(downloads.every(name=>/\.png$/.test(name)),JSON.stringify(downloads));
  child.off('request',onRequest);child.off('download',onDownload);
  mark('Dedicated entrance beside photo; full-viewport together mode in landscape and narrow portrait');
  mark('Cat zoom/rotation controls, render-scoped 15 degree turn, multi-camera switch, mirror and reset behavior');
  mark('Original saveBlob PNG downloads full frame; close/reopen and permission retry release camera tracks');
}
