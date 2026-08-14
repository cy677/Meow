import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { saveBlob } from '#platform';

export function setupGlbExport({ button, getCat, getSeed }) {
  button?.addEventListener('click', () => {
    const cat = getCat();
    const restoreDynamicCoat = cat.userData.prepareDynamicCoatExport?.();
    new GLTFExporter().parse(
      cat,
      (result) => {
        restoreDynamicCoat?.();
        saveBlob(new Blob([result], { type: 'model/gltf-binary' }), `kitten_${getSeed()}.glb`);
      },
      (error) => {
        restoreDynamicCoat?.();
        console.error('GLB export failed', error);
      },
      { binary: true }
    );
  });
}
