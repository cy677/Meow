export function createApiClient({getCsrf=()=>'',fetchImpl=globalThis.fetch,timeoutMs=12000,signal}={}) {
  return async function request(path,method='GET',data,extraHeaders={}) {
    if(typeof path!=='string'||!path.startsWith('/api/'))throw new TypeError('仅允许同源业务接口');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      signal?.throwIfAborted();
      const response=await fetchImpl(path,{method,credentials:'same-origin',cache:'no-store',signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal,
        headers:{...(data===undefined?{}:{'Content-Type':'application/json','X-Meow-Client':'points-pet','X-CSRF-Token':getCsrf()}),...extraHeaders},
        ...(data===undefined?{}:{body:JSON.stringify(data)})});
      let result;
      try{result=await response.json();}catch{const error=new Error('服务返回了无效响应');error.status=response.status;throw error;}
      if(!response.ok){const error=new Error(result.error||'操作失败');error.status=response.status;throw error;}
      return result;
    } catch(error) {
      if(signal?.aborted)throw signal.reason;
      if(error.name==='AbortError')throw new Error('连接超时；请重试，幂等操作将沿用同一请求 ID');
      throw error;
    } finally { clearTimeout(timer); }
  };
}
