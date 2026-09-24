/** Facial motion is sampled from the body's normalized clip phase, never wall time.
 * Authored curves, not an animal-physiology claim. See docs/motion-refinement.md.
 */
// Zero velocity and acceleration at both ends of every pose crossfade.
export const smooth01 = value => { const t = Math.max(0, Math.min(1, value)); return t*t*t*(t*(t*6-15)+10); };
const STATIC_MOUTH = Object.freeze({ stretch: .25 });
const curve = (p, start, peak, release, end) =>
  smooth01((p-start)/(peak-start)) * (1-smooth01((p-release)/(end-release)));
export function sampleExpression(action, progress = 0, amount = 1, pose = 'standing') {
  if (![progress, amount].every(Number.isFinite)) throw new TypeError('表情采样需要有限的动作相位和幅度');
  const p = Math.max(0, Math.min(1, progress));
  let open = 0;
  // Static postures do not acquire a separate expression clock.
  if (!action) return { mouthOpen: STATIC_MOUTH[pose] ?? 0, expressionSource: `pose:${pose}` };
  switch (action) {
    case 'bark':
      open = Math.max(curve(p,.06,.14,.24,.34), curve(p,.44,.53,.64,.78)*.88); break;
    case 'howl':
      open = curve(p,.08,.24,.73,.96) * (.91+.06*Math.sin(p*Math.PI*12)); break;
    case 'bite':
      // Close by the existing bite_contact marker at phase .5.
      open = curve(p,.05,.23,.30,.50); break;
    case 'fetch':
      open = .42*curve(p,.20,.37,.46,.57); break;
    case 'stretch':
      open = .65*curve(p,.17,.43,.57,.90); break;
    default: break; // walk/run/sneak/sit/rest/jump/gestures keep their mouth closed
  }
  return { mouthOpen: Math.max(0,Math.min(1,open*Math.max(0,Math.min(1,amount)))),
    expressionSource: `clip:${action}` };
}
