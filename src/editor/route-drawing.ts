import { segmentInsideRoom } from '../project/geometry';
import type { FloorDirection } from '../project/route-layout';
import type { LoopRouteInput } from '../project/routing';
import type { Point2, Point3, Room } from '../project/types';

export type RouteCursor = {
  point: Point3;
  allowed: boolean;
  direction?: FloorDirection;
};
export type RouteDrawing = {
  room: Room;
  revision: number;
  linkId: string;
  locked?: boolean;
  kind: LoopRouteInput['kind'];
  spacingM: number;
  y: number;
  points: Point3[];
  cursor?: RouteCursor;
  direction?: FloorDirection;
};

export function routeGrid(room: Room) {
  return {
    x: Math.min(...room.outline.map((point) => point.x)),
    z: Math.min(...room.outline.map((point) => point.z)),
  };
}

function snap(value: number, origin: number, step: number): number {
  return origin + Math.round((value - origin) / step) * step;
}

function wallCursor(drawing: RouteDrawing, raw: Point2, origin: Point2): RouteCursor {
  const { room, y, spacingM } = drawing;
  const start = drawing.points[0];
  const cursor = { ...raw, y };
  if (start && drawing.direction) {
    const vertical = drawing.direction.endsWith('x');
    const along = vertical ? 'z' : 'x';
    const point = { ...start, [along]: start[along] + (raw[along] >= start[along] ? spacingM : -spacingM) };
    const nearWall = Math.hypot(point.x - raw.x, point.z - raw.z) <= Math.max(.2, spacingM);
    return { point, allowed: nearWall && segmentInsideRoom(start, point, room), direction: drawing.direction };
  }

  const maxX = Math.max(...room.outline.map((p) => p.x));
  const maxZ = Math.max(...room.outline.map((p) => p.z));
  const x = snap(raw.x, origin.x, spacingM);
  const z = snap(raw.z, origin.z, spacingM);
  const walls: { point: Point3; direction: FloorDirection }[] = [
    { point: { x: origin.x, y, z }, direction: '+x' },
    { point: { x: maxX, y, z }, direction: '-x' },
    { point: { x, y, z: origin.z }, direction: '+z' },
    { point: { x, y, z: maxZ }, direction: '-z' },
  ];
  const distance = (pt: Point2) => Math.hypot(pt.x - raw.x, pt.z - raw.z);
  const wall = walls.filter(({ point }) => distance(point) <= Math.max(.2, spacingM) &&
    segmentInsideRoom(point, point, room)).sort((a, b) => distance(a.point) - distance(b.point))[0];
  return wall ? { ...wall, allowed: true } : { point: cursor, allowed: false };
}

export function routeCursor(drawing: RouteDrawing, raw: Point2): RouteCursor {
  const { room, y, spacingM } = drawing;
  const origin = routeGrid(room);
  if (drawing.kind !== 'manual') return wallCursor(drawing, raw, origin);

  const last = drawing.points.at(-1);
  const point = { x: snap(raw.x, origin.x, spacingM), y, z: snap(raw.z, origin.z, spacingM) };
  if (last) {
    if (Math.abs(raw.x - last.x) >= Math.abs(raw.z - last.z)) point.z = last.z;
    else point.x = last.x;
  }
  return { point, allowed: (!last || point.x !== last.x || point.z !== last.z) &&
    segmentInsideRoom(last ?? point, point, room) };
}
