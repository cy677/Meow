/** UV transform from a full WebGL viewport into the visible photo window. */
export function videoUvTransform(videoWidth, videoHeight, canvasRect, frameRect, mirror = false) {
  const {width: cw, height: ch} = canvasRect;
  const {width: fw, height: fh} = frameRect;
  if (![videoWidth, videoHeight, cw, ch, fw, fh].every(v => Number.isFinite(v) && v > 0)) return null;
  const sourceAspect = videoWidth / videoHeight, targetAspect = fw / fh;
  const cropX = Math.min(1, targetAspect / sourceAspect), cropY = Math.min(1, sourceAspect / targetAspect);
  const centerX = (frameRect.left - canvasRect.left + fw / 2) / cw;
  const centerY = 1 - (frameRect.top - canvasRect.top + fh / 2) / ch;
  const sx = cropX * cw / fw * (mirror ? -1 : 1), sy = cropY * ch / fh;
  return {sx, sy, tx: .5 - sx * centerX, ty: .5 - sy * centerY};
}
