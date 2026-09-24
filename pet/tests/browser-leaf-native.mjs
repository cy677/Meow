/** Native model parity and real WebGL checks; no generated artwork or alternative viewer. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const server=await createServer({root,server:{host:'127.0.0.1',port:0},logLevel:'error'});
await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),
  args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1360,height:900}});page.setDefaultTimeout(60000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&/THREE.WebGL|Shader Error|VALIDATE_STATUS/.test(m.text()))errors.push(m.text());});
const out=new URL('../test-results/leaf-native/',import.meta.url);mkdirSync(out,{recursive:true});
try{
 await page.goto(origin);await page.waitForFunction(()=>window.__getCat?.());
 const parity=await page.evaluate(async()=>{
   const {buildCat}=await import('/src/catBuilder.js');
   const {DEFAULT_PARAMS}=await import('/pet/catalog.mjs');
   const {POSES}=await import('/src/coats.js');
   const {createMesh2MotionSkinRig}=await import('/src/mesh2motionSkinRig.js');
   const {CAT_MOTION_CLIPS}=await import('/src/catMotion/clipCatalog.js');
   const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
   const equal=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
   const dispose=cat=>{cat.traverse(n=>{n.geometry?.dispose();for(const m of [n.material].flat().filter(Boolean)){m.map?.dispose();m.dispose();}});};
   const compare=(native,leaf)=>{
     for(const name of ['fur','outline']){
       const a=native.getObjectByName(name).geometry,b=leaf.getObjectByName(name).geometry;
       assert(equal(a.index.array,b.index.array),name+' index differs');
       for(const attr of ['position','normal','rigPart','rigInfluence','rigLegId','rigLegU','rigTailU','rigLegBlend','rigLegCoord','idleRegion','idleTailU','skinIndex','skinWeight']){
         const aa=a.attributes[attr],bb=b.attributes[attr];
         assert(!!aa===!!bb,name+' attribute presence '+attr);
         if(aa)assert(equal(aa.array,bb.array),name+' attribute differs '+attr);
       }
     }
     for(const key of ['headC','hr','muzzle','rigAnchorHints','colliders'])assert(JSON.stringify(native.userData[key])===JSON.stringify(leaf.userData[key]),key+' changed');
   };
   const poses=[];
   for(const pose of [...POSES.map(x=>x.id),'sleeping','twistedMelt']){
     const p={...DEFAULT_PARAMS,pose,containerSoftBody:true};
     const a=buildCat(p,'draft'),b=buildCat({...p,catAppearance:'leaf'},'draft');compare(a,b);
     assert(!a.getObjectByName('leafNeckBow'),'native decorated');
     assert(b.getObjectByName('leafNeckBow'),'missing leaf bow');
     assert(!b.getObjectByName('leafTail'),'tail was replaced');
     for(const t of [0,.35,1.6])assert(JSON.stringify(a.userData.updateStaticIdle(t,true))===JSON.stringify(b.userData.updateStaticIdle(t,true)),'idle changed');
     poses.push({pose,vertices:a.getObjectByName('fur').geometry.attributes.position.count,identicalNativeGeometry:true});
     dispose(a);dispose(b);
   }
   const p={...DEFAULT_PARAMS,pose:'standing',motionDebug:true};
   const a=buildCat(p),b=buildCat({...p,catAppearance:'leaf'});
   const ra=createMesh2MotionSkinRig(a),rb=createMesh2MotionSkinRig(b);compare(a,b);
   assert(ra.skeleton.bones.length===19&&rb.skeleton.bones.length===19,'skeleton replaced');
   const actions=[];
   for(const action of CAT_MOTION_CLIPS){
     for(const t of [.0,action.duration*.25,action.duration*.65]){
       const sa=ra.update(t,{actionId:action.id,intensity:.85}),sb=rb.update(t,{actionId:action.id,intensity:.85});
       a.updateMatrixWorld(true);b.updateMatrixWorld(true);ra.skeleton.update();rb.skeleton.update();
       assert(equal(ra.skeleton.boneMatrices,rb.skeleton.boneMatrices),action.id+' bone matrices changed');
       for(const key of ['rootX','rootZ','rootLift','rootPitch','rootYaw','rootRoll','boneLengthError'])assert(sa[key]===sb[key],action.id+' '+key);
       const before=Array.from(rb.skeleton.boneMatrices);b.userData.setMouthOpen(.8);b.userData.updateMouthAnimation(t);
       assert(equal(before,Array.from(rb.skeleton.boneMatrices)),action.id+' mouth modifies body');
       assert(sb.boneLengthError<1e-6,'bone length error');
     }
     actions.push(action.id);
   }
   const attached=['face','innerEarLeafLeft','innerEarLeafRight'].map(name=>({name,parent:b.getObjectByName(name).parent.name}));
   for(const item of attached)assert(item.parent===rb.bones.get('head').name,'decoration not attached: '+item.name);
   b.userData.setMouthOpen(null);b.userData.setMouthMode('auto');
   rb.update(.7,{actionId:'bark',intensity:.85});
   assert(b.userData.updateMouthAnimation(.7)>.5,'mouth does not follow native bark progress');
   rb.update(.7,{actionId:'walk',intensity:.85});
   assert(b.userData.updateMouthAnimation(.7)===0,'mouth remains open during walk');
   const nativeIndex=a.getObjectByName('fur').geometry.index.count;
   dispose(a);dispose(b);ra.skeleton.dispose();rb.skeleton.dispose();
   return {poses,actions,attached,bones:19,identicalSkinWeights:true,nativeIndex};
 });
 console.log('PASS native geometry for',parity.poses.length,'poses; same 19 bones and',parity.actions.length,'actions');
 // Real editor: changing appearance is not allowed to reset pose or shape.
 await page.evaluate(()=>window.__setParams({pose:'loaf',headSize:1.16,seed:24680,catAppearance:'native',motionDebug:false}));
 const before=await page.evaluate(()=>({pose:document.querySelector('#viewport').dataset.catPose,head:window.__getCat().userData.hr}));
 await page.getByLabel('小猫外观',{exact:true}).selectOption('leaf');
 assert.equal(await page.locator('#viewport').getAttribute('data-cat-pose'),before.pose);
 assert.equal(await page.evaluate(()=>window.__getCat().userData.hr),before.head);
 await page.getByLabel('口型动作',{exact:true}).selectOption('open');
 const opened=await page.evaluate(()=>({mouth:window.__getCat().userData.getMouthState(),geometry:window.__getCat().getObjectByName('fur').geometry.uuid}));
 assert.equal(opened.mouth.openness,1);
 await page.screenshot({path:new URL('editor-mouth-open.png',out).pathname});
 await page.getByLabel('口型动作',{exact:true}).selectOption('closed');
 const closed=await page.evaluate(()=>({mouth:window.__getCat().userData.getMouthState(),geometry:window.__getCat().getObjectByName('fur').geometry.uuid}));
 assert.equal(closed.mouth.openness,0);assert.equal(opened.geometry,closed.geometry);
 await page.getByLabel('口型动作',{exact:true}).selectOption('meow');
 const mouthRange=await page.evaluate(()=>{const c=window.__getCat();c.userData.setMouthMode('meow');return [0,.45,1,1.35,2].map(t=>c.userData.updateMouthAnimation(t));});
 assert.ok(Math.max(...mouthRange)>.5);assert.ok(Math.min(...mouthRange)<.1);
 await page.evaluate(()=>window.__setAnimation({enabled:true,stateMachine:false,action:'sit'}));
 await page.waitForTimeout(600);
 assert.equal(await page.locator('#viewport').getAttribute('data-motion-binding-pose'),'standing');
 await page.screenshot({path:new URL('editor-native-sit.png',out).pathname});
 await page.evaluate(()=>window.__setAnimation({enabled:false}));
 assert.equal(await page.locator('#viewport').getAttribute('data-cat-pose'),'loaf');
 await page.screenshot({path:new URL('editor-native-loaf.png',out).pathname});
 await page.getByLabel('小猫外观',{exact:true}).selectOption('native');
 assert.equal(await page.evaluate(()=>window.__getCat().getObjectByName('leafNeckBow')===undefined),true);
 assert.equal(await page.evaluate(()=>window.__getCat().userData.hr),before.head);
 assert.deepEqual(errors,[]);
 const report={status:'passed',baseMain:'9fd0729bddee1825de0a184f850cdb956ea52747',...parity,
   editor:['appearance preserves pose and size','mouth changes without rebuilding body','meow progresses','native sit and pose restoration','switching back removes decorations'],webglErrors:errors};
 writeFileSync(new URL('verification.json',out),JSON.stringify(report,null,2)+'\n');
 console.log('PASS native editor appearance, mouth, sit, restoration, and WebGL');
}catch(error){writeFileSync(new URL('errors.json',out),JSON.stringify({message:error.message,errors},null,2));throw error;}
finally{await browser.close();await server.close();}
