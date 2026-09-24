/** Ordinary coat rewards do not erase the reference model's own palette. */
export const LEAF_CAT_ID = 'leaf-cat';
export const LEAF_CAT_PALETTE = Object.freeze({
  body: '#d5eac0', ear: '#579e38', marking: '#6daa4c', leaf: '#589b36',
  leafLight: '#71ae48', innerEar: '#d0e9b5', ruff: '#e1efc9',
  sclera: '#fffdf4', iris: '#cb6699', pupil: '#241a2b',
  nose: '#b45783', mouth: '#664078', tongue: '#b68bc9', pad: '#e39caf',
});
const bounded = (v, fallback, min, max) => Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
export function leafCatOptions(params = {}, quality = 'full') {
  return {
    // Bounds apply to this character only, never mutate the saved/user parameters.
    head: bounded(params.headSize, 1.08, .78, 1.48) / 1.08,
    width: Math.sqrt(bounded(params.chubbiness, 1.15, .65, 2.1) / 1.15),
    leg: bounded(params.legLength, .85, .5, 1.4) / .85,
    ear: bounded(params.earSize, 1, .65, 1.4),
    eye: bounded(params.eyeSize, 1.05, .75, 1.3) / 1.05,
    tail: bounded(params.tailLength, .95, .65, 1.4) / .95,
    curl: bounded(params.tailCurl, .35, -.2, .9),
    cell: quality === 'draft' ? .032 : .020,
    radialSegments: quality === 'draft' ? 32 : 56,
    palette: { ...LEAF_CAT_PALETTE },
  };
}
