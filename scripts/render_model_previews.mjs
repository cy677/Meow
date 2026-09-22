/** Maintainer-only: render catalogue thumbnails from the real local GLBs, not generated artwork.
 * Requires playwright; normal builds use the committed PNGs and need no browser/download.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { MODEL_DEFINITIONS } from '../pet/modelCatalog.mjs';
const root=resolve(import.meta.dirname,'..');
const server=await createServer({root,configFile:false,server:{host:'127.0.0.1',port:0},plugins:[{name:'model-preview-page',configureServer(s){s.middlewares.use('/__model_preview',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f8efe3}canvas{display:block}</style></head><body><script type="module">
import * as THREE from '/node_modules/three/build/three.module.js';
import {createModelAssets} from '/pet/models/modelAssets.js';
import {MODEL_DEFINITIONS} from '/pet/modelCatalog.mjs';
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(400,300);renderer.setPixelRatio(1);renderer.setClearColor('#f8efe3');document.body.append(renderer.domElement);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(32,4/3,.01,100),cache=createModelAssets();scene.add(new THREE.HemisphereLight('#fff8eb','#b7a694',3));const light=new THREE.DirectionalLight('#fff5e5',2);light.position.set(3,6,4);scene.add(light);let items=[];
window.renderModel=async id=>{for(const a of items)a.dispose();items=[];const def=MODEL_DEFINITIONS.find(d=>d.id===id),files=def.files||[def.file];for(let i=0;i<files.length;i++){const a=await cache.instantiate(files[i],def.files?.34:1,{color:def.files?['#e8bd91','#b6cdb2','#aabfd1','#d5b2c0','#e6d197','#bcb1cf'][i%6]:undefined});if(def.files)a.root.position.set((i%3-1)*.39,0,Math.floor(i/3)*.37);items.push(a);scene.add(a.root);}const box=new THREE.Box3();items.forEach(a=>box.expandByObject(a.root));const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),extent=Math.max(size.x,size.y,size.z);camera.position.copy(center).add(new THREE.Vector3(1.55,1.1,2).multiplyScalar(extent*1.05));camera.lookAt(center);renderer.render(scene,camera);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));renderer.render(scene,camera);return {size:size.toArray()};};
window.ready=true;
</script></body></html>`);});}}]});
await server.listen();
const port=server.httpServer.address().port;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{const page=await browser.newPage({viewport:{width:400,height:300}});page.on('pageerror',e=>console.error(e));await page.goto(`http://127.0.0.1:${port}/__model_preview`);await page.waitForFunction(()=>window.ready);mkdirSync(resolve(root,'public/models/kenney/previews'),{recursive:true});for(const def of MODEL_DEFINITIONS){const info=await page.evaluate(id=>window.renderModel(id),def.id);await page.screenshot({path:resolve(root,`public/models/kenney/previews/${def.id}.png`)});console.log(def.id,info);}}finally{await browser.close();await server.close();}
