import type { Point2 } from '../../project/types';

export type SketchEndpoint = { id: string; position: Point2 };

export function sketchPairKey(a: SketchEndpoint, b: SketchEndpoint): string {
  return a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id;
}

/** Drawing-only positions. Never saved, measured or sent to the simulator. */
export function untracedPath(a: SketchEndpoint, b: SketchEndpoint, index: number, count: number): Point2[] {
  const from = a.position, to = b.position;
  const dx = to.x - from.x, dz = to.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance < .01) {
    const radius = .36 + Math.min(index, 11) * .12;
    return [from, { x: from.x + radius, z: from.z }, { x: from.x + radius, z: from.z - radius },
      { x: to.x, z: to.z - radius }, to];
  }
  if (count < 2) return [from, { x: to.x, z: from.z }, to];
  // Keep offsets on distinct sides regardless of the connection's creation direction.
  const sign = a.id < b.id ? 1 : -1;
  const gap = Math.min(.26, 1.8 / (count - 1));
  const lane = (index - (count - 1) / 2) * gap * sign;
  const ox = -dz / distance * lane, oz = dx / distance * lane;
  return [from, { x: from.x + dx * .28 + ox, z: from.z + dz * .28 + oz },
    { x: to.x - dx * .28 + ox, z: to.z - dz * .28 + oz }, to];
}
