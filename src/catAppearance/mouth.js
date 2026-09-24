import * as THREE from 'three';
import { MOUTH_MODES, LEAF_PALETTE } from './catalog.js';

const smooth = x => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const pulse = (phase, from, to) => smooth((phase - from) / .10) * (1 - smooth((phase - to) / .15));
/** Independent facial channel; it never samples or modifies a body bone. */
export function sampleMouth(mode, time, action = 'idle', actionPhase = 0) {
  if (!MOUTH_MODES.some(item => item.id === mode)) throw new RangeError('未知口型模式');
  if (!Number.isFinite(time) || !Number.isFinite(actionPhase)) throw new TypeError('口型时间必须为有限数值');
  if (mode === 'closed') return 0;
  if (mode === 'open') return 1;
  const phase = ((time % 2.2) + 2.2) % 2.2 / 2.2;
  if (mode === 'meow') return Math.max(pulse(phase, .1, .28), pulse(phase, .50, .64) * .8);
  // Use the active native clip's phase, not a second body-motion timeline.
  if (action === 'bark') return Math.max(pulse(actionPhase, .10, .28), pulse(actionPhase, .48, .66));
  if (action === 'howl') return pulse(actionPhase, .10, .72) * (.86 + .1 * Math.sin(time * 13));
  return 0;
}

/** The native eye/decal projection is reused for the mouth cavity, tongue and fangs.
 * Closed mouth remains the ORIGINAL two omega arcs. No jaw bone is introduced.
 */
export function installMouth(cat, { face, headC, hr, muzzle, project, decal, mode = 'auto' }) {
  if (!MOUTH_MODES.some(item => item.id === mode)) throw new RangeError('未知口型模式');
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建口型纹理');
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
  const direction = new THREE.Vector3(0, -hr * .43, muzzle.z - headC.z + hr * .24).normalize();
  const geometry = project(direction, hr * .48, hr * .46, hr, 18);
  const mouth = decal(geometry, texture, 'leafOpenMouth', 5);
  face.add(mouth);
  const closed = [cat.getObjectByName('closedMouthLeft'), cat.getObjectByName('closedMouthRight')].filter(Boolean);
  let amount = -1, manual = null, start = null, actionId = '', actionStart = 0;

  function set(value) {
    if (!Number.isFinite(value)) throw new TypeError('开口程度必须为有限数值');
    const next = THREE.MathUtils.clamp(value, 0, 1);
    mouth.visible = next > .025; for (const arc of closed) arc.visible = !mouth.visible;
    if (Math.abs(next - amount) < .006) return amount;
    amount = next; ctx.clearRect(0, 0, 256, 256);
    if (mouth.visible) {
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
    }
    texture.needsUpdate = true; return amount;
  }
  cat.userData.setMouthOpen = value => { manual = value === null ? null : set(value); return manual; };
  cat.userData.setMouthMode = value => {
    if (!MOUTH_MODES.some(item => item.id === value)) throw new RangeError('未知口型模式');
    mode = value; manual = null; start = null; set(value === 'open' ? 1 : 0);
  };
  cat.userData.updateMouthAnimation = time => {
    if (!Number.isFinite(time)) throw new TypeError('口型时间必须为有限数值');
    if (manual !== null) return set(manual);
    if (start === null || time < start) start = time;
    const state = cat.userData.animationState ?? {};
    if (actionId !== state.actionId || time < actionStart) { actionId = state.actionId; actionStart = time; }
    // Native samples expose progress (normalised clip time); fallback is only for hosts without it.
    const phase = Number.isFinite(state.progress) ? state.progress : ((time - actionStart) % 2.2) / 2.2;
    return set(sampleMouth(mode, time - start, actionId, phase));
  };
  cat.userData.getMouthState = () => ({ mode, openness: Math.max(0, amount), manual: manual !== null });
  set(mode === 'open' ? 1 : 0);
}
