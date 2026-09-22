import {createUserContext} from '../contracts/userContext.mjs';
import {validateGrowthProfile} from '../growthStore.mjs';
import {fail,object,text} from '../validation.mjs';
import {body,json} from './http.mjs';
export const isAuthRoute = path => path==='/api/status'||path==='/api/parent/setup'||/^\/api\/(parent|child)\/(login|session|logout)$/.test(path);
export async function handleAuth({req,res,path,method,auth,store}) {
  const {configured,throttle,equal,pin,childCode,hashCredential,saveCredential,issueSession,verify,authorize,sessionToken,digest,cookieNames,secureCookie}=auth;
        if(path==='/api/status'&&method==='GET')return json(res,200,{configured:configured()});
        if(path==='/api/parent/setup'&&method==='POST'){
          const data=object(await body(req),['setupToken','pin','childCode','childName','petName','age','mode','enrolled','timeZone']);
          const reset=throttle(req,'setup');
          if(configured()||!auth.setupToken||!equal(data.setupToken||'',auth.setupToken))fail(403,'初始化口令无效');
          pin(data.pin);childCode(data.childCode);if(data.pin===data.childCode)fail(400,'家长密码与孩子进入码必须不同');
          const name=text(data.childName,'孩子昵称',20),petName=text(data.petName,'小猫名字',20);
          const growthProfile=validateGrowthProfile({age:data.age,mode:data.mode,enrolled:data.enrolled,timeZone:data.timeZone});
          const parentHash=await hashCredential(data.pin),childHash=await hashCredential(data.childCode);
          store.tx(()=>{
            if(configured())fail(409,'系统已经初始化');
            saveCredential('parent',parentHash);saveCredential('child',childHash);store.growth.initialize(growthProfile);
            auth.repo.initializeNames(name,petName);
          });
          auth.finishSetup();reset();return json(res,200,{...issueSession(req,res,'parent'),state:store.snapshot(true)});
        }
        for(const role of ['parent','child']){
          if(path===`/api/${role}/login`&&method==='POST'){
            const data=object(await body(req),['code']);const reset=throttle(req,role);
            if(!await verify(role,data.code))fail(401,'密码或进入码不正确');
            reset();return json(res,200,{...issueSession(req,res,role),state:store.snapshot(role==='parent')});
          }
          if(path===`/api/${role}/session`&&method==='GET'){
            const s=authorize(req,role);return json(res,200,{csrf:s.csrf,expires:s.expires,context:createUserContext(role),state:store.snapshot(role==='parent')});
          }
          if(path===`/api/${role}/logout`&&method==='POST'){
            await body(req);authorize(req,role,true);
            auth.repo.removeSession(digest(sessionToken(req,role)));
            res.setHeader('Set-Cookie',`${cookieNames[role]}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secureCookie(req)?'; Secure':''}`);
            return json(res,200,{ok:true});
          }
        }
  fail(404,'接口不存在');
}

export async function updateCredentials({req,res,auth,store,data}){
  const {throttle,verify,pin,childCode,hashCredential,authorize,saveCredential,issueSession}=auth;
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
            store.tx(()=>{if(p){saveCredential('parent',p);auth.repo.revoke('parent');}if(c){saveCredential('child',c);auth.repo.revoke('child');}});
            reset();return json(res,200,{ok:true,...issueSession(req,res,'parent')});
}
