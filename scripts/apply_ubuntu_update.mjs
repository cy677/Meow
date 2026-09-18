import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const patch=path.dirname(fileURLToPath(import.meta.url));
const target=fs.realpathSync(process.argv[2]);
if(target===patch||patch.startsWith(target+path.sep)||target.startsWith(patch+path.sep))throw new Error('请把补丁解压到安装目录之外。');
const manifest=JSON.parse(fs.readFileSync(path.join(patch,'manifest.json'),'utf8'));
const allowed=p=>p==='BUILD.json'||p==='src/coats.js'||/^pet\/[\w-]+\.mjs$/.test(p)||/^pet\/dist\/[\w./-]+$/.test(p);
function checked(root,relative){
  if(!allowed(relative)||relative.split('/').includes('..'))throw new Error('补丁路径不合法：'+relative);
  let current=root;
  for(const part of relative.split('/')){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw new Error('不支持符号链接：'+current);}
  return current;
}
for(const [file,hash] of Object.entries(manifest.files)){
  const src=checked(path.join(patch,'payload'),file);checked(target,file);
  if(createHash('sha256').update(fs.readFileSync(src)).digest('hex')!==hash)throw new Error('补丁校验失败：'+file);
}
const backup=path.join(target,'update-backups',new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid);
if(fs.existsSync(path.join(target,'update-backups'))&&fs.lstatSync(path.join(target,'update-backups')).isSymbolicLink())throw new Error('备份目录不能是符号链接');
fs.mkdirSync(backup,{recursive:true});
const units=['pet/dist',...Object.keys(manifest.files).filter(p=>!p.startsWith('pet/dist/'))];
const completed=[];
try{
  for(const file of units){
    const dest=path.join(target,file),saved=path.join(backup,file),source=path.join(patch,'payload',file);
    if(fs.existsSync(dest)){fs.mkdirSync(path.dirname(saved),{recursive:true});fs.renameSync(dest,saved);}
    completed.push({dest,saved});
    fs.mkdirSync(path.dirname(dest),{recursive:true});fs.cpSync(source,dest,{recursive:true});
  }
  fs.writeFileSync(path.join(backup,'UPDATE.json'),JSON.stringify({release:manifest.release,updatedAt:new Date().toISOString(),files:units},null,2));
  console.log('程序备份：'+backup);
}catch(error){
  for(const {dest,saved} of completed.reverse()){fs.rmSync(dest,{recursive:true,force:true});if(fs.existsSync(saved))fs.renameSync(saved,dest);}
  throw error;
}
