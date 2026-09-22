import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {runtimeFiles} from './runtimeFiles.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
function option(key){const i=args.indexOf(key);if(i<0)return null;if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(key+'缺少值');return args[i+1];}
for(let i=0;i<args.length;i+=2)if(!['--name','--base-build'].includes(args[i]))throw new Error('不支持的参数：'+args[i]);
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const name=option('--name')||`Meow-${pkg.version}-Ubuntu-update-${new Date().toISOString().replace(/[-:.]/g,'')}`;
if(!/^[\w.-]+$/.test(name)||name==='.'||name==='..')throw new Error('输出名称无效');
const out=path.join(root,'Exports',name),payload=path.join(out,'payload');
if(fs.existsSync(out))throw new Error('输出目录已存在；请使用新的发布名称，避免混入旧文件');
if(!fs.existsSync(path.join(root,'pet/dist/index.html')))throw new Error('请先执行 npm run pet:build');
const previousPath=option('--base-build');
const previous=previousPath?JSON.parse(fs.readFileSync(path.resolve(previousPath),'utf8').replace(/^\uFEFF/,'')):{};
let commit=process.env.MEOW_SOURCE_REVISION||null;
if(!commit){try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}}
fs.mkdirSync(payload,{recursive:true});
for(const file of [...runtimeFiles(root),'Meow','pet-settings.example.json']){
  const dest=path.join(payload,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,file),dest);
}
fs.cpSync(path.join(root,'pet/dist'),path.join(payload,'pet/dist'),{recursive:true});
fs.writeFileSync(path.join(payload,'BUILD.json'),JSON.stringify({...previous,release:name,version:pkg.version,commit,updatedAt:new Date().toISOString(),dataIncluded:false},null,2));
fs.copyFileSync(path.join(root,'scripts/apply_ubuntu_update.sh'),path.join(out,'update.sh'));
fs.copyFileSync(path.join(root,'scripts/apply_ubuntu_update.mjs'),path.join(out,'apply-update.mjs'));
// The outer helper uses the same config reader even when updating a pre-module installation.
fs.cpSync(path.join(root,'pet/config'),path.join(out,'config'),{recursive:true});
fs.copyFileSync(path.join(root,'pet/lan.mjs'),path.join(out,'lan.mjs'));
const files={};
for(const file of fs.readdirSync(payload,{recursive:true})){
  const full=path.join(payload,file);if(fs.lstatSync(full).isSymbolicLink())throw new Error('补丁不接受链接');
  if(fs.statSync(full).isFile())files[file.replaceAll('\\','/')]=createHash('sha256').update(fs.readFileSync(full)).digest('hex');
}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({schemaVersion:1,release:name,files},null,2));
fs.writeFileSync(path.join(out,'使用说明.txt'),'Meow Ubuntu 程序更新\n\n停止所有旧服务，备份数据。补丁放在安装目录外。\n执行 bash update.sh /绝对安装目录\n自定义 MEOW_DATA_DIR 须与服务保持一致。\n更新保留实际配置和家庭数据；停服快照与程序备份存于 update-backups。\n未实现断电后的自动恢复或数据库版本降级。SHA-256 校验不等于发布者签名。\n');
console.log(out);
