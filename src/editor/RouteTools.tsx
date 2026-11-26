import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoutingClient } from '../project/routing-client';
import { parseRussianDecimal } from '../project/units';
import type { LoopRouteInput } from '../project/routing';
import type { Point3, ProjectDocument } from '../project/types';
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

export function RouteTools({ project, ctl, level, onOverlay }: { project: ProjectDocument; ctl: ProjectController;
  level: number; onOverlay(overlay: RouteOverlay): void }) {
  const [roomId, setRoomId] = useState('');
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

  const rooms = project.rooms.filter((r) => r.level === level);
  const levelComponents = new Set(project.components.filter((c) => c.level === level).map((c) => c.id));
  const links = project.hydronicLinks.filter((l) => levelComponents.has(l.from.componentId) && levelComponents.has(l.to.componentId));
  const room = rooms.find((r) => r.id === roomId) ?? rooms[0];
  const link = links.find((l) => l.id === linkId) ?? links[0];
  const previous = project.loopRoutes.find((r) => r.linkId === link?.id);
  const locatedPoints = previous?.points.map((p) => p.x + ' ' + p.z).join('\n') ?? '';
  function cancel() {
    refs.current.token++;
    client.cancel();
    setRunning(false);
    setAttempt(null);
    setConfirmManual(false);
    onOverlay({});
  }
  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!room || !link) return;
    const values = new FormData(event.currentTarget);
    const spacing = decimal(values, 'spacing'), radius = decimal(values, 'radius');
    const coords = positivePoints(String(values.get('points')), previous?.points[0]?.y ?? level * 3);
    if (spacing === null || radius === null || !coords) { ctl.setError('Введите шаг, радиус и хотя бы две точки X Z на отдельных строках.'); return; }
    ctl.setError(null);
    setConfirmManual(false);
    setAttempt(null);
    setRunning(true);
    onOverlay({});
    const token = ++refs.current.token;
    const base = { room, spacingM: spacing / 1000, radiusM: radius / 1000, start: coords[0]!, end: coords.at(-1)!,
      existingRoutes: project.loopRoutes.filter((r) => r.linkId !== link.id).map((r) => r.points) };
    const rawDirection = String(values.get('direction'));
    const direction = rawDirection === '-x' || rawDirection === '+z' || rawDirection === '-z' ? rawDirection : '+x';
    const result = await client.request(kind === 'manual' ? { ...base, kind, points: coords } : { ...base, kind, direction });
    if (refs.current.token !== token) return;
    setRunning(false);
    setSpacingM(base.spacingM);
    setAttempt(result);
    if (result.status === 'ready') onOverlay({ points: result.route.points });
    else if (result.status === 'failed') onOverlay({ mark: result.diagnostics.find((d) => d.location)?.location });
  }
  const current = attempt?.status === 'ready' && attempt.revision === project.revision;
  return <details className="editor-section">
    <summary>Трассировка петли</summary>
    {(!room || !link) ? <p>Нужна комната и водяная связь на текущем этаже.</p> : <>
      <p>Укажите напольные точки выбранной петли, а не координаты корпуса коллектора. Предпросмотр не меняет схему.</p>
      <form className="room-fields" onSubmit={(e) => void calculate(e)} key={room.id + ':' + link.id}>
        <label>Комната петли<select value={room.id} onChange={(e) => { cancel(); setRoomId(e.target.value); }}>
          {rooms.map((r) => <option value={r.id} key={r.id}>{r.name}</option>)}</select></label>
        <label>Связь петли<select value={link.id} onChange={(e) => { cancel(); setLinkId(e.target.value); }}>
          {links.map((l) => <option value={l.id} key={l.id}>{l.id} ({l.from.portId} → {l.to.portId})</option>)}</select></label>
        <label>Укладка<select value={kind} onChange={(e) => {
          const value = e.target.value;
          cancel(); setKind(value === 'spiral' || value === 'serpentine' ? value : 'manual');
        }}><option value="manual">Ручная</option><option value="serpentine">Змейка</option><option value="spiral">Улитка</option></select></label>
        <label>Шаг, мм<input name="spacing" defaultValue={String((previous?.spacingM ?? .15) * 1000)} inputMode="decimal" /></label>
        <label>Радиус поворота, мм<input name="radius" defaultValue="30" inputMode="decimal" /></label>
        {kind !== 'manual' && <label>Направление первого пролёта<select name="direction">
          <option value="+x">Вправо</option><option value="-x">Влево</option><option value="+z">Вниз</option><option value="-z">Вверх</option>
        </select></label>}
        <label>{kind === 'manual' ? 'Точки X Z, м' : 'Вход и выход на одной стене, X Z, м'}
          <textarea name="points" rows={4} defaultValue={locatedPoints} placeholder={'0 0,4\n0 0,55'} />
        </label>
        <button type="submit" disabled={running}>Предпросмотр трассы</button>
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
          if (accepted.revision !== expectedRevision && accepted.route && ctl.apply({ kind: 'set_loop_route', commandId: editorId('route'),
            expectedRevision, route: { id: previous?.id ?? editorId('loop'), linkId: link.id, roomId: room.id,
              spacingM, kind: accepted.route.kind, points: accepted.route.points } })) cancel();
        }}>Принять трассу</button>
        <button onClick={cancel}>Оставить прежнюю трассу</button>
      </div>}
    </>}
  </details>;
}
