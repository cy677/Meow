/** Public animation-only entry points. No account, scene or physics ownership. */
export { CAT_MOTION_CLIPS, SOURCE_CLIPS, AUTHORED_CLIPS, requireClip } from './clipCatalog.js';
export { BONE_PARENT, BONE_NAMES, TARGET_SLOTS } from './skeleton.js';
export { createClipPlayer } from './clipPlayer.js';
export { createMotionController } from './motionController.js';
export { planMotion, validateScript, canAutoPlay } from './motionScript.js';
