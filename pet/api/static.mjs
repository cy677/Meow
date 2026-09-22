import {createReadStream,statSync,realpathSync} from 'node:fs';
import {resolve,relative,extname,isAbsolute} from 'node:path';
import {fail} from '../validation.mjs';
const types={'.glb':'model/gltf-binary','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.mp3':'audio/mpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon'};
export function serveStatic(req,res,path,staticDir){
  const method=req.method;
      if(!['GET','HEAD'].includes(method))fail(405,'不支持此方法');
      // Browsers request this automatically even when the page defines no icon.
      if(path==='/favicon.ico'&&!statSync(resolve(staticDir,'favicon.ico'),{throwIfNoEntry:false})){
        res.writeHead(204);return res.end();
      }
            const decoded=decodeURIComponent(path),root=resolve(staticDir),file=resolve(root,'.'+(decoded==='/'?'/index.html':decoded));
      const rel=relative(root,file);
      if(rel.startsWith('..')||isAbsolute(rel)||!types[extname(file)])fail(404,'文件不存在');
      let stat;try{stat=statSync(file);const realRel=relative(realpathSync(root),realpathSync(file));if(realRel.startsWith('..')||isAbsolute(realRel))fail(404,'文件不存在');}catch{fail(404,'页面尚未构建，请先运行 npm run pet:build');}
      if(!stat.isFile())fail(404,'文件不存在');
      res.writeHead(200,{'Content-Type':types[extname(file)],'Content-Length':stat.size,'Cache-Control':extname(file)==='.html'?'no-store':'public, max-age=3600'});
      if(method==='HEAD')return res.end();
      createReadStream(file).on('error',()=>res.destroy()).pipe(res);
}
