import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { createOrientationController, orientationSupport, relativeTilt, validSample } from '../orientation.mjs';
import { accessUrls, lanAddresses, launchOptions, requestOrigin } from '../lan.mjs';
import { createPetServer } from '../server.mjs';

function sensors() {
  const win=new EventTarget(),doc=new EventTarget(),states=[],offsets=[],timers=new Map();let next=0,permissions=0;
  Object.assign(win,{isSecureContext:true,DeviceOrientationEvent:{requestPermission:()=>{permissions++;return Promise.resolve('granted');}},screen:{orientation:Object.assign(new EventTarget(),{angle:0})},setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id)});
  doc.hidden=false;
  const controller=createOrientationController({win,doc,onState:s=>states.push(s),onTilt:o=>offsets.push(o)});
  return {win,doc,controller,states,offsets,timers,get permissions(){return permissions;},
    sample(beta,gamma){win.dispatchEvent(Object.assign(new Event('deviceorientation'),{beta,gamma}));},
    expire(){for(const fn of [...timers.values()])fn();},
    hide(hidden){doc.hidden=hidden;doc.dispatchEvent(new Event('visibilitychange'));},
  };
}
test('Pad 方向数学：零值有效、空值/非数值无效；相对角度限幅、横竖屏与角度跨界',()=>{
  assert.ok(validSample({beta:0,gamma:0}));
  for(const v of [null,undefined,NaN,'10',Infinity])assert.equal(validSample({beta:v,gamma:0}),false);
  assert.deepEqual(relativeTilt({beta:30,gamma:30},{beta:0,gamma:0}),{x:1,y:1});
  assert.ok(Math.abs(relativeTilt({beta:30,gamma:0},{beta:0,gamma:0},90).x-1)<1e-8);
  assert.ok(relativeTilt({beta:0,gamma:30},{beta:0,gamma:0},90).y<-.99);
  assert.ok(Math.abs(relativeTilt({beta:-179,gamma:0},{beta:179,gamma:0}).y)<.1);
  assert.deepEqual(relativeTilt({beta:0.5,gamma:-0.5},{beta:0,gamma:0}),{x:0,y:0});
  assert.ok(relativeTilt({beta:180,gamma:90},{beta:0,gamma:0}).x<=1);
});
test('HTTP 和缺少传感器/Permissions-Policy 禁止时不申请权限，保留触摸降级说明',async()=>{
  const f=sensors();f.win.isSecureContext=false;await f.controller.enable();assert.equal(f.controller.state.code,'insecure');assert.equal(f.permissions,0);
  f.win.isSecureContext=true;f.win.DeviceOrientationEvent=null;assert.equal(orientationSupport(f.win,f.doc).code,'unsupported');
  f.win.DeviceOrientationEvent={};f.doc.permissionsPolicy={allowsFeature:()=>false};assert.equal(orientationSupport(f.win,f.doc).code,'blocked');f.controller.dispose();
});
test('权限申请同步发生在用户点击链内，第一帧校准，传感器输入不积累到相机基础状态',async()=>{
  const f=sensors(),promise=f.controller.enable();assert.equal(f.permissions,1);await promise;assert.equal(f.controller.state.code,'waiting');
  f.sample(45,0);assert.deepEqual(f.offsets.at(-1),{x:0,y:0});f.sample(60,20);assert.ok(f.offsets.at(-1).x>0);
  f.controller.calibrate();f.sample(60,20);assert.deepEqual(f.offsets.at(-1),{x:0,y:0});f.controller.dispose();
});
test('拒绝授权、取消后才返回授权、异常授权都不能偷偷启用传感器',async()=>{
  const f=sensors();f.win.DeviceOrientationEvent.requestPermission=()=>Promise.resolve('denied');await f.controller.enable();assert.equal(f.controller.state.enabled,false);assert.equal(f.controller.state.code,'denied');
  let grant;f.win.DeviceOrientationEvent.requestPermission=()=>new Promise(r=>grant=r);const p=f.controller.enable();f.controller.disable();grant('granted');await p;assert.equal(f.controller.state.enabled,false);
  f.win.DeviceOrientationEvent.requestPermission=()=>{throw Error('not activated');};await f.controller.enable();assert.equal(f.controller.state.code,'denied');f.controller.dispose();
});
test('无 requestPermission 的浏览器也等待真实有效读数；空读数和超时不假装已开启',async()=>{
  const f=sensors();delete f.win.DeviceOrientationEvent.requestPermission;await f.controller.enable();f.sample(null,null);assert.equal(f.controller.state.code,'waiting');f.expire();assert.equal(f.controller.state.code,'no-signal');assert.equal(f.controller.state.enabled,false);
  await f.controller.enable();f.sample(0,0);assert.equal(f.controller.state.code,'active');f.expire();assert.equal(f.controller.state.code,'no-signal');f.controller.dispose();
});
test('触摸优先、松手校准、切后台暂停与恢复、横竖屏重新校准；销毁后不再接收事件',async()=>{
  const f=sensors();await f.controller.enable();f.sample(20,0);f.sample(20,25);assert.ok(f.offsets.at(-1).x>0);
  f.controller.setTouching(true);f.sample(20,35);assert.deepEqual(f.offsets.at(-1),{x:0,y:0});
  f.controller.setTouching(false);f.sample(20,35);assert.deepEqual(f.offsets.at(-1),{x:0,y:0});
  f.hide(true);const n=f.offsets.length;f.sample(80,60);assert.equal(f.offsets.length,n);assert.equal(f.timers.size,0);
  f.hide(false);f.sample(80,60);assert.deepEqual(f.offsets.at(-1),{x:0,y:0});assert.equal(f.permissions,1);
  f.win.screen.orientation.angle=90;f.win.screen.orientation.dispatchEvent(new Event('change'));f.sample(10,0);assert.deepEqual(f.offsets.at(-1),{x:0,y:0});
  f.win.dispatchEvent(new Event('pagehide'));assert.equal(f.controller.state.enabled,false);
  f.controller.dispose();const count=f.offsets.length;f.sample(40,20);assert.equal(f.offsets.length,count);assert.equal(f.timers.size,0);
});
test('局域网启动配置及可复制的 IP 地址：HTTP 默认 8792，HTTPS 默认 8793，错误证书配置不降级',()=>{
  assert.equal(launchOptions([],{}).host,'127.0.0.1');assert.equal(launchOptions(['--lan'],{}).host,'0.0.0.0');assert.equal(launchOptions(['--lan'],{}).port,8792);
  assert.throws(()=>launchOptions(['--https'],{}),/MEOW_TLS_CERT/);
  assert.throws(()=>launchOptions([],{MEOW_PORT:'NaN'}));
  const tls=launchOptions(['--https','--lan'],{MEOW_TLS_CERT:'test.pem',MEOW_TLS_KEY:'test.key'});assert.equal(tls.port,8793);
  assert.throws(()=>launchOptions(['--https','--dev'],{MEOW_TLS_CERT:'test.pem',MEOW_TLS_KEY:'test.key'}));
  assert.deepEqual(lanAddresses({a:[{address:'127.0.0.1',family:'IPv4',internal:true},{address:'192.168.1.10',family:'IPv4',internal:false}],b:[{address:'192.168.1.10',family:4,internal:false}]}),['192.168.1.10']);
  assert.deepEqual(accessUrls({...tls,addresses:['192.168.1.10']}),['https://localhost:8793','https://192.168.1.10:8793']);
});
test('LAN Host 校验支持 HTTPS 默认端口和 IPv6，同时拒绝域名重绑定、错误端口、路径与不同 Origin',()=>{
  const knownHosts=new Set(['localhost','192.168.1.10','[::1]']);
  assert.equal(requestOrigin('192.168.1.10',{protocol:'https:',port:443,knownHosts}),'https://192.168.1.10');
  assert.equal(requestOrigin('[::1]:8793',{protocol:'https:',port:8793,knownHosts}),'https://[::1]:8793');
  for(const host of ['evil.example:8792','192.168.1.10:8793','192.168.1.10:8792/path','x@localhost:8792'])assert.throws(()=>requestOrigin(host,{protocol:'http:',port:8792,knownHosts}));
  assert.equal(requestOrigin('meow.example:443',{protocol:'http:',port:8792,knownHosts,publicOrigin:'https://meow.example'}),'https://meow.example');
  assert.throws(()=>requestOrigin('other.example',{protocol:'https:',port:443,knownHosts,publicOrigin:'https://meow.example'}));
});
function get(url,options={}) {return new Promise((resolve,reject)=>{const req=(url.startsWith('https:')?https:http).get(url,options,res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,data:JSON.parse(body)}));});req.on('error',reject);});}
test('真实网卡 IP + 0.0.0.0 访问服务；账户和传感器策略仍受保护',async t=>{
  const ip=lanAddresses()[0];if(!ip)return t.skip('当前测试主机无非回环 IPv4');
  const app=await createPetServer({dbPath:':memory:'});await new Promise(r=>app.server.listen(0,'0.0.0.0',r));t.after(()=>app.close());
  const url=`http://${ip}:${app.server.address().port}`;
  const status=await get(url+'/api/status');assert.equal(status.status,200);assert.match(status.headers['permissions-policy'],/gyroscope=\(self\)/);
  assert.equal((await get(url+'/api/parent/state')).status,401);
  assert.equal((await get(url+'/api/status',{headers:{Host:`evil.example:${app.server.address().port}`}})).status,403);
  assert.equal((await get(url+'/api/status',{headers:{Origin:'https://other.example'}})).status,403);
});
test('原生 HTTPS 正确验证证书并设置 Secure Cookie；缺失证书启动失败',async t=>{
  await assert.rejects(()=>createPetServer({dbPath:':memory:',tls:{}}),/缺少/);
  const dir=mkdtempSync(join(tmpdir(),'meow-tls-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const key=join(dir,'key.pem'),cert=join(dir,'cert.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
  const ca=readFileSync(cert),app=await createPetServer({dbPath:':memory:',tls:{cert:ca,key:readFileSync(key)}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const url=`https://127.0.0.1:${app.server.address().port}`;
  assert.equal((await get(url+'/api/status',{ca})).status,200);
  assert.equal((await get(url+'/api/status',{ca,headers:{Origin:url.replace('https:','http:')}})).status,403);
  const body=JSON.stringify({setupToken:app.setupToken,pin:'864209',childCode:'2468',childName:'Pad test',petName:'Meow'});
  const result=await new Promise((resolve,reject)=>{const req=https.request(url+'/api/parent/setup',{method:'POST',ca,headers:{'Content-Type':'application/json','X-Meow-Client':'points-pet','Origin':url}},res=>{res.resume();res.on('end',()=>resolve(res));});req.on('error',reject);req.end(body);});
  assert.equal(result.statusCode,200);assert.match(result.headers['set-cookie'][0],/; Secure/);
  for(const p of ['/certs/key.pem','/data/pet.sqlite'])assert.equal((await get(url+p,{ca})).status,404);
});
