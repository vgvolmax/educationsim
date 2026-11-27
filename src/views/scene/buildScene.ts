import { equipmentRegistry } from '../../project/registry';
import { sketchPairKey, untracedPath } from '../schematic/untraced-path';
import type { Point3, ProjectDocument } from '../../project/types';

export function sceneInput(doc: ProjectDocument, level: number) {
  const rooms = doc.rooms.filter((room) => room.level === level);
  const placements = new Map(doc.components.map((component) => [component.id, component]));
  const routes = new Map(doc.loopRoutes.map((r) => [r.linkId, r]));
  const equipment = doc.components.filter((component) => component.level === level).map((component) => {
    const profile = equipmentRegistry.get(component.typeId);
    return { id: component.id, position: component.position, family: profile?.family ?? 'unknown',
      variant: profile?.variant ?? 'unknown', outlets: profile?.component.ports.filter(({ id }) =>
        /^(supply|loop)-\d+$/.test(id)).length };
  });
  const pipes = doc.hydronicLinks.flatMap((link) => {
    const from = placements.get(link.from.componentId), to = placements.get(link.to.componentId);
    if (!from || !to) return [];
    const route = routes.get(link.id);
    if (route ? !rooms.some((room) => room.id === route.roomId) : from.level !== level && to.level !== level) return [];
    const authored = route?.points ?? link.points;
    return [{ id: 'link:' + link.id, from, to, authored, diameterM: link.innerDiameterM }];
  });
  const groups = new Map<string, number>();
  const cursors = new Map<string, number>();
  for (const { from, to, authored } of pipes) {
    if (authored.length >= 2) continue;
    const key = sketchPairKey(from, to);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const paths = pipes.map(({ id, from, to, authored, diameterM }) => {
    const approximate = authored.length < 2;
    let points: readonly Point3[] = authored;
    if (approximate) {
      const a = from.position, b = to.position;
      const key = sketchPairKey(from, to), index = cursors.get(key) ?? 0;
      cursors.set(key, index + 1);
      const vertical = a.x === b.x && a.z === b.z && a.y !== b.y;
      points = vertical ? [a, b] : untracedPath(from, to, index, groups.get(key) ?? 1)
        .map(({ x, z }) => ({ x, y: a.y, z })).concat(a.y === b.y ? [] : [b]);
    }
    return { id, diameterM, points, approximate };
  });
  return { rooms, equipment, pipes: paths, floorY: level * 3 };
}
