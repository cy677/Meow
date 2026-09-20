import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadSettings} from './settings.mjs';
const args=process.argv.slice(2),rootIndex=args.indexOf('--root');
const root=rootIndex>=0?args[rootIndex+1]:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
try {
  if(!root)throw new Error('--root 缺少安装目录');
  const result=loadSettings({root,create:!args.includes('--read-only'),args:['--lan']});
  const {options,config,dataDir}=result;
  const value={host:options.host,port:options.port,dataDir,publicIp:options.publicIp,openBrowser:config.openBrowser,configureFirewall:config.configureFirewall};
  if(args.includes('--data-dir')) console.log(dataDir);
  else if(args.includes('--nul')) {
    for(const key of ['port','dataDir','publicIp','openBrowser','host']) process.stdout.write(String(typeof value[key]==='boolean'?Number(value[key]):value[key])+'\0');
  } else console.log(JSON.stringify(value));
} catch(error) { console.error('配置错误：'+error.message);process.exitCode=1; }
