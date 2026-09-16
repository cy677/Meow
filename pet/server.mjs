import http from 'node:http';
import { readFileSync, mkdirSync, createReadStream, statSync, realpathSync } from 'node:fs';
import { resolve, relative, extname, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces, hostname } from 'node:os';
import { randomBytes, createHash, timingSafeEqual, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { createStore } from './store.mjs';
import { AppError, fail, object, text } from './catalog.mjs';
const derive=promisify(scrypt);
const here=dirname(fileURLToPath(import.meta.url));
const digest=value=>createHash('sha256').update(value).digest('hex');
const random=()=>randomBytes(32).toString('hex');
const equal=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);};
const pin=value=>{if(typeof value!=='string'||!/^\d{6,12}$/.test(value))fail(400,'家长密码必须为 6–12 位数字');return value;};
const childCode=value=>{if(typeof value!=='string'||!/^\d{4,12}$/.test(value))fail(400,'孩子进入码必须为 4–12 位数字');return value;};

export async function createPetServer({ dbPath=resolve(here,'data/pet.sqlite'), catalogPath=resolve(here,'rewards.json'), staticDir=resolve(here,'dist'), dev=false, publicOrigin=process.env.MEOW_ORIGIN || '' }={}) {
  if(dbPath!==':memory:')mkdirSync(dirname(dbPath),{recursive:true,mode:0o700});
  const store=createStore(dbPath,JSON.parse(readFileSync(catalogPath,'utf8')));
  const db=store.db;
  const configured=()=>!!db.prepare("SELECT role FROM credentials WHERE role='parent'").get();
  let setupToken=configured()?null:random();
  const attempts=new Map();
  const cookieNames={parent:'meow_parent',child:'meow_child'};
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  const credential=role=>db.prepare('SELECT * FROM credentials WHERE role=?').get(role);
  async function hashCredential(value) { const salt=randomBytes(16).toString('hex');return {salt,hash:Buffer.from(await derive(value,salt,64)).toString('hex')}; }
  const saveCredential=(role,c)=>db.prepare('INSERT INTO credentials VALUES (?,?,?) ON CONFLICT(role) DO UPDATE SET salt=excluded.salt,hash=excluded.hash').run(role,c.salt,c.hash);
  async function verify(role,value) {
    const c=credential(role); if(!c||typeof value!=='string'||value.length>128)return false;
    const computed=Buffer.from(await derive(value,c.salt,64)).toString('hex');
    return equal(computed,c.hash) && credential(role)?.hash===c.hash;
  }
  const sessionToken=(req,role)=>(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieNames[role]+'='))?.slice(cookieNames[role].length+1)||'';
  const secureCookie=req=>publicOrigin?new URL(publicOrigin).protocol==='https:':!!req.socket.encrypted;
  function issueSession(req,res,role) {
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    // Rotate this browser's previous session without affecting other devices.
    db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(digest(sessionToken(req,role)));
    const token=random(),csrf=random(),ttl=role==='parent'?15*60:30*24*3600;
    const expires=Date.now()+ttl*1000;
    db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(digest(token),role,csrf,expires);
    res.setHeader('Set-Cookie',`${cookieNames[role]}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${ttl}${secureCookie(req)?'; Secure':''}`);
    return {csrf,expires};
  }
  function authorize(req,role,write=false) {
    const value=sessionToken(req,role);
    const s=value&&db.prepare('SELECT * FROM sessions WHERE tokenHash=? AND role=? AND expires>?').get(digest(value),role,Date.now());
    if(!s)fail(401,role==='parent'?'家长页面已锁定，请重新登录':'请输入孩子进入码');
    if(write&&!equal(req.headers['x-csrf-token']||'',s.csrf))fail(403,'请求验证失败，请刷新页面后重试');
    return s;
  }
  function throttle(req,role) {
    const key=`${req.socket.remoteAddress}:${role}`,now=Date.now();
    if(attempts.size>1000)for(const [k,v]of attempts)if(v.until<now)attempts.delete(k);
    let entry=attempts.get(key);
    if(!entry||entry.until<now){entry={count:0,until:now+5*60*1000};attempts.set(key,entry);}
    if(entry.count>=5)fail(429,'尝试过多，请 5 分钟后再试');
    entry.count++;
    return ()=>attempts.delete(key);
  }
  async function body(req) {
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))fail(415,'仅接受 application/json');
    if(req.headers['x-meow-client']!=='points-pet')fail(403,'缺少客户端标识');
    let size=0;const chunks=[];
    for await(const chunk of req){size+=chunk.length;if(size>131072)fail(413,'请求内容过大');chunks.push(chunk);}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'JSON 格式不正确');}
  }
  const knownHosts=new Set(['localhost','127.0.0.1','[::1]',hostname().toLowerCase()]);
  for(const list of Object.values(networkInterfaces()))for(const item of list||[])knownHosts.add(item.address.includes(':')?`[${item.address}]`:item.address);
  if(publicOrigin){const url=new URL(publicOrigin);if(!['http:','https:'].includes(url.protocol)||url.origin!==publicOrigin)throw new Error('MEOW_ORIGIN 必须是完整 origin，不含路径或结尾斜杠');}
  let vite;
  if(dev){const {createServer}=await import('vite');vite=await createServer({configFile:resolve(here,'vite.config.mjs'),server:{middlewareMode:true},appType:'mpa'});}
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon'};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    if(!dev)res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      if(!req.headers.host)fail(400,'缺少 Host');
      const hostUrl=new URL(`http://${req.headers.host}`);
      if(hostUrl.username||hostUrl.password)fail(403,'无效的 Host');
      const expectedOrigin=publicOrigin||`${secureCookie(req)?'https':'http'}://${req.headers.host}`;
      if(publicOrigin){if(hostUrl.host!==new URL(publicOrigin).host)fail(403,'Host 不在允许列表');}
      else if(!knownHosts.has(hostUrl.hostname.toLowerCase())||Number(hostUrl.port||80)!==server.address().port)fail(403,'Host 不在允许列表');
      if(req.headers.origin&&req.headers.origin!==expectedOrigin)fail(403,'不允许跨站请求');
      const path=new URL(req.url,expectedOrigin).pathname;
      const method=req.method;
      if(path.startsWith('/api/')) {
        if(method==='OPTIONS')fail(403,'不允许跨站调用');
        if(path==='/api/status'&&method==='GET')return json(res,200,{configured:configured()});
        if(path==='/api/parent/setup'&&method==='POST'){
          const data=object(await body(req),['setupToken','pin','childCode','childName','petName']);
          const reset=throttle(req,'setup');
          if(configured()||!setupToken||!equal(data.setupToken||'',setupToken))fail(403,'初始化口令无效');
          pin(data.pin);childCode(data.childCode);if(data.pin===data.childCode)fail(400,'家长密码与孩子进入码必须不同');
          const name=text(data.childName,'孩子昵称',20),petName=text(data.petName,'小猫名字',20);
          const parentHash=await hashCredential(data.pin),childHash=await hashCredential(data.childCode);
          store.tx(()=>{
            if(configured())fail(409,'系统已经初始化');
            saveCredential('parent',parentHash);saveCredential('child',childHash);
            db.prepare('UPDATE profile SET childName=?,petName=?,version=version+1 WHERE id=1').run(name,petName);
          });
          setupToken=null;reset();return json(res,200,{...issueSession(req,res,'parent'),state:store.snapshot(true)});
        }
        for(const role of ['parent','child']){
          if(path===`/api/${role}/login`&&method==='POST'){
            const data=object(await body(req),['code']);const reset=throttle(req,role);
            if(!await verify(role,data.code))fail(401,'密码或进入码不正确');
            reset();return json(res,200,{...issueSession(req,res,role),state:store.snapshot(role==='parent')});
          }
          if(path===`/api/${role}/session`&&method==='GET'){
            const s=authorize(req,role);return json(res,200,{csrf:s.csrf,expires:s.expires,state:store.snapshot(role==='parent')});
          }
          if(path===`/api/${role}/logout`&&method==='POST'){
            await body(req);authorize(req,role,true);
            db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(digest(sessionToken(req,role)));
            res.setHeader('Set-Cookie',`${cookieNames[role]}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secureCookie(req)?'; Secure':''}`);
            return json(res,200,{ok:true});
          }
        }
        const parent=path.startsWith('/api/parent/');
        authorize(req,parent?'parent':'child',method!=='GET');
        if(method==='GET') {
          if(path==='/api/state'||path==='/api/parent/state')return json(res,200,store.snapshot(parent));
          if(path==='/api/pet/config'){const s=store.snapshot();return json(res,200,{version:s.version,params:s.params,equipped:s.equipped,actions:store.catalog().rewards.filter(r=>r.category==='trick'&&s.owned.includes(r.id)).map(r=>({id:r.id,action:r.action}))});}
          if(path==='/api/parent/catalog')return json(res,200,store.catalog());
          if(path==='/api/parent/export'){res.setHeader('Content-Disposition','attachment; filename="meow-progress.json"');return json(res,200,store.exportData());}
        }
        if(method==='POST'||method==='PUT'){
          const data=await body(req);
          authorize(req,parent?'parent':'child',true);
          if(path==='/api/purchase'&&method==='POST'){object(data,['rewardId','idempotencyKey','expectedCost']);return json(res,200,store.purchase(data));}
          if(path==='/api/equip'&&method==='POST'){object(data,['rewardId']);return json(res,200,store.equip(data.rewardId));}
          if(path==='/api/play'&&method==='POST'){object(data,['rewardId']);return json(res,200,store.play(data.rewardId));}
          if(path==='/api/parent/points'&&method==='POST'){object(data,['delta','reason','idempotencyKey']);return json(res,200,store.points(data));}
          if(path==='/api/parent/profile'&&method==='PUT'){object(data,['childName','petName']);return json(res,200,store.profile(data));}
          if(path==='/api/parent/catalog'&&method==='PUT')return json(res,200,store.saveCatalog(data));
          if(path==='/api/parent/credentials'&&method==='PUT'){
            object(data,['currentPin','newPin','childCode']);const reset=throttle(req,'credentials');
            if(!await verify('parent',data.currentPin))fail(403,'当前家长密码不正确');
            if(!data.newPin&&!data.childCode)fail(400,'请填写新密码或新的孩子进入码');
            if(data.newPin)pin(data.newPin);if(data.childCode)childCode(data.childCode);
            if(data.newPin&&data.childCode&&data.newPin===data.childCode)fail(400,'两种密码必须不同');
            if(data.newPin&&!data.childCode&&await verify('child',data.newPin))fail(400,'两种密码必须不同');
            if(data.childCode&&!data.newPin&&await verify('parent',data.childCode))fail(400,'两种密码必须不同');
            const p=data.newPin?await hashCredential(data.newPin):null,c=data.childCode?await hashCredential(data.childCode):null;
            // Recheck authorization after asynchronous password hashing.
            authorize(req,'parent',true);
            store.tx(()=>{if(p){saveCredential('parent',p);db.prepare("DELETE FROM sessions WHERE role='parent'").run();}if(c){saveCredential('child',c);db.prepare("DELETE FROM sessions WHERE role='child'").run();}});
            reset();return json(res,200,{ok:true,...issueSession(req,res,'parent')});
          }
        }
        fail(404,'接口不存在');
      }
      if(!['GET','HEAD'].includes(method))fail(405,'不支持此方法');
      if(vite)return vite.middlewares(req,res,()=>json(res,404,{error:'页面不存在'}));
      const decoded=decodeURIComponent(path),root=resolve(staticDir),file=resolve(root,'.'+(decoded==='/'?'/index.html':decoded));
      const rel=relative(root,file);
      if(rel.startsWith('..')||isAbsolute(rel)||!types[extname(file)])fail(404,'文件不存在');
      let stat;try{stat=statSync(file);const realRel=relative(realpathSync(root),realpathSync(file));if(realRel.startsWith('..')||isAbsolute(realRel))fail(404,'文件不存在');}catch{fail(404,'页面尚未构建，请先运行 npm run pet:build');}
      if(!stat.isFile())fail(404,'文件不存在');
      res.writeHead(200,{'Content-Type':types[extname(file)],'Content-Length':stat.size,'Cache-Control':extname(file)==='.html'?'no-store':'public, max-age=3600'});
      if(method==='HEAD')return res.end();
      createReadStream(file).on('error',()=>res.destroy()).pipe(res);
    } catch(error) {
      if(!(error instanceof AppError))console.error(error);
      if(!res.headersSent)json(res,error.status||500,{error:error instanceof AppError?error.message:'服务暂时出错，请重试'});else res.destroy();
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return {server,store,get setupToken(){return setupToken;},async close(){await vite?.close();await new Promise((r,j)=>server.close(e=>e?j(e):r()));store.close();}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const host=process.env.MEOW_HOST||'127.0.0.1',port=Number(process.env.MEOW_PORT||8792);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('MEOW_PORT 必须是有效端口');
  const app=await createPetServer({dev:process.argv.includes('--dev'),...(process.env.MEOW_DATA_DIR?{dbPath:resolve(process.env.MEOW_DATA_DIR,'pet.sqlite')}:{})});
  app.server.listen(port,host,()=>{
    console.log(`\n孩子页面：http://localhost:${port}/\n家长页面：http://localhost:${port}/parent.html`);
    if(app.setupToken)console.log(`\n首次初始化：在家长页面输入以下一次性口令（不要交给孩子）：\n${app.setupToken}\n`);
    if(host==='0.0.0.0')console.log('已开放局域网。仅限可信家庭网络；公网部署必须配置 HTTPS。');
  });
  const shutdown=()=>app.close().then(()=>process.exit(0));process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
}
