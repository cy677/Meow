import fs from 'node:fs';
import path from 'node:path';
import {normalizePublicIp, launchOptions} from '../lan.mjs';

export const SETTINGS_FILE = 'pet-settings.json';
export const EXAMPLE_FILE = 'pet-settings.example.json';
const defaults = {dataDir:'pet/data',publicIp:'',openBrowser:true,configureFirewall:true};
const exists = file => !!fs.lstatSync(file,{throwIfNoEntry:false});
const present = value => value !== undefined && value !== null && String(value).trim() !== '';
function readObject(file) {
  const value=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('配置必须是 JSON 对象：'+file);
  return value;
}
function nonempty(value,name) {
  if(typeof value!=='string' || !value.trim() || /[\0\r\n]/.test(value)) throw new Error(name+'必须是非空单行字符串');
  return value.trim();
}
export function containsPath(parent,child) {
  const rel=path.relative(parent,child);
  return rel==='' || (rel!=='..' && !rel.startsWith('..'+path.sep) && !path.isAbsolute(rel));
}
// Resolve existing ancestors as well, so a symlink cannot hide a program directory.
export function physicalPath(value) {
  let current=path.resolve(value),suffix=[];
  while(!exists(current)) { suffix.unshift(path.basename(current)); current=path.dirname(current); }
  return path.join(fs.realpathSync(current),...suffix);
}
/** Environment > household file > example > defaults. Existing files are never rewritten.
 * The legacy pet/data location remains valid; paths are installation-root-relative.
 */
export function loadSettings({root,env=process.env,create=false,args=[]}) {
  root=path.resolve(root);
  const file=path.join(root,SETTINGS_FILE),example=path.join(root,EXAMPLE_FILE);
  const base={...defaults,...(exists(example)?readObject(example):{})};
  const config={...base,...(exists(file)?readObject(file):{})};
  const effective={...env};
  for(const [key,name] of [['host','MEOW_HOST'],['port','MEOW_PORT']]) {
    if(!present(effective[name]) && present(config[key])) effective[name]=String(config[key]);
  }
  if(present(effective.MEOW_HOST)) {
    const host=nonempty(effective.MEOW_HOST,'监听地址');
    if(/[\s/\\?#@]/.test(host)) throw new Error('监听地址不能含协议、路径或空白');
    effective.MEOW_HOST=host;
  }
  const dataDir=path.resolve(root,nonempty(present(env.MEOW_DATA_DIR)?env.MEOW_DATA_DIR:config.dataDir,'数据目录'));
  const physical=physicalPath(dataDir),install=physicalPath(root);
  if(physical===install || physical===physicalPath(path.join(root,'pet'))) throw new Error('数据目录不能是程序根目录');
  for(const dir of ['.git','src','scripts','runtime','node_modules','dist','update-backups','pet/dist','pet/api','pet/services','pet/repositories','pet/contracts','pet/config','pet/ui','pet/runtime','pet/tests','pet/environment']) {
    if(containsPath(physicalPath(path.join(root,dir)),physical)) throw new Error('数据目录不能位于程序模块目录：'+dataDir);
  }
  effective.MEOW_DATA_DIR=dataDir;
  effective.MEOW_PUBLIC_IP=normalizePublicIp(env.MEOW_PUBLIC_IP!==undefined?env.MEOW_PUBLIC_IP:config.publicIp);
  for(const key of ['openBrowser','configureFirewall']) if(typeof config[key]!=='boolean') throw new Error(key+'必须是布尔值');
  for(const key of ['MEOW_TLS_CERT','MEOW_TLS_KEY']) if(present(effective[key])) effective[key]=path.resolve(root,nonempty(effective[key],key));
  const options=launchOptions(args,effective);
  // Validate everything before writing defaults. Exclusive creation also protects races.
  if(create && !exists(file)) {
    try { fs.writeFileSync(file,JSON.stringify(base,null,2)+'\n',{flag:'wx',mode:0o600}); }
    catch(error) { if(error.code!=='EEXIST') throw error; return loadSettings({root,env,create:false,args}); }
  }
  return {configPath:file,dataDir,config,env:effective,options};
}
