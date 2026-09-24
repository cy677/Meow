import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const patch=path.dirname(fileURLToPath(import.meta.url));
const target=fs.realpathSync(process.argv[2]);
const inside=(parent,child)=>child===parent||child.startsWith(parent+path.sep);
if(inside(target,patch)||inside(patch,target))throw new Error('请把补丁解压到安装目录之外。');
const manifest=JSON.parse(fs.readFileSync(path.join(patch,'manifest.json'),'utf8'));
const allowed=p=>['BUILD.json','Meow','pet-settings.example.json','src/coats.js','src/catAppearance/catalog.js','src/catMotion/motionScript.js','src/catMotion/clipCatalog.js'].includes(p)
  ||/^pet\/(?:api|services|repositories|contracts|config)\/[\w/-]+\.mjs$/.test(p)
  ||/^pet\/[\w-]+\.mjs$/.test(p)||/^pet\/dist\/[\w./-]+$/.test(p);
const stat=p=>fs.lstatSync(p,{throwIfNoEntry:false});
function checked(root,relative){
  if(typeof relative!=='string'||relative!==path.posix.normalize(relative)||relative.split('/').some(p=>!p||p==='.'||p==='..')||!allowed(relative))throw new Error('补丁路径不合法：'+relative);
  let current=root;
  for(const part of relative.split('/')){current=path.join(current,part);if(stat(current)?.isSymbolicLink())throw new Error('不支持符号链接：'+current);}
  return current;
}
if(!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files))throw new Error('补丁清单格式无效');
const payload=path.join(patch,'payload');
if(stat(payload)?.isSymbolicLink())throw new Error('补丁目录不能是符号链接');
function scan(dir,base=''){
  const files=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const rel=base+entry.name,full=path.join(dir,entry.name),info=fs.lstatSync(full);
    if(info.isSymbolicLink())throw new Error('不支持符号链接：'+rel);
    if(info.isDirectory())files.push(...scan(full,rel+'/'));
    else if(info.isFile())files.push(rel);
    else throw new Error('不支持特殊文件：'+rel);
  }
  return files;
}
const listed=Object.keys(manifest.files).sort(),actual=scan(payload).sort();
if(JSON.stringify(listed)!==JSON.stringify(actual))throw new Error('补丁文件集合与清单不一致');
if(!listed.includes('pet/dist/index.html'))throw new Error('补丁缺少主页面');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for(const [file,digest] of Object.entries(manifest.files)){
  if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))throw new Error('补丁校验值无效：'+file);
  if(hash(checked(payload,file))!==digest)throw new Error('补丁校验失败：'+file);
  checked(target,file);
}
const units=['pet/dist',...listed.filter(p=>!p.startsWith('pet/dist/'))];
// update.sh passes the directory resolved by the shared settings reader. Direct
// invocation retains legacy resolution, but must also follow the stop-service rule.
let dataDir=process.env.MEOW_DATA_DIR;
const configFile=path.join(target,'pet-settings.json');
if(!dataDir && fs.existsSync(configFile)){
  try{dataDir=JSON.parse(fs.readFileSync(configFile,'utf8').replace(/^\uFEFF/,'')).dataDir;}
  catch{throw new Error('无法读取家庭配置；未修改安装目录');}
}
dataDir=path.resolve(target,dataDir||'pet/data');
if(stat(dataDir)?.isSymbolicLink())dataDir=fs.realpathSync(dataDir);
const backupRoot=path.join(target,'update-backups');
if(stat(backupRoot)?.isSymbolicLink())throw new Error('备份目录不能是符号链接');
if(inside(dataDir,backupRoot)||inside(backupRoot,dataDir)||units.some(u=>inside(path.join(target,u),dataDir)||inside(dataDir,path.join(target,u))))throw new Error('家庭数据与待更新程序路径重叠');
const backup=path.join(backupRoot,new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid);
fs.mkdirSync(backup,{recursive:true,mode:0o700});
const staging=path.join(backup,'.staged'),completed=[];
try{
  // Prepare and re-check ALL bytes before replacing any program unit.
  for(const file of listed){
    const dest=path.join(staging,file);fs.mkdirSync(path.dirname(dest),{recursive:true});
    fs.copyFileSync(checked(payload,file),dest);
    if(hash(dest)!==manifest.files[file])throw new Error('暂存校验失败：'+file);
    fs.chmodSync(dest,file==='Meow'?0o755:0o644);
  }
  if(fs.existsSync(dataDir))fs.cpSync(dataDir,path.join(backup,'family-data'),{recursive:true,dereference:false,filter:p=>path.basename(p)!=='.meow-operation.lock'});
  if(fs.existsSync(configFile))fs.copyFileSync(configFile,path.join(backup,'pet-settings.json'));
  for(const file of units){
    const dest=path.join(target,file),saved=path.join(backup,'program',file),source=path.join(staging,file);
    if(fs.existsSync(dest)){fs.mkdirSync(path.dirname(saved),{recursive:true});fs.renameSync(dest,saved);}
    completed.push({dest,saved});fs.mkdirSync(path.dirname(dest),{recursive:true});fs.renameSync(source,dest);
  }
  fs.writeFileSync(path.join(backup,'UPDATE.json'),JSON.stringify({release:manifest.release,updatedAt:new Date().toISOString(),files:units,dataDir},null,2));
  fs.rmSync(staging,{recursive:true,force:true});
  console.log('程序与停服数据备份：'+backup);
}catch(error){
  for(const {dest,saved} of completed.reverse()){
    fs.rmSync(dest,{recursive:true,force:true});if(fs.existsSync(saved))fs.renameSync(saved,dest);
  }
  throw error;
}
