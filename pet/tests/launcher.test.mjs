import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {normalizePublicIp, launchOptions, accessUrls} from '../lan.mjs';
import {createPetServer} from '../server.mjs';
import {createStore} from '../store.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const base=JSON.parse(readFileSync(new URL('../rewards.json',import.meta.url)));
function launcher(action,dataDir){
  return spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'scripts/pet-launcher.ps1'),'-Action',action],{
    cwd:tmpdir(),encoding:'utf8',timeout:10000,windowsHide:true,env:{...process.env,MEOW_DATA_DIR:dataDir,MEOW_PORT:'8792',MEOW_PUBLIC_IP:''}
  });
}
function request(port,headers={}){
  return new Promise((resolve,reject)=>{
    const req=http.get({host:'127.0.0.1',port,path:'/api/status',headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.on('error',reject);
  });
}
async function waitForExit(child, timeout=1500){
  if(child.exitCode!==null)return true;
  return new Promise(resolve=>{
    const finish=exited=>{clearTimeout(timer);child.off('exit',onExit);resolve(exited);};
    const onExit=()=>finish(true);
    const timer=setTimeout(()=>finish(false),timeout);
    child.once('exit',onExit);
  });
}
async function listenWhenFree(port, host='0.0.0.0', timeout=10000){
  const deadline=Date.now()+timeout;
  while(true){
    const server=createServer();
    try{
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
      return server;
    }catch(error){
      server.close();
      if(error.code!=='EADDRINUSE'||Date.now()>=deadline)throw error;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
}

test('external IP is explicit and canonical; startup URLs include it without changing local defaults',()=>{
  assert.equal(launchOptions([],{}).host,'127.0.0.1');
  const options=launchOptions(['--lan','--open'],{MEOW_PUBLIC_IP:'203.0.113.27'});
  assert.equal(options.openBrowser,true);
  assert.deepEqual(accessUrls({...options,addresses:['192.168.1.2']}),['http://localhost:8792','http://192.168.1.2:8792','http://203.0.113.27:8792']);
  assert.equal(normalizePublicIp('2001:0db8:0:0:0:0:0:7'),'2001:db8::7');
  for(const value of ['example.com','http://203.0.113.27','203.0.113.27:8792','0.0.0.0/0','*',42])assert.throws(()=>normalizePublicIp(value));
});

test('configured external IP accepts same-origin access while foreign hosts, ports and origins remain rejected',async t=>{
  const app=await createPetServer({dbPath:':memory:',publicIp:'203.0.113.27',publicOrigin:''});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const port=app.server.address().port,host=`203.0.113.27:${port}`;
  assert.equal(await request(port,{Host:host,Origin:`http://${host}`}),200);
  assert.equal(await request(port),200);
  assert.equal(await request(port,{Host:`203.0.113.28:${port}`}),403);
  assert.equal(await request(port,{Host:`203.0.113.27:${port===65535?port-1:port+1}`}),403);
  assert.equal(await request(port,{Host:host,Origin:'http://evil.example'}),403);
});

test('Windows reset backs up complete SQLite data, preserves unrelated files and recreates fresh state', {skip:process.platform!=='win32'},t=>{
  const directory=mkdtempSync(join(tmpdir(),'meow-reset-')),dataDir=join(directory,'数据 with spaces');
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  // No database means no directory is created or deleted.
  assert.equal(launcher('reset',dataDir).status,0);assert.equal(existsSync(dataDir),false);
  mkdirSync(dataDir);
  const path=join(dataDir,'pet.sqlite');let store=createStore(path,base);
  store.points({delta:25,reason:'reset test',idempotencyKey:randomUUID()});store.close();
  writeFileSync(join(dataDir,'keep.txt'),'unrelated');
  const before=readFileSync(path);
  const info=launcher('info',dataDir);assert.equal(info.status,0,info.stderr||info.stdout);
  assert.equal(JSON.parse(info.stdout.replace(/^\uFEFF/, '')).dataPath,resolve(path));
  const reset=launcher('reset',dataDir);assert.equal(reset.status,0,reset.stderr||reset.stdout);
  assert.equal(existsSync(path),false);assert.equal(readFileSync(join(dataDir,'keep.txt'),'utf8'),'unrelated');
  const backup=join(dataDir,'backups',readdirSync(join(dataDir,'backups'))[0],'pet.sqlite');
  assert.deepEqual(readFileSync(backup),before);
  store=createStore(backup,base);assert.equal(store.snapshot().balance,25);store.close();
  store=createStore(path,base);assert.equal(store.snapshot().balance,0);assert.equal(store.db.prepare('SELECT count(*) AS n FROM credentials').get().n,0);store.close();
});

test('Windows reset refuses a database currently in use and leaves its contents intact', {skip:process.platform!=='win32'},t=>{
  const directory=mkdtempSync(join(tmpdir(),'meow-reset-live-')),path=join(directory,'pet.sqlite');
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const store=createStore(path,base);
  try{
    store.points({delta:17,reason:'keep live data',idempotencyKey:randomUUID()});
    const reset=launcher('reset',directory);assert.equal(reset.status,1,reset.stdout);
    assert.equal(existsSync(path),true);assert.equal(existsSync(join(directory,'backups')),false);
    assert.equal(store.snapshot().balance,17);
  }finally{store.close();}
});

test('Windows launcher starts on all interfaces, rejects a second instance and safely resets after stop', {skip:process.platform!=='win32',timeout:30000},async t=>{
  const directory=mkdtempSync(join(tmpdir(),'meow-launch-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const probe=createServer();await new Promise(r=>probe.listen(0,'0.0.0.0',r));
  const port=probe.address().port;await new Promise(r=>probe.close(r));
  // Test-only preload requests the server's normal shutdown without depending
  // on Windows process-tree enumeration. It never changes production code.
  const stopPath=join(directory,'stop-test-server');
  const preload=join(directory,'shutdown.mjs');
  writeFileSync(preload,`import {existsSync} from 'node:fs';
if (process.argv[1]?.replaceAll('\\\\','/').endsWith('/pet/server.mjs')) {
  const timer=setInterval(()=>{
    if(existsSync(${JSON.stringify(stopPath)})) {
      clearInterval(timer);
      process.emit('SIGTERM');
    }
  },100);
  timer.unref();
}
`);
  const args=['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'scripts/pet-launcher.ps1'),'-Action','start','-SkipFirewall','-NoBrowser'];
  const env={...process.env,NODE_OPTIONS:`${process.env.NODE_OPTIONS||''} --import="${pathToFileURL(preload).href}"`,MEOW_DATA_DIR:directory,MEOW_PORT:String(port),MEOW_PUBLIC_IP:'203.0.113.27',MEOW_ORIGIN:'',MEOW_TLS_CERT:'',MEOW_TLS_KEY:''};
  const child=spawn('powershell.exe',args,{cwd:tmpdir(),env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  try{
    await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>{cleanup();reject(new Error('Launcher did not become ready'));},15000);
      const data=chunk=>{output+=chunk;if(output.includes(`监听地址：0.0.0.0:${port}`)){cleanup();resolve();}};
      const end=code=>{cleanup();reject(new Error(`Launcher exited before readiness (${code})`));};
      const cleanup=()=>{clearTimeout(timer);child.stdout.off('data',data);child.off('exit',end);child.off('error',reject);};
      child.stdout.setEncoding('utf8');child.stdout.on('data',data);child.once('exit',end);child.once('error',reject);
    });
    assert.equal(await request(port),200);
    assert.equal(await request(port,{Host:`203.0.113.27:${port}`}),200);
    const duplicate=spawnSync('powershell.exe',args,{cwd:tmpdir(),env,encoding:'utf8',timeout:10000});
    assert.equal(duplicate.status,1,'duplicate launch must fail without opening another service');
    assert.equal(launcher('reset',directory).status,1,'reset must refuse the running launcher');
  }finally{
    writeFileSync(stopPath,'stop');
    let exited=await waitForExit(child,6000);
    if(child.exitCode===null){
      spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,encoding:'utf8',timeout:3000});
      exited=await waitForExit(child);
      if(!exited){
        child.kill('SIGTERM');
        exited=await waitForExit(child);
      }
    }
    child.stdout?.destroy();child.stderr?.destroy();child.unref();
    assert.ok(exited,'the launcher created by this test must exit');
  }
  const released=await listenWhenFree(port);
  await new Promise(r=>released.close(r));
  const reset=launcher('reset',directory);assert.equal(reset.status,0,reset.stdout||reset.stderr);
  const backup=join(directory,'backups',readdirSync(join(directory,'backups'))[0],'pet.sqlite');
  const restored=createStore(backup,base);
  try{assert.equal(restored.snapshot().balance,0);assert.equal(restored.catalog().rewards.length,101);}finally{restored.close();}
});
