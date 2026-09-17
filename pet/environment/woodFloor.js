import * as THREE from 'three';
// Extracted from the upstream src/main.js procedural wood-floor renderer.
// Original algorithm, seed, palettes and copyright/license remain attributable to Meow Generator.
export function createWoodFloor(scene, renderer) {
 const canvas=document.createElement('canvas'); canvas.width=canvas.height=1024;
 const groundTexture=new THREE.CanvasTexture(canvas);
 groundTexture.colorSpace=THREE.SRGBColorSpace;
 groundTexture.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8);
 groundTexture.userData.canvas=canvas;
 let floorParams={baseColor:'#d9b77f',seamColor:'#7d5b3e',grainColor:'#9f744d',plankWidth:.82,grainDensity:.72,direction:8};
function drawWoodFloor() {
  const c = groundTexture.userData.canvas;
  const g = c.getContext('2d');
  const size = c.width;
  const pxScale = size / 1024;
  const extent = size * 1.55;
  const plankPx = THREE.MathUtils.clamp(
    floorParams.plankWidth * size / 20,
    22 * pxScale,
    110 * pxScale
  );
  const boardLength = plankPx * 4.1;
  const base = new THREE.Color(floorParams.baseColor);
  const light = base.clone().offsetHSL(0.01, -0.02, 0.035).getStyle();
  const dark = base.clone().offsetHSL(-0.01, 0.025, -0.035).getStyle();
  let woodSeed = 177013;
  const rand = () => {
    woodSeed = (woodSeed * 1664525 + 1013904223) >>> 0;
    return woodSeed / 4294967296;
  };
  const wavyLine = (x0, y0, x1, y1, wobble, steps = 36) => {
    g.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = THREE.MathUtils.lerp(x0, x1, t);
      const y = THREE.MathUtils.lerp(y0, y1, t)
        + Math.sin(t * Math.PI * 4.2 + y0 * 0.017 / pxScale) * wobble
        + Math.sin(t * Math.PI * 9.7 + x0 * 0.011 / pxScale) * wobble * 0.35;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  };

  g.clearRect(0, 0, size, size);
  g.fillStyle = floorParams.baseColor;
  g.fillRect(0, 0, size, size);
  g.save();
  g.translate(size / 2, size / 2);
  g.rotate(THREE.MathUtils.degToRad(floorParams.direction));

  const rowStart = -Math.ceil(extent / plankPx / 2);
  const rowEnd = Math.ceil(extent / plankPx / 2);
  for (let row = rowStart; row <= rowEnd; row++) {
    const y = row * plankPx;
    g.fillStyle = row % 2 === 0 ? light : dark;
    g.globalAlpha = 0.32;
    g.fillRect(-extent / 2, y, extent, plankPx);
    g.globalAlpha = 1;

    g.strokeStyle = floorParams.seamColor;
    g.lineWidth = 2.7 * pxScale;
    g.globalAlpha = 0.62;
    wavyLine(-extent / 2, y, extent / 2, y, 1.8 * pxScale, 64);

    const stagger = (Math.abs(row) % 2) * boardLength * 0.47;
    for (let x = -extent / 2 - boardLength + stagger; x < extent / 2; x += boardLength) {
      g.beginPath();
      g.moveTo(x + Math.sin(row * 1.7) * 1.6 * pxScale, y + pxScale);
      g.bezierCurveTo(
        x - 2.5 * pxScale, y + plankPx * 0.3,
        x + 3.5 * pxScale, y + plankPx * 0.7,
        x + Math.cos(row * 1.3) * 1.4 * pxScale, y + plankPx - pxScale
      );
      g.stroke();
    }

    const grainCount = Math.round((extent / (110 * pxScale)) * floorParams.grainDensity);
    g.strokeStyle = floorParams.grainColor;
    g.lineWidth = 1.45 * pxScale;
    g.globalAlpha = 0.28;
    for (let i = 0; i < grainCount; i++) {
      const x = rand() * extent - extent / 2;
      const gy = y + plankPx * (0.18 + rand() * 0.64);
      const len = plankPx * (1.4 + rand() * 3.8);
      g.beginPath();
      g.moveTo(x, gy);
      g.bezierCurveTo(
        x + len * 0.3, gy + (rand() - 0.5) * 7 * pxScale,
        x + len * 0.72, gy + (rand() - 0.5) * 7 * pxScale,
        x + len, gy + (rand() - 0.5) * 3 * pxScale
      );
      g.stroke();
    }

    if (row % 3 === 0) {
      const knotX = (rand() - 0.5) * extent;
      const knotY = y + plankPx * (0.3 + rand() * 0.4);
      g.globalAlpha = 0.22;
      g.beginPath();
      g.ellipse(knotX, knotY, plankPx * 0.28, plankPx * 0.11, 0.12, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.ellipse(knotX, knotY, plankPx * 0.14, plankPx * 0.05, 0.12, 0, Math.PI * 2);
      g.stroke();
    }
  }

  g.globalAlpha = 1;
  g.restore();
  groundTexture.needsUpdate = true;
}

 const mesh=new THREE.Mesh(new THREE.CircleGeometry(10,64),new THREE.MeshToonMaterial({map:groundTexture}));
 mesh.name='reward-wood-floor';mesh.rotation.x=-Math.PI/2;mesh.position.y=-.015;mesh.receiveShadow=true;scene.add(mesh);
 return {mesh,set(params){floorParams={...floorParams,...params};drawWoodFloor();},dispose(){scene.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();groundTexture.dispose();}};
}
