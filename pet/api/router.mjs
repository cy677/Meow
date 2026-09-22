import {fail,object} from '../validation.mjs';
import {createUserContext} from '../contracts/userContext.mjs';
import {createUserService} from '../services/userService.mjs';
import {createRewardService} from '../services/rewardService.mjs';
import {createGrowthService} from '../services/growthService.mjs';
import {createStudioService} from '../services/studioService.mjs';
import {userRoutes} from './users.mjs';
import {rewardRoutes} from './rewards.mjs';
import {growthRoutes} from './growth.mjs';
import {studioRoutes} from './studio.mjs';
import {isAuthRoute,handleAuth,updateCredentials} from './auth.mjs';
import {body,json} from './http.mjs';

export function createApiRouter({store,auth}) {
  const routes=[...userRoutes(createUserService(store)),...rewardRoutes(createRewardService(store)),
    ...growthRoutes(createGrowthService(store)),...studioRoutes(createStudioService(store))];
  const lookup=new Map();
  for(const route of routes){const key=`${route[0]} ${route[1]}`;if(lookup.has(key))throw new Error('重复路由：'+key);lookup.set(key,route);}
  return async function route(req,res,path,origin) {
    const method=req.method;
    if(method==='OPTIONS')fail(403,'不允许跨站调用');
    const query=new URL(req.url,origin).searchParams;
    // Never silently route a requested foreign identity to the local child's data.
    if(query.has('userId')||query.has('profileId'))fail(400,'当前版本不接受用户或档案选择参数');
    if(isAuthRoute(path))return handleAuth({req,res,path,method,auth,store});
    if(path==='/api/parent/credentials'&&method==='PUT'){
      auth.authorize(req,'parent',true);const data=await body(req);
      auth.authorize(req,'parent',true);return updateCredentials({req,res,auth,store,data});
    }
    const entry=lookup.get(`${method} ${path}`);
    if(!entry){auth.authorize(req,path.startsWith('/api/parent/')?'parent':'child',method!=='GET');fail(404,'接口不存在');}
    const [, ,role,handler,keys]=entry;
    auth.authorize(req,role,method!=='GET');
    let data;
    if(method!=='GET'){
      data=await body(req);auth.authorize(req,role,true);
      if(keys)object(data,keys);
    }
    const user=createUserContext(role);
    return json(res,200,await handler({req,res,user,data,query}));
  };
}
