import * as CANNON from 'cannon-es';

// Resolve the cat's spheres against solid furniture, preserving tangential travel.
// Ground planes and surfaces below the sphere are supports, not horizontal walls.
export function resolveCatObstacles(spheres, bodies, excluded) {
  const shift = { x: 0, z: 0, body: null };
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const body of bodies) {
      if (body === excluded || body.type !== CANNON.Body.STATIC || !body.collisionResponse || !body.collisionFilterMask) continue;
      for (let i = 0; i < body.shapes.length; i++) {
        const shape = body.shapes[i];
        if (shape.type !== CANNON.Shape.types.BOX && shape.type !== CANNON.Shape.types.SPHERE) continue;
        const center = body.quaternion.vmult(body.shapeOffsets[i]); center.vadd(body.position, center);
        const rotation = body.quaternion.mult(body.shapeOrientations[i]);
        for (const sphere of spheres) {
          const point = new CANNON.Vec3(sphere.x + shift.x, sphere.y, sphere.z + shift.z);
          const local = rotation.conjugate().vmult(point.vsub(center));
          let normal, depth;
          if (shape.type === CANNON.Shape.types.SPHERE) {
            const distance = local.length(); depth = sphere.r + shape.radius - distance;
            normal = distance > 1e-6 ? local.scale(1 / distance) : new CANNON.Vec3(1, 0, 0);
          } else {
            const h = shape.halfExtents;
            const closest = new CANNON.Vec3(...['x','y','z'].map(axis => Math.max(-h[axis], Math.min(h[axis], local[axis]))));
            normal = local.vsub(closest); const distance = normal.length();
            depth = sphere.r - distance;
            if (distance > 1e-6) normal.scale(1 / distance, normal);
            else {
              const axis = ['x','z'].sort((a,b) => h[a]-Math.abs(local[a])-(h[b]-Math.abs(local[b])))[0];
              normal.set(0,0,0); normal[axis] = Math.sign(local[axis]) || 1;
              depth = sphere.r + h[axis] - Math.abs(local[axis]);
            }
          }
          normal = rotation.vmult(normal);
          const horizontal = Math.hypot(normal.x, normal.z);
          if (depth <= .0001 || horizontal < .5) continue;
          shift.x += normal.x / horizontal * (depth + .001);
          shift.z += normal.z / horizontal * (depth + .001);
          shift.body = body; changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return shift;
}
