import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function runtimeFiles(root){
  const files=fs.readdirSync(path.join(root,'pet')).filter(f=>f.endsWith('.mjs')&&!['vite.config.mjs','studioBuild.mjs'].includes(f)).map(f=>'pet/'+f);
  for(const folder of ['api','services','repositories','contracts','config']){
    for(const file of fs.readdirSync(path.join(root,'pet',folder),{recursive:true})){
      const full=path.join(root,'pet',folder,file);
      if(fs.lstatSync(full).isSymbolicLink())throw new Error('运行模块不能为链接：'+full);
      if(fs.statSync(full).isFile()&&file.endsWith('.mjs'))files.push(`pet/${folder}/${file.replaceAll('\\','/')}`);
    }
  }
  return [...files,'src/coats.js'].sort();
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(runtimeFiles(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'))));
