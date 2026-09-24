import * as THREE from 'three';
import { evalField } from '../../sdf.js';

/** Reusable closed, rounded leaf/ear volume; shared rim, no image planes. */
export function pillowGeometry(shape, { depth = .06, segments = 56, rings = 10, bend = 0 } = {}) {
  const contour = shape.getSpacedPoints(segments).slice(0, -1), n = contour.length;
  const center = contour.reduce((a, p) => a.add(p), new THREE.Vector2()).multiplyScalar(1 / n);
  const positions = [], uv = [], indices = [];
  const add = (x, y, z) => { positions.push(x, y, z + bend * y * y); uv.push(x, y); return positions.length / 3 - 1; };
  const frontCenter = add(center.x, center.y, depth), front = [], back = [];
  for (let j = 1; j <= rings; j++) {
    const a = j / rings * Math.PI / 2, r = Math.sin(a), row = [];
    for (const p of contour) row.push(add(THREE.MathUtils.lerp(center.x, p.x, r), THREE.MathUtils.lerp(center.y, p.y, r), depth * Math.cos(a)));
    front.push(row);
  }
  for (let j = 1; j < rings; j++) {
    const a = j / rings * Math.PI / 2, r = Math.sin(a), row = [];
    for (const p of contour) row.push(add(THREE.MathUtils.lerp(center.x, p.x, r), THREE.MathUtils.lerp(center.y, p.y, r), -depth * Math.cos(a)));
    back.push(row);
  }
  back.push(front[rings - 1]);
  const backCenter = add(center.x, center.y, -depth), ccw = !THREE.ShapeUtils.isClockWise(contour);
  const tri = (a, b, c, reverse = false) => indices.push(...((ccw !== reverse) ? [a, b, c] : [a, c, b]));
  for (const [rows, middle, reverse] of [[front, frontCenter, false], [back, backCenter, true]]) {
    for (let i = 0; i < n; i++) tri(middle, rows[0][i], rows[0][(i + 1) % n], reverse);
    for (let j = 1; j < rings; j++) for (let i = 0; i < n; i++) {
      const k = (i + 1) % n;
      tri(rows[j - 1][i], rows[j][i], rows[j][k], reverse);
      tri(rows[j - 1][i], rows[j][k], rows[j - 1][k], reverse);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices); g.computeVertexNormals(); g.computeBoundingBox(); return g;
}
export function leafShape(width = .24, length = .35, curl = 0) {
  const s = new THREE.Shape(); s.moveTo(0, 0);
  s.bezierCurveTo(-width * .62, length * .20, -width * .54, length * .63, curl, length);
  s.bezierCurveTo(width * .50 + curl, length * .72, width * .58, length * .19, 0, 0); return s;
}
export function earShape(width = .53, height = .71, side = 1) {
  const s = new THREE.Shape(), p = (x, y) => [x * width * side, y * height];
  s.moveTo(...p(-.46, .04));
  s.bezierCurveTo(...p(-.58, .42), ...p(-.19, 1.00), ...p(.10, 1.02));
  s.bezierCurveTo(...p(.29, 1.02), ...p(.62, .36), ...p(.44, .03));
  s.bezierCurveTo(...p(.18, -.07), ...p(-.18, -.07), ...p(-.46, .04)); return s;
}
/** Projection follows the real SDF including cheeks and muzzle, not a flat billboard. */
export function frontProjector(primitives, startZ) {
  return (x, y) => {
    let z = startZ;
    for (let i = 0; i < 70; i++) {
      const d = evalField(primitives, x, y, z);
      if (d < .00002) return z;
      z -= Math.max(d * .88, .00002); if (z < -2) break;
    }
    throw new RangeError(`Leaf-cat surface patch missed the head at ${x}, ${y}`);
  };
}
export function surfaceGeometry(shape, project, { offset = .005, segments = 64, rings = 12, origin = new THREE.Vector3() } = {}) {
  const contour = shape.getSpacedPoints(segments).slice(0, -1), n = contour.length;
  const center = contour.reduce((a, p) => a.add(p), new THREE.Vector2()).multiplyScalar(1 / n);
  const positions = [], indices = [], ccw = !THREE.ShapeUtils.isClockWise(contour);
  const add = p => positions.push(p.x - origin.x, p.y - origin.y, project(p.x, p.y) + offset - origin.z);
  add(center);
  for (let j = 1; j <= rings; j++) for (const p of contour) add(center.clone().lerp(p, j / rings));
  const tri = (a, b, c) => indices.push(...(ccw ? [a, b, c] : [a, c, b]));
  for (let i = 0; i < n; i++) tri(0, 1 + i, 1 + (i + 1) % n);
  for (let j = 1; j < rings; j++) for (let i = 0; i < n; i++) {
    const k = (i + 1) % n, a = 1 + (j - 1) * n, b = 1 + j * n;
    tri(a + i, b + i, b + k); tri(a + i, b + k, a + k);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices); g.computeVertexNormals(); return g;
}
export function ellipseShape(x, y, rx, ry) {
  const s = new THREE.Shape(); s.absellipse(x, y, rx, ry, 0, Math.PI * 2, false, 0); return s;
}
/** Smooth, closed, elliptic swept leaf-tail with a continuously tapered tip. */
export function tailGeometry(curve, { width = .27, depth = .20, lengthSegments = 42, radialSegments = 28 } = {}) {
  const positions = [], indices = [], us = [], axis = new THREE.Vector3(1, 0, 0);
  for (let j = 0; j <= lengthSegments; j++) {
    const u = j / lengthSegments, c = curve.getPoint(u), tangent = curve.getTangent(u).normalize();
    const xAxis = axis.clone().addScaledVector(tangent, -axis.dot(tangent)).normalize();
    const zAxis = new THREE.Vector3().crossVectors(xAxis, tangent).normalize();
    const profile = Math.pow(Math.sin(Math.PI * u), .84), base = .050 * (1 - u);
    const rx = Math.max(.002, base + width * profile), rz = Math.max(.002, base + depth * profile);
    for (let i = 0; i < radialSegments; i++) {
      const a = i / radialSegments * Math.PI * 2;
      const p = c.clone().addScaledVector(xAxis, rx * Math.cos(a)).addScaledVector(zAxis, rz * Math.sin(a));
      positions.push(...p.toArray()); us.push(u);
    }
  }
  for (let j = 0; j < lengthSegments; j++) for (let i = 0; i < radialSegments; i++) {
    const k = (i + 1) % radialSegments, a = j * radialSegments, b = a + radialSegments;
    indices.push(a + i, b + i, b + k, a + i, b + k, a + k);
  }
  for (const [row, u, reverse] of [[0, 0, false], [lengthSegments, 1, true]]) {
    const center = positions.length / 3; positions.push(...curve.getPoint(u).toArray()); us.push(u);
    for (let i = 0; i < radialSegments; i++) {
      const a = row * radialSegments + i, b = row * radialSegments + (i + 1) % radialSegments;
      indices.push(...(reverse ? [center, b, a] : [center, a, b]));
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices); g.computeVertexNormals(); g.userData.tailCoordinates = us; return g;
}
