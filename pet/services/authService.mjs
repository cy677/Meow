import {createUserContext} from '../contracts/userContext.mjs';
import { randomBytes, createHash, timingSafeEqual, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { fail } from '../validation.mjs';
import { createAuthRepository } from '../repositories/authRepository.mjs';
const derive=promisify(scrypt);
const digest=value=>createHash('sha256').update(value).digest('hex');
const random=()=>randomBytes(32).toString('hex');
const equal=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);};
const pin=value=>{if(typeof value!=='string'||!/^\d{6,12}$/.test(value))fail(400,'家长密码必须为 6–12 位数字');return value;};
const childCode=value=>{if(typeof value!=='string'||!/^\d{4,12}$/.test(value))fail(400,'孩子进入码必须为 4–12 位数字');return value;};

export function createAuthService(store, publicOrigin) {
  const repo = createAuthRepository(store.db);
  const configured=()=>!!repo.credential('parent');
  let setupToken=configured()?null:random();
  const attempts=new Map();
  const cookieNames={parent:'meow_parent',child:'meow_child'};
  const credential=repo.credential;
  async function hashCredential(value) { const salt=randomBytes(16).toString('hex');return {salt,hash:Buffer.from(await derive(value,salt,64)).toString('hex')}; }
  const saveCredential=repo.saveCredential;
  async function verify(role,value) {
    const c=credential(role); if(!c||typeof value!=='string'||value.length>128)return false;
    const computed=Buffer.from(await derive(value,c.salt,64)).toString('hex');
    return equal(computed,c.hash) && credential(role)?.hash===c.hash;
  }
  const sessionToken=(req,role)=>(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieNames[role]+'='))?.slice(cookieNames[role].length+1)||'';
  const secureCookie=req=>publicOrigin?new URL(publicOrigin).protocol==='https:':!!req.socket.encrypted;
  function issueSession(req,res,role) {
    repo.removeExpired(Date.now());
    // Rotate this browser's previous session without affecting other devices.
    repo.removeSession(digest(sessionToken(req,role)));
    const token=random(),csrf=random(),ttl=role==='parent'?15*60:30*24*3600;
    const expires=Date.now()+ttl*1000;
    repo.saveSession(digest(token),role,csrf,expires);
    res.setHeader('Set-Cookie',`${cookieNames[role]}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${ttl}${secureCookie(req)?'; Secure':''}`);
    return {csrf,expires,context:createUserContext(role)};
  }
  function authorize(req,role,write=false) {
    const value=sessionToken(req,role);
    const s=value&&repo.session(digest(value),role,Date.now());
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
  return {
    configured, hashCredential, saveCredential, verify, sessionToken, secureCookie,
    issueSession, authorize, throttle, pin, childCode, equal,
    cookieNames, digest, repo,
    get setupToken() { return setupToken; },
    finishSetup() { setupToken = null; },
  };
}
