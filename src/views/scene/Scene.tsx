import { useEffect, useRef, useState } from 'react';
import { sceneInput } from './buildScene';
import { canOpenCutaway, componentCutaway } from './componentCutaway';
import { visualTimeScale } from './flow';
import { sceneHeat } from './heatMap';
import { CutawayDiagram } from './CutawayDiagram';
import { createSceneRenderer } from './renderScene';
import { numberRu } from '../measurements/RunReadings';
import type { ProjectDocument } from '../../project/types';
import type { SessionView } from '../../simulation/session';
import type { CompiledSystem } from '../../simulation/types';
import './scene.css';

export type SceneLive = { frame: SessionView; system: CompiledSystem; valves: Readonly<Record<string, number>>; setValve(id: string, opening: number): void };
type Props = { project: ProjectDocument; level: number; selected: string | null; live: SceneLive | null;
  onSelect(id: string): void; onUnavailable(): void };

export function Scene({ project, level, selected, live, onSelect, onUnavailable }: Props) {
  const node = useRef<HTMLCanvasElement>(null);
  const adapter = useRef<ReturnType<typeof createSceneRenderer> | null>(null);
  const [transparent, setTransparent] = useState(true);
  const [heat, setHeat] = useState(false);
  const [section, setSection] = useState(false);
  const [cut, setCut] = useState(false);
  const [still, setStill] = useState(() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const callbacks = useRef({ onSelect, onUnavailable });
  callbacks.current = { onSelect, onUnavailable };
  const frame = live?.system.projectRevision === project.revision && live.system.projectId === project.projectId ? live.frame : null;
  const flags = useRef({ selected, transparent, heat, section, still, frame });
  flags.current = { selected, transparent, heat, section, still, frame };
  useEffect(() => {
    const canvas = node.current;
    if (!canvas) return;
    const loss = (e: Event) => { e.preventDefault(); callbacks.current.onUnavailable(); };
    canvas.addEventListener('webglcontextlost', loss);
    try {
      adapter.current = createSceneRenderer(canvas, sceneInput(project, level), project, () => flags.current, (id) => callbacks.current.onSelect(id));
    } catch {
      callbacks.current.onUnavailable();
    }
    return () => {
      canvas.removeEventListener('webglcontextlost', loss); adapter.current?.dispose(); adapter.current = null;
    };
  }, [project, level]);
  const component = project.components.find((c) => c.id === selected && c.level === level);
  const activeCut = cut && component ? componentCutaway(project, live?.system ?? null, component.id, frame) : null;
  const warm = heat ? sceneHeat(project, frame).filter((h) => project.rooms.some((r) => r.id === h.roomId && r.level === level)) : [];
  return <section className="scene-area" aria-label="Объёмная схема">
    <div className="scene-options">
      <button onClick={() => adapter.current?.cameraMode('orbit')}>Общий вид</button>
      <button onClick={() => adapter.current?.cameraMode('top')}>Сверху</button>
      <button disabled={!component} onClick={() => component && adapter.current?.focus(component.id)}>Фокус на узле</button>
      <button onClick={() => { setSection((v) => !v); adapter.current?.cameraMode(section ? 'orbit' : 'slice'); }} aria-pressed={section}>Разрез пола</button>
      <button onClick={() => adapter.current?.zoom(.8)} aria-label="Приблизить 3D">+</button>
      <button onClick={() => adapter.current?.zoom(1.25)} aria-label="Отдалить 3D">−</button>
      <label><input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> Прозрачные стены</label>
      <label><input type="checkbox" checked={heat} onChange={(e) => setHeat(e.target.checked)} /> Тепловая карта</label>
      <label><input type="checkbox" checked={still} onChange={(e) => setStill(e.target.checked)} /> Без движения</label>
    </div>
    <canvas ref={node} data-scene role="img" aria-label="Интерактивная 3D схема. Объекты доступны в списке слева." />
    <div className="scene-legend">
      <p>{component ? 'Выбрано в 3D: ' + component.id : 'Выберите узел на схеме или в списке.'}</p>
      <p>Поток: знак и скорость Q/A; масштаб частиц ×{numberRu(visualTimeScale, 2)} от физического. {frame?.stale ?
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
        {activeCut.paths.map((path) => <div key={path.id} className={'cutaway-path ' + (path.liquid === 'propylene-glycol' ? 'glycol' : 'water')}>
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
