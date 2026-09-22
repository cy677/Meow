import { CAT_MOTION_CLIPS as MESH2MOTION_ACTIONS } from './catMotion/clipCatalog.js';

const ACTION_DURATION = new Map(
  MESH2MOTION_ACTIONS.map((action) => [action.id, action.duration])
);

export const MOTION_KEY_BINDINGS = [
  { keys: 'W / ↑', action: '前进' },
  { keys: 'S / ↓', action: '后退' },
  { keys: 'A D / ← →', action: '转向' },
  { keys: 'Shift', action: '奔跑' },
  { keys: 'Ctrl', action: '潜行' },
  { keys: 'Space', action: '跳跃' },
  { keys: 'C / Z / X', action: '警觉 / 坐下 / 休息' },
  { keys: 'Q / E / F / H', action: '叫 / 咬 / 扑接 / 仰头叫' },
  { keys: 'G / K', action: '落下 / 倒地' },
];

export const MOTION_ACTION_HOTKEYS = {
  Space: 'jump',
  KeyQ: 'bark',
  KeyE: 'bite',
  KeyF: 'fetch',
  KeyH: 'howl',
  KeyG: 'fall',
  KeyK: 'death',
};

export const MOTION_POSTURE_HOTKEYS = {
  KeyC: 'idle-alert',
  KeyZ: 'sit',
  KeyX: 'rest-pose',
};

const MOVEMENT_CODES = new Set([
  'KeyW', 'ArrowUp',
  'KeyS', 'ArrowDown',
  'KeyA', 'ArrowLeft',
  'KeyD', 'ArrowRight',
  'ShiftLeft', 'ShiftRight',
  'ControlLeft', 'ControlRight',
]);

const hasAny = (keys, codes) => codes.some((code) => keys.has(code));

export function isMotionControlCode(code) {
  return MOVEMENT_CODES.has(code)
    || code in MOTION_ACTION_HOTKEYS
    || code in MOTION_POSTURE_HOTKEYS;
}

export function createCatMotionStateMachine() {
  const keys = new Set();
  const position = { x: 0, z: 0 };
  let heading = 0;
  let baseState = 'idle';
  let transientAction = null;
  let transientRemaining = 0;
  let action = 'idle';
  let travelDirection = 1;

  const clearKeys = () => keys.clear();

  const reset = ({ keepHeading = false } = {}) => {
    clearKeys();
    position.x = 0;
    position.z = 0;
    if (!keepHeading) heading = 0;
    baseState = 'idle';
    transientAction = null;
    transientRemaining = 0;
    action = 'idle';
    travelDirection = 1;
  };

  const setKey = (code, down) => {
    if (down) keys.add(code);
    else keys.delete(code);
  };

  const trigger = (nextAction) => {
    if (!ACTION_DURATION.has(nextAction)) return false;
    transientAction = nextAction;
    const hold = nextAction === 'death' ? 0.8 : nextAction === 'fall' ? 0.18 : 0.1;
    transientRemaining = ACTION_DURATION.get(nextAction) + hold;
    return true;
  };

  const triggerCode = (code) => {
    if (code in MOTION_ACTION_HOTKEYS) return trigger(MOTION_ACTION_HOTKEYS[code]);
    if (code in MOTION_POSTURE_HOTKEYS) {
      const posture = MOTION_POSTURE_HOTKEYS[code];
      baseState = baseState === posture ? 'idle' : posture;
      transientAction = null;
      transientRemaining = 0;
      return true;
    }
    return false;
  };

  const update = (dt, { speedScale = 1 } = {}) => {
    const safeDt = Math.max(0, Math.min(Number(dt) || 0, 0.1));
    const forward = hasAny(keys, ['KeyW', 'ArrowUp']);
    const backward = hasAny(keys, ['KeyS', 'ArrowDown']);
    const left = hasAny(keys, ['KeyA', 'ArrowLeft']);
    const right = hasAny(keys, ['KeyD', 'ArrowRight']);
    const running = hasAny(keys, ['ShiftLeft', 'ShiftRight']);
    const sneaking = hasAny(keys, ['ControlLeft', 'ControlRight']);
    const moveInput = (forward ? 1 : 0) - (backward ? 1 : 0);
    const turnInput = (left ? 1 : 0) - (right ? 1 : 0);
    const moving = moveInput !== 0;
    const turning = turnInput !== 0;

    heading += turnInput * 1.65 * safeDt;
    if (heading > Math.PI) heading -= Math.PI * 2;
    if (heading < -Math.PI) heading += Math.PI * 2;

    if (transientRemaining > 0) {
      transientRemaining = Math.max(0, transientRemaining - safeDt);
      if (transientRemaining === 0) transientAction = null;
    }

    let locomotionAction = null;
    if (moving || turning) {
      baseState = 'idle';
      locomotionAction = sneaking ? 'sneak' : running ? 'run' : 'walk';
    }
    action = transientAction ?? locomotionAction ?? baseState;
    travelDirection = moveInput < 0 ? -1 : 1;

    const canTranslate = moving && (
      locomotionAction !== null
      || transientAction === 'jump'
      || transientAction === 'fall'
    );
    if (canTranslate) {
      const baseSpeed = sneaking ? 0.28 : running ? 1.05 : 0.56;
      const reverseScale = moveInput < 0 ? 0.68 : 1;
      const distance = baseSpeed * reverseScale * Math.max(0.1, speedScale) * safeDt * Math.sign(moveInput);
      position.x += Math.sin(heading) * distance;
      position.z += Math.cos(heading) * distance;
      const radius = Math.hypot(position.x, position.z);
      if (radius > 6) {
        position.x *= 6 / radius;
        position.z *= 6 / radius;
      }
    }

    return {
      action,
      position: { ...position },
      heading,
      travelDirection,
      moving,
      turning,
      running,
      sneaking,
      transientAction,
      baseState,
      keys: [...keys],
    };
  };

  return {
    update,
    reset,
    setKey,
    clearKeys,
    trigger,
    triggerCode,
    getState: () => ({
      action,
      position: { ...position },
      heading,
      travelDirection,
      transientAction,
      baseState,
      keys: [...keys],
    }),
  };
}
