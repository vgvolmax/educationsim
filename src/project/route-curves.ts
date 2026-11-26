import { distance } from './route-warnings';
import type { Point3 } from './types';

export type RouteBend = { center: Point3; radiusM: number; sweepRad: number; pointIndex: number };
type Turn = { incoming: Point3; outgoing: Point3; center: Point3; angle: number; trim: number };
const eps = 1e-8;
const move = (p: Point3, d: Point3, t: number): Point3 => ({ x: p.x + d.x * t, y: p.y + d.y * t, z: p.z + d.z * t });

export function roundCorners(vertices: readonly Point3[], radiusM: number, protectedIndices: ReadonlySet<number>):
  { points: Point3[]; bends: RouteBend[]; lengthM: number; indexMap: Map<number, number> } | { failedAt: number } {
  const turns = new Map<number, Turn>();
  for (let i = 1; i < vertices.length - 1; i++) {
    const a = vertices[i - 1]!, b = vertices[i]!, c = vertices[i + 1]!;
    const ab = distance(a, b), bc = distance(b, c);
    if (ab <= eps || bc <= eps) return { failedAt: i };
    if (protectedIndices.has(i) || Math.abs(a.y - b.y) > eps || Math.abs(c.y - b.y) > eps) continue;
    const into = { x: (b.x - a.x) / ab, y: 0, z: (b.z - a.z) / ab };
    const out = { x: (c.x - b.x) / bc, y: 0, z: (c.z - b.z) / bc };
    const angle = Math.atan2(into.x * out.z - into.z * out.x, into.x * out.x + into.z * out.z);
    if (Math.abs(angle) <= eps) continue;
    const trim = radiusM * Math.tan(Math.abs(angle) / 2);
    if (Math.PI - Math.abs(angle) < eps || trim >= Math.min(ab, bc) + eps) return { failedAt: i };
    const incoming = move(b, into, -trim), outgoing = move(b, out, trim);
    const center = move(incoming, { x: -into.z, y: 0, z: into.x }, Math.sign(angle) * radiusM);
    turns.set(i, { incoming, outgoing, center, angle, trim });
  }
  for (let i = 1; i < vertices.length; i++) {
    if ((turns.get(i - 1)?.trim ?? 0) + (turns.get(i)?.trim ?? 0) > distance(vertices[i - 1]!, vertices[i]!) + eps) return { failedAt: i };
  }

  const points: Point3[] = [], bends: RouteBend[] = [], indexMap = new Map<number, number>();
  let lengthM = vertices.slice(1).reduce((sum, p, i) => sum + distance(p, vertices[i]!), 0);
  function add(p: Point3): void {
    if (!points.length || distance(points.at(-1)!, p) > eps) points.push(p);
  }
  for (const [i, vertex] of vertices.entries()) {
    const turn = turns.get(i);
    if (!turn) {
      add(vertex);
      indexMap.set(i, points.length - 1);
      continue;
    }
    add(turn.incoming);
    bends.push({ center: turn.center, radiusM, sweepRad: turn.angle, pointIndex: points.length - 1 });
    const start = Math.atan2(turn.incoming.z - turn.center.z, turn.incoming.x - turn.center.x);
    const pieces = Math.ceil(Math.abs(turn.angle) / (Math.PI / 12));
    for (let j = 1; j < pieces; j++) {
      const angle = start + j * turn.angle / pieces;
      add({ x: turn.center.x + radiusM * Math.cos(angle), y: vertex.y, z: turn.center.z + radiusM * Math.sin(angle) });
    }
    add(turn.outgoing);
    lengthM += radiusM * Math.abs(turn.angle) - 2 * turn.trim;
  }
  return { points, bends, lengthM, indexMap };
}
