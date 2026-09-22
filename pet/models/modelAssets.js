import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

/** Layer-owned cache: geometry/textures are shared; instance materials and outlines are disposable. */
export function createModelAssets() {
  const loader = new GLTFLoader(), cache = new Map();
  let disposed = false;
  const gradient = new THREE.DataTexture(new Uint8Array([216,244,255]),3,1,THREE.RedFormat);
  gradient.minFilter=gradient.magFilter=THREE.NearestFilter;gradient.needsUpdate=true;
  function disposeSource(gltf) {
    const geometry=new Set(),materials=new Set(),textures=new Set();
    gltf.scene.traverse(o=>{if(!o.isMesh)return;geometry.add(o.geometry);for(const m of [].concat(o.material)){materials.add(m);for(const value of Object.values(m))if(value?.isTexture)textures.add(value);}});
    for(const g of geometry)g.dispose();for(const m of materials)m.dispose();
    for(const t of textures){t.dispose();t.source?.data?.close?.();}
  }
  async function source(path) {
    if(disposed)throw new Error('模型资源已释放');
    if(!cache.has(path)) {
      const url=new URL(`${import.meta.env.BASE_URL||'./'}${path}`,document.baseURI).href;
      const pending=loader.loadAsync(url).then(gltf=>{if(disposed){disposeSource(gltf);throw new Error('模型资源已释放');}return gltf;}).catch(error=>{cache.delete(path);throw error;});
      cache.set(path,pending);
    }
    return cache.get(path);
  }
  return {
    async instantiate(path,size,{color,horizontal=false}={}) {
      const gltf=await source(path);
      if(disposed)throw new Error('模型资源已释放');
      const model=clone(gltf.scene),box=new THREE.Box3().setFromObject(model),raw=box.getSize(new THREE.Vector3());
      const scale=size/Math.max(.0001,horizontal?Math.max(raw.x,raw.z):Math.max(raw.x,raw.y,raw.z));
      const center=box.getCenter(new THREE.Vector3()),root=new THREE.Group(),normalizer=new THREE.Group();
      normalizer.scale.setScalar(scale);normalizer.position.set(-center.x*scale,-box.min.y*scale,-center.z*scale);normalizer.add(model);root.add(normalizer);
      const geometries=[],materials=[],meshes=[];model.traverse(o=>{if(o.isMesh)meshes.push(o);});
      for(const mesh of meshes) {
        mesh.castShadow=false;mesh.receiveShadow=false;
        mesh.material=[].concat(mesh.material).map(original=>{
          const material=new THREE.MeshToonMaterial({color:color??original.color??0xffffff,map:color?null:original.map,gradientMap:gradient,vertexColors:original.vertexColors,transparent:original.transparent,opacity:original.opacity,alphaTest:original.alphaTest,side:original.side});
          material.name=original.name;material.color.multiply(new THREE.Color('#fff7ee'));materials.push(material);return material;
        });
        if(mesh.material.length===1)mesh.material=mesh.material[0];
        // Inverted hull inherits the animated node transform; preserve skinning if future assets have it.
        const geometry=mesh.geometry.clone(),positions=geometry.getAttribute('position'),normals=geometry.getAttribute('normal');
        if(normals){
          const localScale=mesh.getWorldScale(new THREE.Vector3());
          const width=.0035/Math.max(.0001,Math.max(localScale.x,localScale.y,localScale.z));
          for(let i=0;i<positions.count;i++)positions.setXYZ(i,positions.getX(i)+normals.getX(i)*width,positions.getY(i)+normals.getY(i)*width,positions.getZ(i)+normals.getZ(i)*width);
          positions.needsUpdate=true;
          const material=new THREE.MeshBasicMaterial({color:'#4a3428',side:THREE.BackSide});
          const outline=mesh.isSkinnedMesh?new THREE.SkinnedMesh(geometry,material):new THREE.Mesh(geometry,material);
          if(mesh.isSkinnedMesh)outline.bind(mesh.skeleton,mesh.bindMatrix);
          outline.name='model-outline';outline.userData.modelOutline=true;outline.raycast=()=>{};
          mesh.add(outline);geometries.push(geometry);materials.push(material);
        }else geometry.dispose();
      }
      root.updateMatrixWorld(true);
      const dimensions=raw.multiplyScalar(scale);
      return {root,model,dimensions,clips:gltf.animations,dispose(){root.removeFromParent();for(const m of materials)m.dispose();for(const g of geometries)g.dispose();}};
    },
    dispose(){disposed=true;for(const pending of cache.values())pending.then(disposeSource,()=>{});cache.clear();gradient.dispose();},
    get size(){return cache.size;},
  };
}
