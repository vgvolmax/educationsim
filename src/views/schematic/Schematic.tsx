import { useId } from 'react';
import type { MouseEvent } from 'react';
import { equipmentRegistry } from '../../project/registry';
import type { RouteOverlay } from '../../editor/RouteTools';
import { routeGrid } from '../../editor/route-drawing';
import type { RouteDrawing } from '../../editor/route-drawing';
import { rectangleOf } from '../../project/editor-geometry';
import { sketchPairKey, untracedPath } from './untraced-path';
import type { Point2, ProjectDocument } from '../../project/types';

type Props = { project: ProjectDocument; level: number; selected: string | null;
  drawing?: RouteDrawing; onTracePoint?(point: Point2 | undefined, commit: boolean): void;
  onSelect(id: string): void; onPlace?(point: Point2): void; selectedLink?: string | null; onLinkSelect?(id: string): void; water: boolean; control: boolean; overlay?: RouteOverlay };
export function Schematic({ project, level, selected, onSelect, onPlace, selectedLink, onLinkSelect, water, control, overlay, drawing, onTracePoint }: Props) {
  const gridId = useId();
  const tracingGridId = useId();
  const grid = drawing && routeGrid(drawing.room);
  const cursor = drawing?.cursor;
  const last = drawing?.points.at(-1);
  const placing = Boolean(onPlace || onTracePoint);
  const projectPoint = (event: MouseEvent<SVGSVGElement>) => {
    const projection = event.currentTarget.getScreenCTM();
    if (!projection) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(projection.inverse());
    return { x: point.x, z: point.y };
  };
  const rooms = project.rooms.filter((room) => room.level === level);
  const components = project.components.filter((component) => component.level === level);
  const lookup = new Map(project.components.map((c) => [c.id, c]));
  const routes = new Map(project.loopRoutes.map((route) => [route.linkId, route]));
  const orders = new Map(components.map(({ id }, i) => [id, i]));
  const connections = [...project.hydronicLinks.map((link) => ({ link, domain: 'water' as const })),
    ...project.controlLinks.map((link) => ({ link, domain: 'control' as const }))].flatMap(({ link, domain }) => {
    const a = lookup.get(link.from.componentId), b = lookup.get(link.to.componentId);
    const route = routes.get(link.id);
    const onFloor = route ? rooms.some((r) => r.id === route.roomId) : a?.level === level || b?.level === level;
    if (!a || !b || !onFloor) return [];
    const drawn = route?.points ?? (domain === 'water' ? link.points : []);
    return [{ id: link.id, domain, drawn, a, b }];
  });
  const groups = new Map<string, number>();
  const cursors = new Map<string, number>();
  connections.forEach(({ drawn, a, b }) => {
    if (drawn.length) return;
    const key = sketchPairKey(a, b);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  });
  const lines = connections.flatMap(({ id, domain, drawn, a, b }) => {
    const key = sketchPairKey(a, b), index = cursors.get(key) ?? 0;
    if (!drawn.length) cursors.set(key, index + 1);
    if (domain === 'water' ? !water : !control) return [];
    const points = drawn.length ? drawn : untracedPath(a, b, index, groups.get(key) ?? 1);
    return [{ id, domain, points, approximate: domain === 'water' && !drawn.length }];
  });
  const pts = [...rooms.flatMap(({ outline }) => outline), ...components.map((c) => c.position), ...lines.flatMap((l) => l.points)];
  const minX = Math.min(0, ...pts.map((p) => p.x)) - .7, minZ = Math.min(0, ...pts.map((p) => p.z)) - .7;
  const width = Math.max(minX + 7, ...pts.map((p) => p.x + .7)) - minX;
  const depth = Math.max(minZ + 5, ...pts.map((p) => p.z + .7)) - minZ;
  const pointList = (points: readonly Point2[]) => points.map(({ x, z }) => x + ',' + z).join(' ');
  return (
    <div className="drawing">
      <svg viewBox={[minX, minZ, width, depth].join(' ')} role="img" aria-label="Схема этажа"
        tabIndex={onTracePoint ? 0 : undefined} className={placing ? 'plan-placement' : undefined}
        onClick={placing ? (event) => {
          const point = projectPoint(event);
          if (!point) return;
          if (onTracePoint) onTracePoint(point, true);
          else onPlace?.(point);
        } : undefined}
        onPointerMove={onTracePoint ? (event) => onTracePoint(projectPoint(event), false) : undefined}
        onPointerLeave={onTracePoint ? () => onTracePoint(undefined, false) : undefined}>
        <defs><pattern id={gridId} x="0" y="0" width=".25" height=".25" patternUnits="userSpaceOnUse">
          <path d="M .25 0 H 0 V .25" fill="none" stroke="#d8dacf" strokeWidth=".018" />
        </pattern>
        {grid && drawing && <pattern id={tracingGridId} x={grid.x} y={grid.z} width={drawing.spacingM}
          height={drawing.spacingM} patternUnits="userSpaceOnUse">
          <path d={`M ${drawing.spacingM} 0 H 0 V ${drawing.spacingM}`} className="floor-grid-line" />
        </pattern>}</defs>
        <rect x={minX} y={minZ} width={width} height={depth} fill={'url(#' + gridId + ')'} />
        {rooms.map((room) => {
          const rectangle = rectangleOf(room);
          return <g key={room.id}>
          <polygon points={pointList(room.outline)} data-room={room.id} data-width={rectangle?.widthM}
            className={selected === room.id ? 'room selected' : 'room'} onClick={placing ? undefined : () => onSelect(room.id)} />
          {drawing?.room.id === room.id && <>
            <polygon points={pointList(room.outline)} className="floor-room" pointerEvents="none" />
            <polygon points={pointList(room.outline)} fill={'url(#' + tracingGridId + ')'} pointerEvents="none" />
            {room.exclusions.map(({ origin, widthM, depthM }, index) => <rect key={index} className="floor-keepout"
              x={origin.x} y={origin.z} width={widthM} height={depthM}><title>Зона без трубы</title></rect>)}
          </>}
          <text className="room-name" x={(rectangle?.x ?? room.outline[0]!.x) + .14}
            y={rectangle ? rectangle.z + rectangle.depthM - .16 : room.outline[0]!.z + .25}>{room.name}</text>
        </g>; })}
        {lines.map(({ id, points, domain, approximate }) => <polyline key={domain + id} data-link={id}
          points={pointList(points)} onClick={onLinkSelect ? () => onLinkSelect(id) : undefined}
          className={'plan-link ' + domain + (drawing?.linkId === id ? ' floor-existing' : '') + (approximate ? ' approximate' : '') + (selectedLink === id ? ' lesson-identified' : '')}>
          <title>{id}{approximate ? ' · трасса не задана' : ''}</title>
        </polyline>)}
        {overlay?.points?.length && <polyline data-route-preview points={pointList([...overlay.points])} className="route-preview"><title>Черновик трассы</title></polyline>}
        {overlay?.mark && <circle cx={overlay.mark.x} cy={overlay.mark.z} r=".1" className="route-mark"><title>Место ошибки трассировки</title></circle>}
        {components.map((c) => <g key={c.id} onClick={placing ? undefined : () => onSelect(c.id)} className="plan-equipment">
          <circle data-component={c.id} cx={c.position.x} cy={c.position.z} r=".16" className={selected === c.id ? 'selected' : ''} />
          <text x={c.position.x} y={c.position.z + .005} className="equipment-index">{(orders.get(c.id) ?? 0) + 1}</text><title>{equipmentRegistry.get(c.typeId)?.titleRu ?? c.id}</title>
        </g>)}
        {drawing && <g className="floor-draft" pointerEvents="none">
          {drawing.points.length > 1 && <polyline data-floor-draft points={pointList(drawing.points)} />}
          {drawing.points.map(({ x, z }, index) => <circle key={index} cx={x} cy={z} r=".035" />)}
          {cursor && <g className={cursor.allowed ? 'floor-cursor' : 'floor-cursor invalid'} data-floor-cursor>
            {last && <polyline points={pointList([last, cursor.point])} />}
            <circle cx={cursor.point.x} cy={cursor.point.z} r=".062" />
          </g>}
        </g>}
        {!pts.length && <text x="0" y=".25">Добавьте комнату или оборудование</text>}
      </svg>
      <p><span className="water-key">●</span> Водяной контур <span className="control-key">┄</span> Управление
        <span className="layout-hint">Пунктир трубы: трасса не задана</span></p>
    </div>
  );
}
