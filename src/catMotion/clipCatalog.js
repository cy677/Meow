/** Single, dependency-free catalog shared by the renderer, scripts, forms and API.
 * Marker phases are authored animation cues, NOT detected physical contacts.
 * The original 14 CC0 sources stay distinct from six Meow-authored pose curves.
 */
const sourceClips = [
  { id: 'idle', name: '待机', sourceName: 'Idle', fps: 24, frames: [0, 40], duration: 40 / 24, loop: true, family: 'idle' },
  { id: 'idle-alert', name: '警觉待机', sourceName: 'Idle Alert', fps: 24, frames: [0, 48], duration: 2, loop: true, family: 'idle' },
  { id: 'walk', name: '行走', sourceName: 'Walk', fps: 30, frames: [0, 30], duration: 1, loop: true, family: 'locomotion' },
  { id: 'run', name: '奔跑', sourceName: 'Run', fps: 24, frames: [0, 14], duration: 14 / 24, loop: true, family: 'locomotion' },
  { id: 'sneak', name: '潜行', sourceName: 'Sneak', fps: 24, frames: [0, 39], duration: 39 / 24, loop: true, family: 'locomotion' },
  { id: 'jump', name: '跳跃', sourceName: 'Jump', fps: 30, frames: [1, 66], duration: 65 / 30, loop: false, family: 'airborne' },
  { id: 'fall', name: '落下', sourceName: 'Fall', fps: 30, frames: [0, 15], duration: 0.5, loop: false, family: 'airborne' },
  { id: 'sit', name: '坐下', sourceName: 'Sit', fps: 24, frames: [0, 40], duration: 40 / 24, loop: false, family: 'transition' },
  { id: 'rest-pose', name: '休息姿势', sourceName: 'Rest Pose', fps: 30, frames: [1, 10], duration: 0.3, loop: true, family: 'idle' },
  { id: 'bark', name: '叫唤', sourceName: 'Bark', fps: 30, frames: [0, 84], duration: 2.8, loop: true, family: 'expression' },
  { id: 'bite', name: '咬咬', sourceName: 'Bite', fps: 30, frames: [1, 26], duration: 25 / 30, loop: true, family: 'expression' },
  { id: 'fetch', name: '扑接', sourceName: 'Fetch', fps: 24, frames: [1, 30], duration: 29 / 24, loop: true, family: 'expression' },
  { id: 'howl', name: '仰头叫', sourceName: 'Howl', fps: 24, frames: [1, 70], duration: 69 / 24, loop: true, family: 'expression' },
  { id: 'death', name: '倒地', sourceName: 'Death', fps: 24, frames: [1, 35], duration: 34 / 24, loop: false, family: 'collapse' },
];
const authoredClips = [
  {id:'scratch', name:'交替抓挠', duration:1.8, loop:true, family:'gesture'},
  {id:'paw', name:'前爪轻拍', duration:1.4, loop:false, family:'gesture'},
  {id:'climb-up', name:'向上攀爬（原地练习）', duration:1.8, loop:true, family:'climb'},
  {id:'climb-down', name:'向下攀爬（原地练习）', duration:2.1, loop:true, family:'climb'},
  {id:'mantle', name:'扒边翻上（原地练习）', duration:2.6, loop:false, family:'transition'},
  {id:'stretch', name:'舒展身体', duration:2.8, loop:false, family:'gesture'},
  {id:'wave', name:'招爪问好', duration:2.8, loop:false, family:'gesture'},
  {id:'bow', name:'礼貌鞠躬', duration:3.2, loop:false, family:'gesture'},
  {id:'head-tilt', name:'歪头卖萌', duration:3.4, loop:false, family:'gesture'},
];
// Keep the free set explicit: adding a new reward clip must not grant it for free.
export const BASIC_ACTIONS = Object.freeze([
  ...sourceClips.map(c=>c.id), 'scratch','paw','climb-up','climb-down','mantle','stretch','spin',
]);
const cues = {
  jump:[{phase:.18,event:'takeoff'},{phase:.55,event:'apex'},{phase:.88,event:'landing'}],
  fall:[{phase:.85,event:'landing'}],
  bite:[{phase:.5,event:'bite_contact',bone:'head'}],
  fetch:[{phase:.55,event:'paw_contact',bone:'frontLFoot'}],
  scratch:[{phase:.26,event:'scratch_contact',bone:'frontLFoot'},{phase:.76,event:'scratch_contact',bone:'frontRFoot'}],
  paw:[{phase:.54,event:'paw_contact',bone:'frontLFoot'}],
  'climb-up':[{phase:.25,event:'climb_grab',bone:'frontLFoot'},{phase:.75,event:'climb_grab',bone:'frontRFoot'}],
  'climb-down':[{phase:.2,event:'climb_grab',bone:'frontRFoot'},{phase:.7,event:'climb_grab',bone:'frontLFoot'}],
  mantle:[{phase:.25,event:'climb_grab',bone:'frontLFoot'},{phase:.25,event:'climb_grab',bone:'frontRFoot'},{phase:.85,event:'mantle_complete'}],
};
const requiresTarget = new Set(['scratch','climb-up','climb-down','mantle']);
function freezeClip(clip, source) {
  return Object.freeze({...clip, source, rootMode:'in-place',
    interruptible:!['jump','fall','mantle'].includes(clip.id),
    requiresTarget:requiresTarget.has(clip.id),
    ...(clip.frames ? {frames:Object.freeze([...clip.frames])} : {}),
    markers:Object.freeze((cues[clip.id] || []).map(cue=>Object.freeze({...cue}))),
  });
}
export const SOURCE_CLIPS = Object.freeze(sourceClips.map(c=>freezeClip(c,'mesh2motion')));
export const AUTHORED_CLIPS = Object.freeze(authoredClips.map(c=>freezeClip(c,'meow-authored')));
export const CAT_MOTION_CLIPS = Object.freeze([...SOURCE_CLIPS,...AUTHORED_CLIPS]);
export const CLIPS = CAT_MOTION_CLIPS;
// Read-only lookup facade: callers cannot accidentally change global catalog state.
const byId = new Map(CLIPS.map(c=>[c.id,c]));
export const CLIP_BY_ID = Object.freeze({get:id=>byId.get(id),has:id=>byId.has(id)});
export function requireClip(id) {
  const clip=byId.get(id);
  if(!clip)throw new RangeError(`未知骨骼动画片段: ${id}`);
  return clip;
}
