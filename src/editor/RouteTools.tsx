import { useEffect, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { createRoutingClient } from '../project/routing-client';
import { parseRussianDecimal } from '../project/units';
import type { LoopRouteInput } from '../project/routing';
import { measureRoute } from '../project/routing';
import type { RouteDrawing } from './route-drawing';
import { portLabel } from './portLabel';
import { equipmentRegistry, trainingRegistry } from '../project/registry';
import type { HydronicLink, Point3, PortEndpoint, ProjectDocument, ProjectEdit } from '../project/types';
import { editorId } from './useProject';
import type { ProjectController } from './useProject';

export type RouteOverlay = { points?: readonly Point3[]; mark?: Point3 };
type Run = Awaited<ReturnType<ReturnType<typeof createRoutingClient>['request']>>;
const decimal = (form: FormData, name: string) => parseRussianDecimal(String(form.get(name)));
const positivePoints = (raw: string, y: number): Point3[] | null => {
  const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean);
  const points: Point3[] = [];
  if (lines.length < 2 || lines.length > 1024) return null;
  for (const line of lines) {
    const coords = line.split(/\s*;\s*|\s+/);
    const x = coords[0] && parseRussianDecimal(coords[0]), z = coords[1] && parseRussianDecimal(coords[1]);
    if (coords.length !== 2 || typeof x !== 'number' || typeof z !== 'number') return null;
    points.push({ x, y, z });
  }
  return points;
};

const endpointKey = ({ componentId, portId }: PortEndpoint) => componentId + ':' + portId;

function availableLoops(project: ProjectDocument, level: number): HydronicLink[] {
  const occupied = new Set(project.hydronicLinks.flatMap(({ from, to }) => [endpointKey(from), endpointKey(to)]));
  return project.components.filter((item) => item.level === level).flatMap(({ id, typeId }) => {
    const spec = equipmentRegistry.get(typeId);
    if (spec?.family !== 'manifolds') return [];
    return spec.component.ports.flatMap((port) => {
      if (port.domain !== 'hydronic' || !/^supply-\d+$/.test(port.id) || port.connector.family !== 'tube') return [];
      const from = { componentId: id, portId: port.id };
      const to = { componentId: id, portId: port.id.replace('supply-', 'return-') };
      if (occupied.has(endpointKey(from)) || occupied.has(endpointKey(to)) ||
          !spec.component.ports.some((candidate) => candidate.id === to.portId)) return [];
      return [{ id: 'new:' + endpointKey(from), from, to, points: [], materialId: 'training-pipe',
        innerDiameterM: port.connector.diameterMm * .00075 }];
    });
  });
}

export function RouteTools({ project, ctl, level, selectedRoom, drawing, tool, onDrawing, onPlan, onOverlay }: {
  project: ProjectDocument; ctl: ProjectController; level: number; selectedRoom?: string; drawing: RouteDrawing | null;
  tool: RefObject<HTMLDetailsElement | null>; onDrawing(drawing: RouteDrawing | null): void; onPlan(): void; onOverlay(overlay: RouteOverlay): void;
}) {
  const [roomId, setRoomId] = useState('');
  const [coordinates, setCoordinates] = useState(false);
  const [linkId, setLinkId] = useState('');
  const [kind, setKind] = useState<LoopRouteInput['kind']>('manual');
  const [running, setRunning] = useState(false);
  const [attempt, setAttempt] = useState<Run | null>(null);
  const [spacingM, setSpacingM] = useState(.15);
  const [confirmManual, setConfirmManual] = useState(false);
  const refs = useRef({ revision: project.revision, token: 0 });
  refs.current.revision = project.revision;
  const [client] = useState(() => createRoutingClient(() => refs.current.revision));
  useEffect(() => () => { refs.current.token++; client.cancel(); }, [client]);

  const floorComponents = project.components.filter((c) => c.level === level);
  const rooms = project.rooms.filter((r) => r.level === level);
  const levelComponents = new Set(floorComponents.map((c) => c.id));
  const links = project.hydronicLinks.filter((l) => levelComponents.has(l.from.componentId) && levelComponents.has(l.to.componentId));
  const room = rooms.find((r) => r.id === (roomId || selectedRoom)) ?? rooms[0];
  const floorLoops = links.filter((l) => project.loopRoutes.some((r) => r.linkId === l.id) ||
    (l.from.componentId === l.to.componentId && /^supply-\d+$/.test(l.from.portId) && l.to.portId === l.from.portId.replace('supply-', 'return-')));
  const openLoops = availableLoops(project, level);
  const link = [...links, ...openLoops].find((l) => l.id === linkId) ?? floorLoops.find((l) =>
    project.loopRoutes.some((r) => r.linkId === l.id && r.roomId === room?.id)) ?? openLoops[0] ?? floorLoops[0] ?? links[0];
  const newLink = Boolean(link?.id.startsWith('new:'));
  function labelPort(endpoint: PortEndpoint) {
    const type = project.components.find((c) => c.id === endpoint.componentId)?.typeId;
    const port = type && trainingRegistry.get(type)?.ports.find((p) => p.id === endpoint.portId);
    return port ? portLabel(port) : endpoint.portId;
  }
  function labelNewLoop(candidate: HydronicLink) {
    const index = floorComponents.findIndex(({ id }) => id === candidate.from.componentId);
    const item = floorComponents[index];
    const model = item && equipmentRegistry.get(item.typeId)?.titleRu;
    return 'Петля ' + candidate.from.portId.slice(7) + ' · ' + (model ?? 'Коллектор') + ' №' + (index + 1);
  }
  const previous = project.loopRoutes.find((r) => r.linkId === link?.id);
  const locatedPoints = previous?.points.map((p) => p.x + ' ' + p.z).join('\n') ?? '';
  const active = drawing?.room.id === room?.id ? drawing : null;
  const y = previous?.points[0]?.y ?? level * 3;
  function cancel() {
    refs.current.token++;
    client.cancel();
    setRunning(false);
    setAttempt(null);
    setConfirmManual(false);
    onDrawing(null);
    onOverlay({});
  }
  function startDrawing(form: HTMLFormElement) {
    if (!room || !link) return;
    const values = new FormData(form);
    const spacing = decimal(values, 'spacing'), radius = decimal(values, 'radius');
    if (spacing === null || spacing < 50 || spacing > 400 || radius === null || radius <= 0) {
      ctl.setError('Задайте шаг от 50 до 400 мм и положительный радиус поворота.');
      return;
    }
    cancel();
    ctl.setError(null);
    setCoordinates(false);
    setRoomId(room.id);
    onPlan();
    onDrawing({ room, kind, linkId: link.id, revision: project.revision, y, spacingM: spacing / 1000, points: [] });
  }
  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!room || !link) return;
    const values = new FormData(event.currentTarget);
    const spacing = decimal(values, 'spacing'), radius = decimal(values, 'radius');
    const coords = active?.points ?? positivePoints(String(values.get('points')), y);
    if (spacing === null || radius === null || !coords || coords.length < 2) {
      ctl.setError('Задайте шаг, радиус и хотя бы две точки трассы.');
      return;
    }
    onPlan();
    setRoomId(room.id);
    setLinkId(link.id);
    ctl.setError(null);
    setConfirmManual(false);
    setAttempt(null);
    setRunning(true);
    if (active) onDrawing({ ...active, locked: true, cursor: undefined });
    onOverlay({});
    const token = ++refs.current.token;
    const base = { room, spacingM: spacing / 1000, radiusM: radius / 1000, start: coords[0]!, end: coords.at(-1)!,
      existingRoutes: project.loopRoutes.filter((r) => r.linkId !== link.id).map((r) => r.points) };
    const rawDirection = String(values.get('direction'));
    const direction = rawDirection === '-x' || rawDirection === '+z' || rawDirection === '-z' ? rawDirection : '+x';
    const result = await client.request(kind === 'manual' ? { ...base, kind, points: coords } : { ...base, kind, direction: active?.direction ?? direction });
    if (refs.current.token !== token) return;
    setRunning(false);
    setSpacingM(base.spacingM);
    setAttempt(result);
    if (result.status === 'ready') {
      onDrawing(null);
      onOverlay({ points: result.route.points });
    }
    else if (result.status === 'failed') {
      if (active) onDrawing({ ...active, cursor: undefined });
      onOverlay({ mark: result.diagnostics.find((d) => d.location)?.location });
    }
  }
  const current = attempt?.status === 'ready' && attempt.revision === project.revision;
  return <details ref={tool} className="editor-section floor-tool" onToggle={(event) => {
    if (!event.currentTarget.open && (active || attempt || running)) cancel();
  }}>
    <summary><span>Трассировка петли</span> <small>Тёплый пол</small></summary>
    {(!room || !link) ? <p>{room
      ? 'Возьмите коллектор из палитры «Детали» и установите его на этаже. После этого здесь появятся свободные петли.'
      : 'Добавьте комнату на текущем этаже.'}</p> : <>
      <form className="room-fields" onSubmit={(e) => void calculate(e)} key={room.id + ':' + link.id}>
        <label>Комната петли<select value={room.id} onChange={(e) => { cancel(); setRoomId(e.target.value); }}>
          {rooms.map((r) => <option value={r.id} key={r.id}>{r.name}</option>)}</select></label>
        <label>Связь петли<select value={link.id} onChange={(e) => { cancel(); setLinkId(e.target.value); }}>
          {openLoops.length > 0 && <optgroup label="Свободные петли коллектора">
            {openLoops.map((l) => <option value={l.id} key={l.id}>{labelNewLoop(l)}</option>)}
          </optgroup>}
          {floorLoops.length > 0 && <optgroup label="Подключённые петли">
            {floorLoops.map((l) => <option value={l.id} key={l.id}>
              {labelPort(l.from)} → {labelPort(l.to)} · {l.id}
            </option>)}
          </optgroup>}
          {links.length > floorLoops.length && <optgroup label="Другие водяные связи">
            {links.filter((l) => !floorLoops.includes(l)).map((l) => <option value={l.id} key={l.id}>
              {labelPort(l.from)} → {labelPort(l.to)} · {l.id}
            </option>)}
          </optgroup>}</select></label>
        <label>Укладка<select value={kind} onChange={(e) => {
          const value = e.target.value;
          cancel(); setKind(value === 'spiral' || value === 'serpentine' ? value : 'manual');
        }}><option value="manual">Ручная</option><option value="serpentine">Змейка</option><option value="spiral">Улитка</option></select></label>
        <label title="Расстояние между осями соседних прямых проходов">Шаг, мм<input name="spacing" defaultValue={String((previous?.spacingM ?? .15) * 1000)} inputMode="decimal"
          onChange={() => { if (active || attempt || running) cancel(); }} /></label>
        <label>Радиус поворота, мм<input name="radius" defaultValue="30" inputMode="decimal"
          onChange={() => { if (attempt || running) cancel(); }} /></label>
        <div className="floor-actions">
          {!active && <button type="button" className="action-primary" disabled={running}
            onClick={(event) => { if (event.currentTarget.form) startDrawing(event.currentTarget.form); }}>
            {kind === 'manual' ? 'Рисовать трубу на плане' : 'Отметить вход и выход на плане'}
          </button>}
          {active && <>
            <button className="action-primary" type="submit" disabled={running || active.points.length < 2}>Предпросмотр трассы</button>
            <button type="button" disabled={running || !active.points.length} onClick={() => {
              cancel();
              onDrawing({ ...active, points: active.points.slice(0, -1), cursor: undefined });
            }}>Убрать точку</button>
            <button type="button" onClick={cancel}>Отменить рисование</button>
          </>}
          {!active && <button type="button" aria-expanded={coordinates} onClick={() => setCoordinates((value) => !value)}>Ввести координаты</button>}
        </div>
        {newLink && !active && !current && <p className="floor-instructions">Связь подачи и обратки сохранится вместе с трассой.</p>}
        {active && <p className="floor-instructions" role="status">
          {kind === 'manual' ? (active.points.length ? 'Щёлкайте в местах поворота и в конце петли.' : 'Щёлкните в комнате, чтобы начать трубу.') :
            (active.points.length === 2 ? 'Вход и выход заданы. Откройте предпросмотр укладки.' :
              active.points.length ? 'Щёлкните рядом со входом, чтобы разместить выход на той же стене.' : 'Щёлкните рядом со стеной, чтобы поставить вход.')}
          {' '}Шаг {Math.round(active.spacingM * 1000)} мм. Точек {active.points.length}.
          {kind === 'manual' && active.points.length > 1 && ' По прямым участкам ' + measureRoute(active.points).toFixed(2).replace('.', ',') + ' м.'}
        </p>}
        {!active && coordinates && <div className="floor-coordinate-fields">
          {kind !== 'manual' && <label>Направление первого пролёта<select name="direction">
            <option value="+x">Вправо</option><option value="-x">Влево</option><option value="+z">Вниз</option><option value="-z">Вверх</option>
          </select></label>}
          <label>{kind === 'manual' ? 'Точки X Z, м' : 'Вход и выход на одной стене, X Z, м'}
            <textarea name="points" rows={4} defaultValue={locatedPoints} placeholder={'0 0,4\n0 0,55'} />
          </label>
          <button type="submit" disabled={running}>Предпросмотр трассы</button>
        </div>}
        {running && <button type="button" onClick={cancel}>Отменить расчёт трассы</button>}
      </form>
      {attempt?.status === 'failed' && <ul className="route-warnings">{attempt.diagnostics.map((d, i) => <li key={i}>{d.message}</li>)}</ul>}
      {(attempt?.status === 'stale' || (attempt?.status === 'ready' && !current)) && <p>Предпросмотр устарел. Запросите новый.</p>}
      {current && attempt.status === 'ready' && <div className="route-proposal">
        <p>Длина черновика: {attempt.route.lengthM.toFixed(2).replace('.', ',')} м.</p>
        {attempt.diagnostics.map((d, i) => <p key={i}>{d.message}</p>)}
        {previous?.kind === 'manual' && <label><input type="checkbox" checked={confirmManual}
          onChange={(e) => setConfirmManual(e.target.checked)} /> Заменить прежнюю ручную трассу</label>}
        <button disabled={previous?.kind === 'manual' && !confirmManual} onClick={() => {
          const expectedRevision = project.revision;
          const accepted = client.applyPreview({ revision: expectedRevision, route: previous?.kind === 'manual' ?
            { kind: 'manual', points: previous.points, lengthM: 0, bends: [], sleeves: [] } : null }, attempt, confirmManual);
          if (accepted.revision === expectedRevision || !accepted.route) return;
          const targetLinkId = newLink ? editorId('pipe') : link.id;
          const edit: ProjectEdit = { kind: 'set_loop_route', commandId: editorId('route'), expectedRevision,
            route: { id: previous?.id ?? editorId('loop'), linkId: targetLinkId, roomId: room.id,
              spacingM, kind: accepted.route.kind, points: accepted.route.points } };
          if (ctl.apply(newLink ? { kind: 'batch', commandId: editorId('lay'), edits: [
            { kind: 'connect_hydronic', commandId: editorId('connect'), link: { ...link, id: targetLinkId } }, edit,
          ] } : edit)) {
            setLinkId(targetLinkId);
            cancel();
          }
        }}>Принять трассу</button>
        <button onClick={cancel}>Оставить прежнюю трассу</button>
      </div>}
    </>}
  </details>;
}
