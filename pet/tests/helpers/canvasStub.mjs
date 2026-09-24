/** Math-only tests: texture painter calls are stubbed, not rendered. Real WebGL
 * and actual canvas validation live in browser-leaf-native.mjs. */
export function installCanvasStub() {
  const previousDocument=globalThis.document, previousPath=globalThis.Path2D;
  const makeContext=()=>new Proxy({}, {get(target,key){
    if(key in target)return target[key];
    if(key==='createLinearGradient'||key==='createRadialGradient')return ()=>({addColorStop(){}});
    return ()=>{};
  }});
  globalThis.document={createElement(name){if(name!=='canvas')throw new Error('Unexpected DOM use');return {width:0,height:0,getContext:()=>makeContext()};}};
  globalThis.Path2D=class {constructor(){return makeContext();}};
  return ()=>{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
    if(previousPath===undefined)delete globalThis.Path2D;else globalThis.Path2D=previousPath;};
}
export function disposeTestCat(cat,rig) {
  const geometries=new Set(),materials=new Set(),textures=new Set();
  cat.traverse(n=>{if(n.geometry)geometries.add(n.geometry);for(const m of [n.material].flat().filter(Boolean)){materials.add(m);if(m.map)textures.add(m.map);}});
  for(const g of geometries)g.dispose();for(const t of textures)t.dispose();for(const m of materials)m.dispose();rig?.skeleton.dispose();
}
