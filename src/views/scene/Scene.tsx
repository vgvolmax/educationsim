import { useEffect, useRef, useState } from 'react';
import { equipmentRegistry } from '../../project/registry';
import { sceneInput } from './buildScene';
import { canOpenCutaway, componentCutaway } from './componentCutaway';
import { visualTimeScale } from './flow';
import { sceneHeat } from './heatMap';
import { CutawayDiagram } from './CutawayDiagram';
import { createSceneRenderer } from './renderScene';
import { numberRu } from '../measurements/RunReadings';
import type { Placement } from '../../editor/placement';
import type { Point2, ProjectDocument } from '../../project/types';
import type { SessionView } from '../../simulation/session';
import type { CompiledSystem } from '../../simulation/types';
import './scene.css';

export type SceneLive = { frame: SessionView; system: CompiledSystem; valves: Readonly<Record<string, number>>; setValve(id: string, opening: number): void };
type Props = { project: ProjectDocument; level: number; selected: string | null; live: SceneLive | null;
  placement: Placement | null; onSelect(id: string): void; onUnavailable(): void; onPlace(point: Point2, part?: Placement): void; onDrag(id: string): Placement | null };

export function Scene({ project, level, selected, live, placement, onSelect, onUnavailable, onPlace, onDrag }: Props) {
  const node = useRef<HTMLCanvasElement>(null);
  const adapter = useRef<ReturnType<typeof createSceneRenderer> | null>(null);
  type CameraPose = ReturnType<NonNullable<typeof adapter.current>['cameraPose']>;
  const lastCamera = useRef<{ key: string; pose: CameraPose } | null>(null);
  const [transparent, setTransparent] = useState(true);
  const [heat, setHeat] = useState(false);
  const [section, setSection] = useState(false);
  const [cut, setCut] = useState(false);
  const [still, setStill] = useState(() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const callbacks = useRef({ onSelect, onUnavailable, onPlace, onDrag });
  callbacks.current = { onSelect, onUnavailable, onPlace, onDrag };
  const frame = live?.system.projectRevision === project.revision && live.system.projectId === project.projectId ? live.frame : null;
  const flags = useRef({ selected, transparent, heat, section, still, frame, placement });
  flags.current = { selected, transparent, heat, section, still, frame, placement };
  useEffect(() => {
    const canvas = node.current;
    if (!canvas) return;
    const loss = (e: Event) => { e.preventDefault(); callbacks.current.onUnavailable(); };
    canvas.addEventListener('webglcontextlost', loss);
    const key = project.projectId + ':' + level;
    try {
      adapter.current = createSceneRenderer(canvas, sceneInput(project, level), project, () => flags.current,
        (id) => callbacks.current.onSelect(id), (point, part) => callbacks.current.onPlace(point, part), (id) => callbacks.current.onDrag(id));
      if (lastCamera.current?.key === key) adapter.current.restoreCamera(lastCamera.current.pose);
    } catch {
      callbacks.current.onUnavailable();
    }
    return () => {
      canvas.removeEventListener('webglcontextlost', loss);
      if (adapter.current) {
        lastCamera.current = { key, pose: adapter.current.cameraPose() };
        adapter.current.dispose();
        adapter.current = null;
      }
    };
  }, [project, level]);
  const placing = placement !== null;
  useEffect(() => {
    if (placing) node.current?.focus({ preventScroll: true });
  }, [placing]);
  const component = project.components.find((c) => c.id === selected && c.level === level);
  const activeCut = cut && component ? componentCutaway(project, live?.system ?? null, component.id, frame) : null;
  const warm = heat ? sceneHeat(project, frame).filter((h) => project.rooms.some((r) => r.id === h.roomId && r.level === level)) : [];
  return <section className="scene-area" aria-label="Объёмная схема">
    <div className="scene-options">
      <button onClick={() => adapter.current?.cameraMode('orbit')}>Общий вид</button>
      <button onClick={() => adapter.current?.cameraMode('top')}>Сверху</button>
      <button className="scene-inspection-option" disabled={!component} onClick={() => component && adapter.current?.focus(component.id)}>Фокус на узле</button>
      <button className="scene-inspection-option" onClick={() => { setSection((v) => !v); adapter.current?.cameraMode(section ? 'orbit' : 'slice'); }} aria-pressed={section}>Разрез пола</button>
      <button onClick={() => adapter.current?.zoom(.8)} aria-label="Приблизить 3D">+</button>
      <button onClick={() => adapter.current?.zoom(1.25)} aria-label="Отдалить 3D">−</button>
      <label><input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> Прозрачные стены</label>
      <label><input type="checkbox" checked={heat} onChange={(e) => setHeat(e.target.checked)} /> Тепловая карта</label>
      <label><input type="checkbox" checked={still} onChange={(e) => setStill(e.target.checked)} /> Без движения</label>
    </div>
    <p className="scene-help" id="scene-camera-help">{placing ?
      'Сетка привязывает деталь к шагу 25 см. Красная подсветка отмечает занятое место.' :
      'Мышь: перетаскивание поворачивает вид, колесо меняет масштаб. Камера перемещается клавишами: стрелки и WASD. Чтобы переставить деталь, выделите её и перетащите.'}</p>
    <canvas ref={node} data-scene className={placement ? "scene-building" : undefined} role="img" tabIndex={0} aria-describedby="scene-camera-help"
      aria-keyshortcuts="ArrowUp ArrowLeft ArrowDown ArrowRight W A S D" aria-label="Интерактивная 3D схема. Объекты доступны в списке слева." />
    <p className="scene-occupied" role="status">Место занято. Сместите деталь.</p>
    <div className="scene-legend">
      <p>{component ? 'Выбрано в 3D: ' + (equipmentRegistry.get(component.typeId)?.titleRu ?? component.typeId) : 'Выберите узел на схеме или в списке.'}</p>
      <p>Частицы показывают направление и скорость потока. Скорость анимации ×{numberRu(visualTimeScale, 2)}. {frame?.stale ?
        'Нет актуального кадра, последний тик ' + frame.snapshot.tick + '.' : frame ? 'Модельный тик ' + frame.snapshot.tick + '.' : 'Расчёт не запущен.'}</p>
      {section && <p>Условный разрез: основание, теплоизоляция, стяжка и покрытие. Толщины на рисунке не паспортные.</p>}
      {warm.length > 0 && <ul>{warm.map((entry) => <li key={entry.roomId}>
        {project.rooms.find((r) => r.id === entry.roomId)?.name}: поверхность {entry.surfaceC === null ? 'нет данных' : numberRu(entry.surfaceC) + ' °C'},
        теплоноситель {entry.waterC === null ? 'нет данных' : numberRu(entry.waterC) + ' °C'} (средние значения по петлям).
      </li>)}</ul>}
    </div>
    {component && canOpenCutaway(component.typeId) && <button aria-expanded={cut} onClick={() => setCut((v) => !v)}>Как работает</button>}
    {activeCut && <div className="scene-cutaway">
      <h3>{activeCut.title}: условный разрез</h3>
      <p>{activeCut.separated ? 'Контуры передают тепло, но жидкости не смешиваются.' : 'Показаны подключённые пути и доступные расчётные показания.'}</p>
      <CutawayDiagram model={activeCut} />
      {activeCut.paths.length > 0 ? <div className="cutaway-paths">
        {activeCut.paths.map((path) => <div key={path.id} data-channel={path.id} className={'cutaway-path ' + (path.liquid === 'propylene-glycol' ? 'glycol' : 'water')}>
          <strong>{path.from} {path.lMin !== null && path.lMin < 0 ? '←' : path.lMin === 0 ? '⊣' : '→'} {path.to}</strong>
          <span>{path.lMin === null ? 'нет актуального расхода' : numberRu(path.lMin) + ' л/мин'}</span>
          {path.liquid && <span>{path.liquid === 'propylene-glycol' ? 'пропиленгликоль' : 'вода'}</span>}
          {(path.opening !== null || live?.valves[path.id] !== undefined) &&
            <span>{path.lMin === null ? 'Начальная настройка' : 'Открытие'} {numberRu((path.opening ?? live!.valves[path.id]!) * 100, 0)} %</span>}
          {live?.valves[path.id] !== undefined && frame && !frame.stale && frame.mode !== 'stopped' &&
            <button onClick={() => live.setValve(path.id, (path.opening ?? live.valves[path.id]) === 0 ? 1 : 0)}>
              {(path.opening ?? live.valves[path.id]) === 0 ? 'Открыть этот клапан' : 'Закрыть этот клапан'}</button>}
        </div>)}
      </div> : <p>Нет привязанных каналов текущего проекта. Подготовьте прогон.</p>}
      {activeCut.pressurePa !== null && <p>Избыточное давление {numberRu(activeCut.pressurePa / 1000, 1)} кПа.</p>}
      {activeCut.releasedKg !== null && <p>Сброшено {numberRu(activeCut.releasedKg, 3)} кг за тик.</p>}
    </div>}
  </section>;
}
