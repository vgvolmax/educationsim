import { equipmentRegistry } from '../../project/registry';
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
    const points: readonly Point3[] = authored.length >= 2 ? authored : [from.position, { x: to.position.x, y: from.position.y, z: from.position.z }, to.position];
    return [{ id: 'link:' + link.id, points, diameterM: link.innerDiameterM, approximate: authored.length < 2 }];
  });
  return { rooms, equipment, pipes, floorY: level * 3 };
}
