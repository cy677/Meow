import * as THREE from 'three';
import { LEAF_PALETTE } from './catalog.js';
import { sampleExpression } from '../catMotion/expression.js';

const COLS = 8, ROWS = 4, FRAME_COUNT = COLS * ROWS, CELL = 128;
/** Reuse native projected mouth; one atlas upload per model, no per-frame repaint.
 * No manual mouth controls: the renderer consumes the body's published pose.
 */
export function installMouth(cat, { face, headC, hr, muzzle, project, decal, pose = 'standing' }) {
  const canvas = document.createElement('canvas'); canvas.width = COLS*CELL; canvas.height = ROWS*CELL;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建口型纹理');
  for (let frame=1; frame<FRAME_COUNT; frame++) {
    const next=frame/(FRAME_COUNT-1);
    ctx.save(); ctx.translate((frame%COLS)*CELL, Math.floor(frame/COLS)*CELL); ctx.scale(CELL/256,CELL/256);
      const top = 54, bottom = top + 158 * next;
      ctx.beginPath(); ctx.moveTo(40, top);
      ctx.bezierCurveTo(62, top + 18, 194, top + 18, 216, top);
      ctx.bezierCurveTo(221, bottom - 38 * next, 176, bottom, 128, bottom);
      ctx.bezierCurveTo(80, bottom, 35, bottom - 38 * next, 40, top); ctx.closePath();
      ctx.fillStyle = LEAF_PALETTE.mouth; ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = LEAF_PALETTE.tongue; ctx.beginPath();
      ctx.ellipse(128, bottom - 7 * next, 44, 37 * next, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff8e7';
      for (const x of [65, 186]) {
        ctx.beginPath(); ctx.moveTo(x - 9, top + 5); ctx.lineTo(x + 9, top + 7);
        ctx.lineTo(x, top + 9 + 30 * next); ctx.closePath(); ctx.fill();
      }
      ctx.restore();

    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false; texture.minFilter = texture.magFilter = THREE.LinearFilter;
  // A texel inset protects adjacent atlas cells during minification.
  texture.repeat.set((CELL-2)/canvas.width,(CELL-2)/canvas.height);
  const direction = new THREE.Vector3(0, -hr*.43, muzzle.z-headC.z+hr*.24).normalize();
  const mouth = decal(project(direction,hr*.48,hr*.46,hr,18), texture, 'leafOpenMouth', 5);
  face.add(mouth);
  const closed = ['closedMouthLeft','closedMouthRight'].map(name=>cat.getObjectByName(name)).filter(Boolean);
  let amount=0, cell=-1, source=`pose:${pose}`;
  function update() {
    const state = cat.userData.animationState;
    const sampled = !state || state.active === false
      ? sampleExpression(null,0,1,pose)
      : Number.isFinite(state.mouthOpen)
        ? state : sampleExpression(state.actionId,state.progress??0,state.amount??1,pose);
    amount=Math.max(0,Math.min(1,sampled.mouthOpen)); source=sampled.expressionSource??'blended-clips';
    const frame=Math.round(amount*(FRAME_COUNT-1));
    mouth.visible=frame>0; for(const arc of closed) arc.visible=!mouth.visible;
    if(frame!==cell) {
      texture.offset.set(((frame%COLS)*CELL+1)/canvas.width,
        (canvas.height-(Math.floor(frame/COLS)+1)*CELL+1)/canvas.height);
      cell=frame;
    }
    return amount;
  }
  cat.userData.updateMouthAnimation=update;
  cat.userData.getMouthState=()=>({binding:'action-pose',openness:amount,source,atlasFrame:cell});
  update();
}
