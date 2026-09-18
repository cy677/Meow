import { readFileSync } from 'node:fs';
// Reuse the original renderer and original HTML, not a reduced reconstruction.
export function studioBuild() {
  const template=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const bridge=readFileSync(new URL('./studioRuntime.txt',import.meta.url),'utf8');
  return {name:'pet-original-runtime',enforce:'pre',
    transformIndexHtml:{order:'pre',handler(html,context){
      if(!context.filename.replaceAll('\\','/').endsWith('/pet/studio.html'))return html;
      return template.replaceAll('/src/','../src/').replace('src="../src/main.js"','src="./studio.js"').replace('<title>Meow Generator</title>','<title>原版互动 · Meow 积分小猫</title>');
    }},
    transform(code,id){
      if(!id.replaceAll('\\','/').endsWith('/src/main.js'))return null;
      return {code:code.replace('const i18n =','const petControlSyncs = [];\nconst i18n =').replaceAll('return { row, input, sync };','petControlSyncs.push(sync); return { row, input, sync };').replaceAll('return { row, select, sync };','petControlSyncs.push(sync); return { row, select, sync };').replaceAll('return refresh;','petControlSyncs.push(refresh); return refresh;')+'\n'+bridge,map:null};
    },
  };
}
