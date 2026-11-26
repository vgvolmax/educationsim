import { projectLimits } from './limits';
import { measureOutline, pointInOutline, segmentInsideRoom } from './geometry';
import type { RoomGeometry } from './geometry';
import type { Point2, Point3 } from './types';

export type FloorDirection = '+x' | '-x' | '+z' | '-z';
type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
type Failure = { code: 'blocked_layout' | 'invalid_access' | 'route_budget' | 'unsupported_spiral'; location: Point3 };
type Layout = { vertices: Point3[]; partial: boolean } | Failure;
const eps = 1e-7;
const pt = (x: number, z: number): Point2 => ({ x, z });
const bounds = (points: readonly Point2[]): Bounds => ({
  minX: Math.min(...points.map((p) => p.x)), maxX: Math.max(...points.map((p) => p.x)),
  minZ: Math.min(...points.map((p) => p.z)), maxZ: Math.max(...points.map((p) => p.z)),
});

const axes: Record<FloorDirection, Point2> = { '+x': pt(1, 0), '-x': pt(-1, 0), '+z': pt(0, 1), '-z': pt(0, -1) };
function frame(room: RoomGeometry, start: Point3, end: Point3, direction: FloorDirection) {
  const axis = axes[direction];
  const cross = pt(-axis.z, axis.x);
  const sign = (end.x - start.x) * cross.x + (end.z - start.z) * cross.z >= 0 ? 1 : -1;
  const local = (p: Point2) => pt((p.x - start.x) * axis.x + (p.z - start.z) * axis.z,
    sign * ((p.x - start.x) * cross.x + (p.z - start.z) * cross.z));
  const world = (p: Point2): Point3 => ({
    x: start.x + p.x * axis.x + sign * p.z * cross.x, y: start.y,
    z: start.z + p.x * axis.z + sign * p.z * cross.z,
  });
  const geometry: RoomGeometry = {
    outline: room.outline.map(local),
    exclusions: room.exclusions.map(({ origin, widthM, depthM }) => {
      const b = bounds([local(origin), local(pt(origin.x + widthM, origin.z + depthM))]);
      return { origin: pt(b.minX, b.minZ), widthM: b.maxX - b.minX, depthM: b.maxZ - b.minZ };
    }),
  };
  return { geometry, world, endpoint: local(end) };
}

function serpentine(geometry: RoomGeometry, s: number, endZ: number, width: number, rows: number): { points: Point2[]; partial: boolean } | Point2 {
  const left = 2 * s;
  function far(z: number): number {
    if (!pointInOutline(pt(left, z), geometry.outline)) return left;
    let exit = width;
    geometry.outline.forEach((a, i) => {
      const b = geometry.outline[(i + 1) % geometry.outline.length]!;
      if (Math.abs(a.x - b.x) < eps && a.x > left && (a.z > z) !== (b.z > z)) exit = Math.min(exit, a.x);
    });
    for (const zone of geometry.exclusions) {
      if (z > zone.origin.z - s / 2 && z < zone.origin.z + zone.depthM + s / 2 &&
          zone.origin.x + zone.widthM > left) exit = Math.min(exit, zone.origin.x);
    }
    return exit - s;
  }
  const path: Point2[] = [pt(0, 0)];
  let partial = false;
  for (let i = 0; i < rows; i += 2) {
    const z = i * s, next = z + s;
    const samples = [z, next, (z + next) / 2];
    for (const p of geometry.outline) if (p.z > z && p.z < next) samples.push(p.z - eps * 2, p.z + eps * 2);
    const available = samples.map(far);
    const x = Math.min(...available);
    if (x < left + 2 * s || !segmentInsideRoom(pt(x, z), pt(x, next), geometry)) return pt(x, z);
    if (geometry.exclusions.length > 0 && x < width - s - eps) partial = true;
    if (i > 0) path.push(pt(left, z));
    path.push(pt(x, z), pt(x, next));
    if (i + 2 < rows) path.push(pt(left, next));
  }
  const last = (rows - 1) * s;
  const header = s;
  path.push(pt(header, last), pt(header, endZ), pt(0, endZ));
  return { points: path, partial };
}

function spiral(width: number, top: number, s: number): Point2[] {
  const supply: Point2[] = [pt(0, 0)];
  let left = s, right = width - s, bottom = 0, high = top;
  // Two pitches between incoming turns leave a full independent pitch for the return.
  while (right - left >= 6 * s && high - bottom >= 6 * s) {
    supply.push(pt(right, bottom), pt(right, high), pt(left, high), pt(left, bottom + 2 * s));
    left += 2 * s; right -= 2 * s; bottom += 2 * s; high -= 2 * s;
  }
  const before = supply.at(-1)!;
  supply.push(pt(Math.max(before.x + s, right - 2 * s), bottom));
  const normal = (a: Point2, b: Point2): Point2 => pt(-Math.sign(b.z - a.z), Math.sign(b.x - a.x));
  const offset = supply.map((p, i) => {
    const a = i > 0 ? normal(supply[i - 1]!, p) : pt(0, 0);
    const b = i < supply.length - 1 ? normal(p, supply[i + 1]!) : pt(0, 0);
    return pt(p.x + s * (a.x + b.x), p.z + s * (a.z + b.z));
  });
  const head = supply.at(-1)!;
  supply.pop();
  offset.pop();
  return [...supply, pt(head.x + s, bottom), pt(head.x + s, bottom + s), ...offset.reverse()];
}

export function layoutFloor(room: RoomGeometry, start: Point3, end: Point3, direction: FloorDirection, kind: 'serpentine' | 'spiral', spacing: number): Layout {
  const { geometry, world, endpoint } = frame(room, start, end, direction);
  const b = bounds(geometry.outline);
  if (Math.abs(endpoint.x) > eps || Math.abs(endpoint.z - spacing) > eps || Math.abs(start.y - end.y) > eps ||
      Math.abs(b.minX) > eps || b.minZ > -spacing / 3 || !pointInOutline(start, room.outline) || !pointInOutline(end, room.outline)) {
    return { code: 'invalid_access', location: start };
  }
  const height = b.maxZ - spacing;
  const widths = (b.maxX - b.minX) / spacing;
  const rings = Math.floor(Math.min(widths, height / spacing) / 4);
  // Cap conservative operation count before generating any candidate.
  if (widths > 512 || height / spacing > 512 || (kind === 'spiral' && rings * 64 > projectLimits.routePoints) ||
      (kind === 'serpentine' && (height / spacing) * 16 > projectLimits.routePoints + 32)) return { code: 'route_budget', location: start };
  if (widths < 6 || height / spacing < 5) return { code: 'blocked_layout', location: start };

  let points: Point2[], partial = false;
  if (kind === 'spiral') {
    const boxArea = (b.maxX - b.minX) * (b.maxZ - b.minZ);
    if (geometry.exclusions.length || Math.abs(measureOutline(geometry.outline) - boxArea) > 1e-6) {
      return { code: 'unsupported_spiral', location: start };
    }
    points = spiral(b.maxX, height, spacing);
  } else {
    const count = Math.floor((height + eps) / spacing) + 1;
    const rows = count - count % 2;
    const result = serpentine(geometry, spacing, endpoint.z, b.maxX, rows);
    if ('x' in result) return { code: 'blocked_layout', location: world(result) };
    points = result.points;
    partial = result.partial;
  }
  const vertices = points.map(world);
  vertices[0] = start;
  vertices[vertices.length - 1] = end;
  return { vertices, partial };
}
