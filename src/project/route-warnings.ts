import { projectLimits } from './limits';
import { intersectionFractions, segmentInsideRoom } from './geometry';
import type { RoomGeometry } from './geometry';
import type { Diagnostic, Point2, Point3 } from './types';

export type RouteDiagnostic = Diagnostic & { location?: Point3 };
export type RouteConstraints = {
  room: RoomGeometry;
  risers?: readonly Point2[];
  seams?: readonly (readonly [Point2, Point2])[];
  existingRoutes?: readonly (readonly Point3[])[];
};
export const distance = (a: Point3, b: Point3): number => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
export const near = (a: Point3, b: Point3): boolean => distance(a, b) < 1e-7;
export function directionCosine(a: Point3, b: Point3, c: Point3): number {
  return ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) + (b.z - a.z) * (c.z - b.z)) /
    (distance(a, b) * distance(b, c));
}
const horizontal = (a: Point2, b: Point2): number => Math.hypot(b.x - a.x, b.z - a.z);
const at = (a: Point3, b: Point3, t: number): Point3 =>
  ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

function crossing(a: Point3, b: Point3, c: Point3, d: Point3): Point3 | undefined {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - 1e-8 || Math.max(c.x, d.x) < Math.min(a.x, b.x) - 1e-8 ||
      Math.max(a.z, b.z) < Math.min(c.z, d.z) - 1e-8 || Math.max(c.z, d.z) < Math.min(a.z, b.z) - 1e-8) return;
  const hits = intersectionFractions(a, b, c, d);
  const point = hits[0] === undefined ? undefined : at(a, b, hits[0]);
  if (!point) return;
  const dd = (d.x - c.x) ** 2 + (d.z - c.z) ** 2;
  if (dd < 1e-14) {
    if (horizontal(a, b) < 1e-7) {
      const overlap = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
      const high = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
      return overlap <= high + 1e-7 ? { ...point, y: overlap } : undefined;
    }
    if (point.y >= Math.min(c.y, d.y) - 1e-7 && point.y <= Math.max(c.y, d.y) + 1e-7) return point;
    return;
  }
  const elevationAt = (p: Point3): number => {
    const t = ((p.x - c.x) * (d.x - c.x) + (p.z - c.z) * (d.z - c.z)) / dd;
    return at(c, d, t).y;
  };
  if (horizontal(a, b) < 1e-7 && elevationAt(point) >= Math.min(a.y, b.y) - 1e-7 &&
      elevationAt(point) <= Math.max(a.y, b.y) + 1e-7) return { ...point, y: elevationAt(point) };
  const other = hits[1] === undefined ? undefined : at(a, b, hits[1]);
  const delta = point.y - elevationAt(point);
  if (Math.abs(delta) < 1e-7) return point;
  if (other) {
    const otherDelta = other.y - elevationAt(other);
    if (Math.abs(otherDelta) < 1e-7) return other;
    if (delta * otherDelta < 0) return at(point, other, delta / (delta - otherDelta));
  }
}

export function inspectRoute(
  points: readonly Point3[], constraints: RouteConstraints, floorRange = { first: 0, last: points.length - 1 },
): { diagnostic?: RouteDiagnostic; sleeves: Point3[] } {
  const sleeves: Point3[] = [];
  const err = (code: string, index: number, location: Point3, message: string) =>
    ({ diagnostic: { code, message, path: `points.${index}`, severity: 'error' as const, location }, sleeves });
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    if (i >= 2 && directionCosine(points[i - 2]!, a, b) < -1 + 1e-10) {
      return err('same_level_crossing', i, a, 'Соседние участки трассы накладываются.');
    }
    if (near(a, b)) return err('zero_route_segment', i, b, 'У участка трассы нулевая длина.');
    if (Math.abs(a.y - b.y) >= 1e-7 && (horizontal(a, b) >= 1e-7 ||
        !constraints.risers?.some((riser) => horizontal(a, riser) < 1e-7))) {
      return err('invalid_riser', i, b, 'Перепад высоты допускается только на указанном стояке.');
    }
    if (i > floorRange.first && i <= floorRange.last && !segmentInsideRoom(a, b, constraints.room)) {
      return err('outside_route', i, b, 'Участок выходит из помещения или пересекает запретную зону.');
    }
    for (let j = 1; j < i - 1; j++) {
      const hit = crossing(a, b, points[j - 1]!, points[j]!);
      if (hit) return err('same_level_crossing', i, hit, 'Трасса пересекает другой участок на той же высоте.');
    }
    for (const existing of constraints.existingRoutes ?? []) {
      for (let j = 1; j < existing.length; j++) {
        const hit = crossing(a, b, existing[j - 1]!, existing[j]!);
        if (hit) return err('same_level_crossing', i, hit, 'Трасса пересекает уже проложенную трубу на той же высоте.');
      }
    }
    for (const [from, to] of constraints.seams ?? []) {
      for (const t of intersectionFractions(a, b, from, to)) {
        const p = at(a, b, t);
        if (!sleeves.some((existing) => near(existing, p))) sleeves.push(p);
      }
    }
  }
  return { sleeves };
}

export function validateRoute(points: readonly Point3[], constraints: RouteConstraints): RouteDiagnostic[] {
  if (points.length < 2 || points.length > projectLimits.routePoints || points.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))) {
    return [{ code: 'invalid_route', path: 'points', message: 'Нужны от 2 до 1024 точек с конечными координатами.', severity: 'error' }];
  }
  const reviewed = inspectRoute(points, constraints);
  return reviewed.diagnostic ? [reviewed.diagnostic] : [];
}
