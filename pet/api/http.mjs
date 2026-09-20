import { fail } from '../validation.mjs';
export const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
export async function body(req) {
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))fail(415,'仅接受 application/json');
    if(req.headers['x-meow-client']!=='points-pet')fail(403,'缺少客户端标识');
    let size=0;const chunks=[];
    for await(const chunk of req){size+=chunk.length;if(size>1048576)fail(413,'请求内容过大');chunks.push(chunk);}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'JSON 格式不正确');}
  }
