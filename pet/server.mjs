import {loadSettings} from './config/settings.mjs';
import http from 'node:http';
import https from 'node:https';
import { createSecureContext } from 'node:tls';
import { accessUrls, requestOrigin, normalizePublicIp } from './lan.mjs';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces, hostname } from 'node:os';
import { createStore } from './store.mjs';
import { AppError, fail } from './validation.mjs';
import { createAuthService } from './services/authService.mjs';
import { createApiRouter } from './api/router.mjs';
import { json } from './api/http.mjs';
import { serveStatic } from './api/static.mjs';
const here=dirname(fileURLToPath(import.meta.url));

export async function createPetServer({ dbPath=resolve(here,'data/pet.sqlite'), catalogPath=resolve(here,'rewards.json'), staticDir=resolve(here,'dist'), dev=false, publicOrigin=process.env.MEOW_ORIGIN || '', publicIp=process.env.MEOW_PUBLIC_IP || '', tls=null }={}) {
  publicIp=normalizePublicIp(publicIp);
  // Validate TLS before touching the local database; never silently downgrade.
  if(tls){if(!tls.key||!tls.cert)throw new Error('HTTPS 缺少证书或私钥');createSecureContext(tls);if(dev)throw new Error('HTTPS 模式需要先构建页面');}
  if(publicOrigin){const url=new URL(publicOrigin);if(!['http:','https:'].includes(url.protocol)||url.origin!==publicOrigin)throw new Error('MEOW_ORIGIN 必须是完整 origin，不含路径或结尾斜杠');if(tls&&url.protocol!=='https:')throw new Error('HTTPS 服务不能配置 HTTP origin');}
  if(dbPath!==':memory:')mkdirSync(dirname(dbPath),{recursive:true,mode:0o700});
  const store=createStore(dbPath,JSON.parse(readFileSync(catalogPath,'utf8')));
  store.installSceneRewards();
  store.installUpstreamRewards();
  store.installGrowthReward();
  const auth=createAuthService(store,publicOrigin);
  const api=createApiRouter({store,auth});
  const knownHosts=new Set(['localhost','127.0.0.1','[::1]',hostname().toLowerCase()]);
  if(publicIp)knownHosts.add(publicIp.includes(':')?`[${publicIp}]`:publicIp);
  for(const list of Object.values(networkInterfaces()))for(const item of list||[])knownHosts.add(item.address.includes(':')?`[${item.address}]`:item.address);
  let vite;
  if(dev){const {createServer}=await import('vite');vite=await createServer({configFile:resolve(here,'vite.config.mjs'),server:{middlewareMode:true},appType:'mpa'});}
  const handler=async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), accelerometer=(self), gyroscope=(self), magnetometer=()');
    if(!dev)res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      if(!req.headers.host)fail(400,'缺少 Host');
      let expectedOrigin;
      try{expectedOrigin=requestOrigin(req.headers.host,{protocol:tls?'https:':'http:',port:server.address().port,knownHosts,publicOrigin});}
      catch{fail(403,'Host 不在允许列表');}
      if(req.headers.origin&&req.headers.origin!==expectedOrigin)fail(403,'不允许跨站请求');
      const path=new URL(req.url,expectedOrigin).pathname;
      // Upstream controls use element style attributes; exports preview local Blob images.
      if(path==='/studio.html'){
        res.setHeader('X-Frame-Options','SAMEORIGIN');
        if(!dev)res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'");
      }
      if(path.startsWith('/api/'))return await api(req,res,path,expectedOrigin);
      if(!['GET','HEAD'].includes(req.method))fail(405,'不支持此方法');
      if(vite)return vite.middlewares(req,res,()=>json(res,404,{error:'页面不存在'}));
      return serveStatic(req,res,path,staticDir);
    } catch(error) {
      if(!(error instanceof AppError))console.error(error);
      if(!res.headersSent)json(res,error.status||500,{error:error instanceof AppError?error.message:'服务暂时出错，请重试'});else res.destroy();
    }
  };
  const server=tls?https.createServer(tls,handler):http.createServer(handler);
  server.requestTimeout=15000;server.headersTimeout=10000;
  return {server,store,get setupToken(){return auth.setupToken;},async close(){await vite?.close();await new Promise((r,j)=>server.close(e=>e?j(e):r()));store.close();}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {
    const settings=loadSettings({root:resolve(here,'..'),create:true,args:process.argv.slice(2)});
    const options=settings.options;
    const {host,port,dev,useTls,certPath,keyPath}=options;
    const tls=useTls?{cert:readFileSync(certPath),key:readFileSync(keyPath)}:null;
    const app=await createPetServer({dev,tls,dbPath:resolve(settings.dataDir,'pet.sqlite'),publicIp:options.publicIp,publicOrigin:settings.env.MEOW_ORIGIN||''});
    app.server.on('error',error=>{
      console.error(error.code==='EADDRINUSE'?`端口 ${port} 已被占用，请关闭旧服务或设置 MEOW_PORT。`:error.message);
      app.store.close();process.exitCode=1;
    });
    app.server.listen(port,host,()=>{
      console.log(`本地数据文件：${app.store.storageInfo().path}（积分、理由、兑换和预设均保存在此处）`);
      console.log(`监听地址：${host}:${port}`);
      for(const url of accessUrls(options))console.log(`\n孩子页面：${url}/\n家长页面：${url}/parent.html`);
      if(app.setupToken)console.log(`\n首次初始化口令（仅家长保管）：\n${app.setupToken}\n`);
      if(host==='0.0.0.0'||host==='::')console.log('Pad 请连接同一局域网，选择电脑实际使用的 IP；VPN/虚拟网卡地址不一定可达。');
      console.log(useTls?'倾斜功能需 Pad 信任此证书，再在页面主动授权。':'HTTP 支持触摸；倾斜传感器需可信 HTTPS，参见 pet/PAD.md。');
      console.log('外网访问需放行网页 TCP 端口；公网登录建议使用 HTTPS，配置见 pet/PAD.md。');
      if(options.openBrowser){
        const origin=process.env.MEOW_ORIGIN||`${useTls?'https':'http'}://localhost:${port}`;
        const url=origin+(app.setupToken?'/parent.html':'/');
        const command=process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open';
        const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];
        const browser=spawn(command,args,{stdio:'ignore',windowsHide:true});
        browser.on('error',()=>console.log(`请手动打开：${url}`));browser.unref();
      }
    });
    let stopping=false;
    const shutdown=()=>{if(stopping)return;stopping=true;app.close().then(()=>process.exit(0)).catch(()=>process.exit(1));};
    process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  } catch(error) { console.error(`启动失败：${error.message}`);process.exitCode=1; }
}
