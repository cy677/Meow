import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadSettings} from '../config/settings.mjs';
import {DEFAULT_GROWTH_TASKS} from '../growthCatalog.mjs';
import {runtimeFiles} from '../../scripts/runtimeFiles.mjs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meow-settings-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}

test('settings: existing household file is byte-preserved; environment overrides without persisting',t=>{
  const dir=fixture(t),file=path.join(dir,'pet-settings.json');
  const old='{"dataDir":"family","port":8844,"host":"127.0.0.1","custom":{"marker":1}}\n';fs.writeFileSync(file,old);
  fs.copyFileSync(path.join(root,'pet-settings.example.json'),path.join(dir,'pet-settings.example.json'));
  const result=loadSettings({root:dir,env:{MEOW_PORT:'9988'},create:true,args:['--lan']});
  assert.equal(result.options.host,'127.0.0.1');assert.equal(result.options.port,9988);
  assert.equal(result.dataDir,path.join(dir,'family'));assert.equal(result.config.custom.marker,1);
  assert.equal(fs.readFileSync(file,'utf8'),old);
});

test('settings: first run, loopback/LAN, relative paths and HTTPS share the same defaults',t=>{
  const dir=fixture(t);const result=loadSettings({root:dir,env:{},create:true});
  assert.equal(result.options.host,'127.0.0.1');assert.equal(result.options.port,8792);
  assert.ok(fs.existsSync(path.join(dir,'pet-settings.json')));
  const lan=loadSettings({root:dir,env:{},args:['--lan']});assert.equal(lan.options.host,'0.0.0.0');
  const tls=loadSettings({root:dir,env:{MEOW_TLS_CERT:'certs/site.pem',MEOW_TLS_KEY:'certs/site.key'}});
  assert.equal(tls.options.port,8793);assert.equal(tls.options.certPath,path.join(dir,'certs/site.pem'));
  assert.equal(tls.options.keyPath,path.join(dir,'certs/site.key'));
  assert.throws(()=>loadSettings({root:dir,env:{MEOW_TLS_CERT:'cert.pem'}}),/同时设置/);
});

test('settings: invalid data roots and config types fail before generating a household file',t=>{
  const dir=fixture(t);
  for(const dataDir of ['.','pet','pet/services/private','pet/dist/data','update-backups/data']){
    assert.throws(()=>loadSettings({root:dir,env:{MEOW_DATA_DIR:dataDir},create:true}),/数据目录/);
    assert.equal(fs.existsSync(path.join(dir,'pet-settings.json')),false);
  }
  fs.writeFileSync(path.join(dir,'pet-settings.json'),'[]');assert.throws(()=>loadSettings({root:dir,env:{}}),/JSON 对象/);
});

test('settings: physical symlink aliases cannot move household storage into program files',{skip:process.platform==='win32'},t=>{
  const dir=fixture(t);fs.mkdirSync(path.join(dir,'pet/services'),{recursive:true});
  fs.symlinkSync(path.join(dir,'pet/services'),path.join(dir,'alias'));
  assert.throws(()=>loadSettings({root:dir,env:{MEOW_DATA_DIR:'alias/family'}}),/数据目录/);
});

test('settings: default task identities retain legacy values and are explicit data',()=>{
  assert.equal(DEFAULT_GROWTH_TASKS.length,66);
  assert.equal(new Set(DEFAULT_GROWTH_TASKS.map(t=>t.id)).size,66);
  for(const task of DEFAULT_GROWTH_TASKS)assert.match(task.id,/^(preschool|school_basic|school_advanced)-(health|emotion|social|responsibility|learning|creativity)-[1-5]$/);
  assert.equal(DEFAULT_GROWTH_TASKS.find(t=>t.id==='preschool-health-1').title,'参与洗手或刷牙');
  const source=fs.readFileSync(new URL('../growthCatalog.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/id:`\$\{mode\}-\$\{category\}-\$\{i\+1\}`/);
});

test('settings: release inventory contains the real module graph and excludes household data',()=>{
  const files=runtimeFiles(root);
  for(const file of ['pet/server.mjs','pet/config/settings.mjs','pet/config/cli.mjs','pet/services/growthStore.mjs','pet/repositories/database.mjs','src/coats.js'])assert.ok(files.includes(file),file);
  assert.equal(new Set(files).size,files.length);
  assert.ok(files.every(file=>!file.includes('/data/')&&!file.includes('/tests/')&&!file.includes('pet-settings.json')));
  for(const file of files)assert.ok(fs.statSync(path.join(root,file)).isFile(),file);
});

test('settings: installed server reads custom household path even from another working directory',{timeout:10000},async t=>{
  const {spawn}=await import('node:child_process');const net=await import('node:net');
  const dir=fixture(t);for(const file of [...runtimeFiles(root),'pet/rewards.json','package.json']){
    fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.copyFileSync(path.join(root,file),path.join(dir,file));
  }
  fs.mkdirSync(path.join(dir,'pet/dist'));fs.writeFileSync(path.join(dir,'pet/dist/index.html'),'<html>ready</html>');
  const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const config=JSON.stringify({dataDir:'family with spaces',host:'127.0.0.1',port,openBrowser:false});
  fs.writeFileSync(path.join(dir,'pet-settings.json'),config);
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('MEOW_'))delete env[key];
  const child=spawn(process.execPath,[path.join(dir,'pet/server.mjs')],{cwd:os.tmpdir(),env,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});
  try{
    await new Promise((resolve,reject)=>{
      const check=setInterval(()=>{if(output.includes('监听地址：')){clearInterval(check);clearTimeout(limit);resolve();}else if(child.exitCode!==null){clearInterval(check);clearTimeout(limit);reject(new Error(output));}},25);
      const limit=setTimeout(()=>{clearInterval(check);reject(new Error('服务启动失败：'+output));},5000);
    });
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/status`)).status,200);
    assert.ok(fs.existsSync(path.join(dir,'family with spaces/pet.sqlite')));
    assert.equal(fs.existsSync(path.join(dir,'pet/data/pet.sqlite')),false);
    assert.equal(fs.readFileSync(path.join(dir,'pet-settings.json'),'utf8'),config);
  }finally{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}}
});
