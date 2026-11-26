import type { RouteOverlay } from '../../editor/RouteTools';
import { rectangleOf } from '../../project/editor-geometry';
import type { Point2, ProjectDocument } from '../../project/types';

type Props = { project: ProjectDocument; level: number; selected: string | null;
  onSelect(id: string): void; water: boolean; control: boolean; overlay?: RouteOverlay };
export function Schematic({ project, level, selected, onSelect, water, control, overlay }: Props) {
  const rooms = project.rooms.filter((room) => room.level === level);
  const components = project.components.filter((component) => component.level === level);
  const lookup = new Map(project.components.map((c) => [c.id, c]));
  const routes = new Map(project.loopRoutes.map((route) => [route.linkId, route]));
  const orders = new Map(components.map(({ id }, i) => [id, i]));
  const lines = [...(water ? project.hydronicLinks.map((link) => ({ link, domain: 'water' as const })) : []),
    ...(control ? project.controlLinks.map((link) => ({ link, domain: 'control' as const })) : [])].flatMap(({ link, domain }) => {
    const a = lookup.get(link.from.componentId), b = lookup.get(link.to.componentId);
    const route = routes.get(link.id);
    const onFloor = route ? rooms.some((r) => r.id === route.roomId) : a?.level === level || b?.level === level;
    if (!a || !b || !onFloor) return [];
    const drawn = route?.points ?? (domain === 'water' ? link.points : []);
    const points = drawn.length ? drawn : [a.position, { x: b.position.x, z: a.position.z }, b.position];
    return [{ id: link.id, domain, points, approximate: domain === 'water' && !drawn.length }];
  });
  const pts = [...rooms.flatMap(({ outline }) => outline), ...components.map((c) => c.position), ...lines.flatMap((l) => l.points)];
  const minX = Math.min(0, ...pts.map((p) => p.x)) - .7, minZ = Math.min(0, ...pts.map((p) => p.z)) - .7;
  const width = Math.max(minX + 7, ...pts.map((p) => p.x + .7)) - minX;
  const depth = Math.max(minZ + 5, ...pts.map((p) => p.z + .7)) - minZ;
  const pointList = (points: Point2[]) => points.map(({ x, z }) => x + ',' + z).join(' ');
  return (
    <div className="drawing">
      <svg viewBox={[minX, minZ, width, depth].join(' ')} role="img" aria-label="Схема этажа">
        <defs><pattern id="plan-grid" x="0" y="0" width=".25" height=".25" patternUnits="userSpaceOnUse">
          <path d="M .25 0 H 0 V .25" fill="none" stroke="#d8dacf" strokeWidth=".018" />
        </pattern></defs>
        <rect x={minX} y={minZ} width={width} height={depth} fill="url(#plan-grid)" />
        {rooms.map((room) => {
          const rectangle = rectangleOf(room);
          return <g key={room.id}>
          <polygon points={pointList(room.outline)} data-room={room.id} data-width={rectangle?.widthM}
            className={selected === room.id ? 'room selected' : 'room'} onClick={() => onSelect(room.id)} />
          <text className="room-name" x={(rectangle?.x ?? room.outline[0]!.x) + .14}
            y={rectangle ? rectangle.z + rectangle.depthM - .16 : room.outline[0]!.z + .25}>{room.name}</text>
        </g>; })}
        {lines.map(({ id, points, domain, approximate }) => <polyline key={domain + id} data-link={id}
          points={pointList(points)} className={'plan-link ' + domain + (approximate ? ' approximate' : '')}><title>{id}</title></polyline>)}
        {overlay?.points?.length && <polyline data-route-preview points={pointList([...overlay.points])} className="route-preview"><title>Черновик трассы</title></polyline>}
        {overlay?.mark && <circle cx={overlay.mark.x} cy={overlay.mark.z} r=".1" className="route-mark"><title>Место ошибки трассировки</title></circle>}
        {components.map((c) => <g key={c.id} onClick={() => onSelect(c.id)} className="plan-equipment">
          <circle data-component={c.id} cx={c.position.x} cy={c.position.z} r=".16" className={selected === c.id ? 'selected' : ''} />
          <text x={c.position.x} y={c.position.z + .005} className="equipment-index">{(orders.get(c.id) ?? 0) + 1}</text><title>{c.id}</title>
        </g>)}
        {!pts.length && <text x="0" y=".25">Добавьте комнату или оборудование</text>}
      </svg>
      <p><span className="water-key">●</span> Водяной контур <span className="control-key">┄</span> Управление
        <span className="layout-hint">Пунктир трубы: трасса не задана</span></p>
    </div>
  );
}
