export function disposeObjects(roots, {keepTextures=[]}={}) {
 const geometries=new Set(),materials=new Set(),textures=new Set(),kept=new Set(keepTextures);
 const material=m=>{if(!m)return;materials.add(m);for(const value of Object.values(m))if(value?.isTexture&&!kept.has(value))textures.add(value);};
 for(const root of roots.filter(Boolean))root.traverse(o=>{
   if(o.geometry)geometries.add(o.geometry);
   (Array.isArray(o.material)?o.material:[o.material]).forEach(material);
   material(o.customDepthMaterial);material(o.customDistanceMaterial);
 });
 for(const geometry of geometries)geometry.dispose();
 for(const m of materials)m.dispose();
 for(const texture of textures)texture.dispose();
 for(const root of roots.filter(Boolean))root.removeFromParent();
}
