import type { Diagnostic, Point2, Room } from './types';

const epsilon = 1e-8;
export type RoomGeometry = Pick<Room, 'outline' | 'exclusions'>;

function subtract(a: Point2, b: Point2): Point2 {
  return { x: a.x - b.x, z: a.z - b.z };
}
const cross = (a: Point2, b: Point2): number => a.x * b.z - a.z * b.x;
const dot = (a: Point2, b: Point2): number => a.x * b.x + a.z * b.z;

function edges(poly: readonly Point2[]): Array<readonly [Point2, Point2]> {
  return poly.flatMap((point, i) => {
    const next = poly[(i + 1) % poly.length];
    return next ? [[point, next] as const] : [];
  });
}

export function measureOutline(poly: readonly Point2[]): number {
  const anchor = poly[0];
  if (!anchor) return 0;
  return Math.abs(edges(poly).reduce((sum, [a, b]) => sum + cross(subtract(a, anchor), subtract(b, anchor)), 0)) / 2;
}

function pointOnSegment(p: Point2, a: Point2, b: Point2): boolean {
  const direction = subtract(b, a);
  const offset = subtract(p, a);
  const length = Math.hypot(direction.x, direction.z);
  if (length <= epsilon) return Math.hypot(offset.x, offset.z) <= epsilon;
  const along = dot(direction, offset) / length;
  return along >= -epsilon && along <= length + epsilon && Math.abs(cross(direction, offset)) <= epsilon * length;
}

export function pointInOutline(p: Point2, poly: readonly Point2[]): boolean {
  let inside = false;
  for (const [a, b] of edges(poly)) {
    if (pointOnSegment(p, a, b)) return true;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < a.x + (b.x - a.x) * (p.z - a.z) / (b.z - a.z)) inside = !inside;
  }
  return inside;
}

/** Where segment a–b meets c–d as fractions of a–b. Overlap yields its two boundaries. */
export function intersectionFractions(a: Point2, b: Point2, c: Point2, d: Point2): number[] {
  const ab = subtract(b, a);
  const cd = subtract(d, c);
  const r = subtract(c, a);
  const divisor = cross(ab, cd);
  const aa = dot(ab, ab);
  const cc = dot(cd, cd);
  if (aa <= epsilon ** 2) return pointOnSegment(a, c, d) ? [0] : [];
  if (cc <= epsilon ** 2) return pointOnSegment(c, a, b) ? [Math.max(0, Math.min(1, dot(r, ab) / aa))] : [];
  if (Math.abs(divisor) <= epsilon * Math.sqrt(aa * cc)) {
    if (Math.abs(cross(ab, r)) > epsilon * Math.sqrt(aa)) return [];
    const t = dot(r, ab) / aa;
    const u = dot(subtract(d, a), ab) / aa;
    const from = Math.max(0, Math.min(t, u));
    const to = Math.min(1, Math.max(t, u));
    return from <= to ? [from, to] : [];
  }
  const t = cross(r, cd) / divisor;
  const u = cross(r, ab) / divisor;
  return t >= -epsilon && t <= 1 + epsilon && u >= -epsilon && u <= 1 + epsilon
    ? [Math.max(0, Math.min(1, t))] : [];
}

export function validateOutline(poly: readonly Point2[]): Diagnostic[] {
  const error = (code: string, message: string, index?: number): Diagnostic =>
    ({ code, message, path: index === undefined ? 'outline' : `outline.${index}`, severity: 'error' });
  if (poly.length < 4 || poly.length > 256 || poly.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.z))) {
    return [error('invalid_outline', 'Нужен контур из 4–256 конечных координат.')];
  }
  const walls = edges(poly);
  for (const [i, [a, b]] of walls.entries()) {
    const { x, z } = subtract(b, a);
    if (Math.hypot(x, z) <= epsilon) return [error('zero_length_wall', 'Длина стены слишком мала.', i)];
    if (Math.abs(x) > epsilon && Math.abs(z) > epsilon) return [error('nonorthogonal_wall', 'Стена должна идти вдоль оси плана.', i)];
    for (let j = i + 1; j < walls.length; j += 1) {
      const wall = walls[j];
      if (!wall) continue;
      const [c, d] = wall;
      if (j === i + 1 || (i === 0 && j === walls.length - 1)) {
        const overlap = intersectionFractions(a, b, c, d);
        if (overlap.length !== 2 || Math.abs((overlap[1] ?? 0) - (overlap[0] ?? 0)) <= epsilon) continue;
      } else if (!intersectionFractions(a, b, c, d).length) continue;
      return [error('self_intersection', 'Стены контура пересекаются или накладываются.', j)];
    }
  }
  if (measureOutline(poly) <= epsilon) return [error('zero_area', 'У контура нет площади.')];
  return [];
}

function keepoutCorners(zone: Room['exclusions'][number]): Point2[] {
  const { x, z } = zone.origin;
  return [{ x, z }, { x: x + zone.widthM, z }, { x: x + zone.widthM, z: z + zone.depthM }, { x, z: z + zone.depthM }];
}

/** Neither endpoint-only nor midpoint-only checks catch departures from a concave room. */
export function segmentInsideRoom(a: Point2, b: Point2, room: RoomGeometry): boolean {
  const obstacles = room.exclusions.map(keepoutCorners);
  const at = (t: number): Point2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  const valid = (p: Point2): boolean => pointInOutline(p, room.outline) && !obstacles.some((o) => pointInOutline(p, o));
  if (!valid(a) || !valid(b)) return false;

  const cuts = [0, 1];
  for (const [c, d] of edges(room.outline)) cuts.push(...intersectionFractions(a, b, c, d));
  if (obstacles.some((o) => edges(o).some(([c, d]) => intersectionFractions(a, b, c, d).length > 0))) return false;
  cuts.sort((x, y) => x - y);
  return cuts.every((t, i) => i === 0 || valid(at(((cuts[i - 1] ?? t) + t) / 2)));
}
