import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, FormEvent, KeyboardEvent, ReactNode, SetStateAction } from 'react';
import { rectangleOf } from '../project/editor-geometry';
import { equipmentRegistry, trainingRegistry } from '../project/registry';
import type { Point2, PortEndpoint, ProjectDocument, Room } from '../project/types';
import { parseRussianDecimal } from '../project/units';
import { Inspector, StartConditions } from './Inspector';
import { SimulationPanel } from './SimulationPanel';
import type { TemplateId } from '../project/templates';
import { ConnectionGuide, equipmentLabel, mayCrossLevels } from './ConnectionGuide';
import { portLabel } from './portLabel';
import { PortInspector } from './PortInspector';
import { RouteTools } from './RouteTools';
import type { RouteOverlay } from './RouteTools';
import type { SceneLive } from '../views/scene/Scene';
import { Schematic } from '../views/schematic/Schematic';
import { editorId } from './useProject';
import type { ProjectController } from './useProject';
import { hasAuthoredTraces } from '../project/reducer';
import { snapToGrid } from './placement';
import type { Placement } from './placement';
import type { ProjectArtifacts } from '../storage/project-transfer';
import './editor.css';

const CatalogPanel = lazy(async () => ({ default: (await import('../catalog/CatalogPanel')).CatalogPanel }));
const Scene = lazy(async () => ({ default: (await import('../views/scene/Scene')).Scene }));
const commonParts = [
  { id: 'training-heat-source', name: 'Котёл' },
  { id: 'training-manifold-two-way', name: 'Коллектор' },
  { id: 'training-circulator', name: 'Насос' },
  { id: 'training-coupling', name: 'Муфта' },
  { id: 'training-radiator-angle-valve', name: 'Угловой клапан' },
];

function RoomForm({ room, ctl }: { room: Room; ctl: ProjectController }) {
  const dims = rectangleOf(room);
  if (!dims) return <p>Произвольный контур. Изменение через поля прямоугольника недоступно.</p>;
  return <form key={room.id + ':' + dims.widthM + ':' + dims.depthM} onSubmit={(e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const widthM = parseRussianDecimal(String(data.get('width'))), depthM = parseRussianDecimal(String(data.get('depth')));
    if (widthM === null || depthM === null) { ctl.setError('Размеры должны быть числами, например 6,5.'); return; }
    ctl.apply({ kind: 'resize_rectangular_room', commandId: editorId('edit'), roomId: room.id, widthM, depthM });
  }} className="room-fields">
    <label>Ширина, м<input name="width" defaultValue={String(dims.widthM).replace('.', ',')} inputMode="decimal" /></label>
    <label>Глубина, м<input name="depth" defaultValue={String(dims.depthM).replace('.', ',')} inputMode="decimal" /></label>
    <button type="submit">Применить размеры</button>
  </form>;
}

export function Editor({ ctl, project, preset, artifacts, onArtifacts, onHome, files, fileStatus, fileAttention }: { ctl: ProjectController; project: ProjectDocument; preset?: TemplateId;
  artifacts: ProjectArtifacts; onArtifacts: Dispatch<SetStateAction<ProjectArtifacts>>; onHome(): void; files?: ReactNode; fileStatus?: ReactNode; fileAttention?: boolean }) {
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [placementMessage, setPlacementMessage] = useState('');
  const [partsOpen, setPartsOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [sceneInspector, setSceneInspector] = useState(false);
  const [showConnections, setShowConnections] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const catalogTrigger = useRef<HTMLButtonElement>(null);
  const catalogClose = useRef<HTMLButtonElement>(null);
  const [sceneFailed, setSceneFailed] = useState(false);
  const [liveScene, setLiveScene] = useState<SceneLive | null>(null);
  const [level, setLevel] = useState(project.viewPreferences.level);
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingChoice, setPending] = useState<PortEndpoint | null>(null);
  const [connectionMessage, setConnectionMessage] = useState('');
  const [placementKey, setPlacementKey] = useState(0);
  const mountSelect = useRef<HTMLSelectElement>(null);
  const guideTitle = useRef<HTMLHeadingElement>(null);
  const [overlay, setOverlay] = useState<RouteOverlay & { revision?: number }>({});
  const [typeId, setTypeId] = useState('training-heat-source');
  const [water, setWater] = useState(true), [control, setControl] = useState(true);
  const room = project.rooms.find((r) => r.id === selected);
  const component = project.components.find((c) => c.id === selected);
  const pendingType = project.components.find((c) => c.id === pendingChoice?.componentId)?.typeId;
  const pending = pendingType && trainingRegistry.get(pendingType)?.ports.some((p) => p.id === pendingChoice?.portId) ? pendingChoice : null;
  const components = useMemo(() => project.components.filter((c) => c.level === level), [project.components, level]);
  const nextPosition = useMemo(() => Array.from({ length: 221 }, (_, i) => ({ x: (20 + i % 8 * 13) / 20, z: (20 + Math.floor(i / 8) * 13) / 20 }))
    .find((slot) => components.every(({ position }) => Math.hypot(position.x - slot.x, position.z - slot.z) >= .42)) ?? { x: 1, z: 1 }, [components]);
  const rooms = project.rooms.filter((r) => r.level === level);
  const equipmentById = new Map(project.components.map((element) => [element.id, element]));
  function endpointLabel(endpoint: PortEndpoint) {
    const element = equipmentById.get(endpoint.componentId);
    const port = element && trainingRegistry.get(element.typeId)?.ports.find(({ id }) => id === endpoint.portId);
    return (element ? equipmentLabel(element) : endpoint.componentId) + ' · ' + (port ? portLabel(port) : endpoint.portId);
  }
  const links = [...project.hydronicLinks.map((link) => ({ link, domain: 'hydronic' as const })),
    ...project.controlLinks.map((link) => ({ link, domain: 'control' as const }))]
    .filter(({ link }) => components.some((c) => c.id === link.from.componentId || c.id === link.to.componentId));

  useEffect(() => {
    document.querySelector<HTMLElement>('.editor h1')?.focus();
  }, []);

  useEffect(() => { if (catalogOpen) catalogClose.current?.focus(); }, [catalogOpen]);
  function closeCatalog() {
    setCatalogOpen(false);
    catalogTrigger.current?.focus();
  }
  const moving = placement?.movingId !== undefined;
  const routed = Boolean(component && hasAuthoredTraces(project, component.id));

  function pickPart(part: Placement) {
    cancelConnection();
    setCatalogOpen(false);
    setPartsOpen(false);
    setPlacementMessage('');
    if (viewMode !== '3d') setSceneFailed(false);
    setViewMode('3d');
    setPlacement(part);
  }

  function rotatePart() {
    setPlacement((current) => current && { ...current, quarterTurns: (current.quarterTurns + 1) % 4 });
  }

  function moveRequest(id: string) {
    const item = components.find((candidate) => candidate.id === id);
    return item && !hasAuthoredTraces(project, id) ?
      { typeId: item.typeId, movingId: id, quarterTurns: item.quarterTurns ?? 0 } : null;
  }

  function place(point: Point2, part = placement) {
    if (!part) return;
    const original = part.movingId && project.components.find(({ id }) => id === part.movingId);
    if (part.movingId && !original) return;
    const position = { x: snapToGrid(point.x), y: original ? original.position.y : 3 * level, z: snapToGrid(point.z) };
    if (components.some((item) => item.id !== part.movingId &&
        Math.hypot(item.position.x - position.x, item.position.z - position.z) < .22)) {
      setPlacementMessage('Место занято. Выберите другую точку.');
      return;
    }
    const profile = trainingRegistry.get(part.typeId);
    if (!profile) return;
    const id = part.movingId ?? editorId(part.snapshot ? 'catalog' : 'mount');
    const installed = original ? ctl.apply({ kind: 'move_component', commandId: editorId('move'), componentId: id,
      position, quarterTurns: part.quarterTurns }) : ctl.apply({ kind: 'add_component', commandId: editorId('install'),
      component: { id, level, typeId: profile.id, position, quarterTurns: part.quarterTurns, roomId: null,
        parameters: { ...profile.defaultParameters }, catalogSnapshotId: part.snapshot?.id ?? null },
      catalogSnapshot: part.snapshot });
    if (installed) {
      setSelected(id);
      setPlacement(null);
      setPlacementMessage(original ? 'Деталь перемещена.' : 'Деталь установлена.');
    }
  }

  function cancelConnection() { setPending(null); setConnectionMessage(''); }
  function keyEdit(e: KeyboardEvent) {
    if (e.key === 'Escape') { setPlacement(null); setPlacementMessage(''); cancelConnection(); return; }
    if (placement && e.code === 'KeyR' && !e.ctrlKey && !e.metaKey && !e.repeat &&
        !(e.target instanceof HTMLElement && e.target.closest('input, textarea, select'))) {
      e.preventDefault(); rotatePart(); return;
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey || (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
    const key = e.key.toLowerCase();
    if (key === 'z' || key === 'y') {
      e.preventDefault();
      cancelConnection();
      ctl.changeHistory(key === 'y' || e.shiftKey ? 'redo' : 'undo');
    }
  }
  function addRoom() {
    const x = rooms.length ? Math.max(...rooms.flatMap(({ outline }) => outline.map((p) => p.x))) + 1 : 0;
    const roomId = editorId('room');
    if (ctl.apply({ kind: 'add_rectangular_room', commandId: editorId('edit'), roomId, level, x, z: 0, widthM: 6, depthM: 4 })) setSelected(roomId);
  }
  function addComponent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (viewMode === '3d') { pickPart({ typeId, quarterTurns: 0 }); return; }
    const type = trainingRegistry.get(typeId);
    if (!type) return;
    const data = new FormData(e.currentTarget);
    const x = parseRussianDecimal(String(data.get('x'))), z = parseRussianDecimal(String(data.get('z')));
    if (x === null || z === null) { ctl.setError('Координаты монтажа должны быть числами.'); return; }
    const id = editorId('mount');
    if (ctl.apply({ kind: 'add_component', commandId: editorId('edit'),
      component: { id, typeId, position: { x, y: 3 * level, z }, level, roomId: null, catalogSnapshotId: null, parameters: { ...type.defaultParameters } },
    })) { setSelected(id); setPlacementKey((key) => key + 1); }
  }
  function pickPort(next: PortEndpoint) {
    const destination = project.components.find((c) => c.id === next.componentId);
    if (!destination) return;
    if (!pending) { setPending(next); setConnectionMessage(''); ctl.setError(null); return; }
    if (pending.componentId === next.componentId && pending.portId === next.portId) { setPending(null); return; }
    const start = project.components.find((c) => c.id === pending.componentId);
    const from = start && trainingRegistry.get(start.typeId)?.ports.find((p) => p.id === pending.portId);
    if (!start || !from) { setPending(null); ctl.setError('Исходный порт больше недоступен.'); return; }
    if (!mayCrossLevels(start, destination, from.domain)) {
      ctl.setError('Для межэтажной связи добавьте стояк.'); return;
    }
    const ends = { id: editorId('link'), from: pending, to: next };
    const commandId = editorId('edit');
    const done = from.domain === 'hydronic'
      ? ctl.apply({ kind: 'connect_hydronic', commandId, link: { ...ends, points: [], materialId: 'training-pipe',
        innerDiameterM: (from.connector.family === 'tube' ? from.connector.diameterMm : 16) * .00075 } })
      : ctl.apply({ kind: 'connect_control', commandId, link: ends });
    if (done) {
      const endPort = trainingRegistry.get(destination.typeId)?.ports.find((p) => p.id === next.portId);
      setPending(null);
      setConnectionMessage('Соединение добавлено: ' + equipmentLabel(start) + ' · ' + portLabel(from) + ' → ' +
        equipmentLabel(destination) + ' · ' + (endPort ? portLabel(endPort) : next.portId) + '.');
    }
  }
  return <main className={'editor' + (placement ? ' is-placing' : '')} onKeyDown={keyEdit}>
    <header className="work-header">
      <button onClick={onHome}>← Старт</button>
      <div><p className="eyebrow">Волмакс / конструктор</p><h1 tabIndex={-1}>{project.title}</h1></div>
      <span className="revision">Редакция {project.revision}</span>
    </header>
    <div className="work-toolbar" aria-label="Инструменты схемы">
      <div className="toolbar-group" role="group" aria-label="План этажа"><label>Этаж <select value={level} onChange={(e) => { setLevel(Number(e.target.value)); setPlacement(null); setSelected(null); setOverlay({}); }}>
        {[0, 1, 2].map((n) => <option key={n} value={n}>{n + 1}</option>)}
      </select></label>
      <button onClick={addRoom} disabled={project.rooms.length >= 12}>Добавить комнату</button></div>
      <div className="toolbar-group" role="group" aria-label="История правок"><button disabled={!ctl.history?.past.length} onClick={() => { setPlacement(null); cancelConnection(); ctl.changeHistory('undo'); }}>Отменить</button>
      <button disabled={!ctl.history?.future.length} onClick={() => { setPlacement(null); cancelConnection(); ctl.changeHistory('redo'); }}>Повторить</button></div>
      <div className="toolbar-group view-group" role="group" aria-label="Вид проекта">
      <button ref={catalogTrigger} aria-expanded={catalogOpen} aria-controls={catalogOpen ? 'editor-catalog' : undefined}
        onClick={() => catalogOpen ? closeCatalog() : setCatalogOpen(true)}>Каталог ВОЛМАКС</button>
      <button aria-pressed={viewMode === '2d'} onClick={() => setViewMode('2d')}>2D схема</button>
      <button aria-pressed={viewMode === '3d'} onClick={() => { setSceneFailed(false); setViewMode('3d'); }}>3D сцена</button></div>
      {viewMode === '2d' ? <div className="toolbar-group layer-group" role="group" aria-label="Слои 2D"><label><input type="checkbox" checked={water} onChange={(e) => setWater(e.target.checked)} /> Вода</label>
      <label><input type="checkbox" checked={control} onChange={(e) => setControl(e.target.checked)} /> Управление</label></div> :
        <button aria-pressed={sceneInspector} onClick={() => setSceneInspector((open) => !open)}>Монтаж и свойства</button>}
      <div className="project-menu">
        <button aria-expanded={filesOpen || fileAttention} aria-controls="project-files"
          onClick={() => setFilesOpen((open) => !open)}>Файлы и имя проекта</button>
        {fileStatus}
        <div className="project-menu-content" id="project-files" hidden={!filesOpen && !fileAttention}>
          {files}
          <form className="project-title-form" onSubmit={(event) => {
            event.preventDefault();
            const title = String(new FormData(event.currentTarget).get('title')).trim();
            ctl.apply({ kind: 'rename_project', commandId: editorId('title'), title });
          }}>
            <label>Имя проекта<input name="title" defaultValue={project.title} key={project.title} /></label>
            <button type="submit">Сохранить имя</button>
          </form>
        </div>
      </div>
    </div>
    {ctl.error && <p className="editor-error" role="alert">{ctl.error}</p>}
    {catalogOpen && <aside className="editor-catalog" id="editor-catalog" aria-label="Справочник проекта" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); closeCatalog(); }
    }}>
      <div className="catalog-close"><button ref={catalogClose} onClick={closeCatalog}>Закрыть каталог</button></div>
      <Suspense fallback={<p>Открываем встроенный каталог…</p>}><CatalogPanel project={project} selected={component} onPlace={pickPart}
        ctl={ctl} onPlaced={(id) => { setSelected(id); closeCatalog(); }} /></Suspense>
    </aside>}
    <section className="part-palette" aria-label="Палитра деталей">
      <strong>Детали</strong>
      {commonParts.map((item) => <button key={item.id} disabled={project.components.length >= 220}
        aria-pressed={placement?.typeId === item.id && !moving} onClick={() => pickPart({ typeId: item.id, quarterTurns: 0 })}>{item.name}</button>)}
      <button aria-expanded={partsOpen} onClick={() => setPartsOpen((open) => !open)}>Все детали</button>
      {partsOpen && <form onSubmit={(e) => { e.preventDefault(); pickPart({ typeId, quarterTurns: 0 }); }} className="part-palette-picker">
        <label>Тип детали<select value={typeId} onChange={(event) => setTypeId(event.target.value)}>
          {[...equipmentRegistry.values()].map((profile) => <option key={profile.id} value={profile.id}>{profile.titleRu}</option>)}
        </select></label>
        <button className="action-primary" type="submit" disabled={project.components.length >= 220}>Взять деталь</button>
      </form>}
    </section>
    <div className={'work-body'  + (viewMode === '3d' && !sceneInspector ? ' wide-scene' : '')}>
      <aside className="work-tree" aria-label="Объекты этажа">
        <h2>Комнаты</h2>
        {!rooms.length && <p>Нет комнат</p>}
        {rooms.map((r) => <button key={r.id} aria-pressed={selected === r.id} onClick={() => setSelected(r.id)}>{r.name}</button>)}
        <h2>Оборудование</h2>
        {!components.length && <p>Нет оборудования</p>}
        {components.map((c, i) => <button key={c.id} aria-pressed={selected === c.id} onClick={() => setSelected(c.id)} aria-label={(equipmentRegistry.get(c.typeId)?.titleRu ?? c.typeId) + ' · ' + c.id}>
          <span className="item-number">{i + 1}</span>{equipmentRegistry.get(c.typeId)?.titleRu ?? c.typeId}
        </button>)}
      </aside>
      <div className="editor-center">
        <SimulationPanel project={project} preset={preset} artifacts={artifacts} onArtifacts={onArtifacts}
          onLive={viewMode === '3d' ? setLiveScene : undefined} onFocus={(id) => {
            const focus = project.components.find((c) => c.id === id);
            if (focus) { setLevel(focus.level); setSelected(id); setOverlay({}); }
          }}>
          {viewMode === '2d' && (component || pending || !links.length || showConnections ?
            <ConnectionGuide titleRef={guideTitle} project={project} component={component} pending={pending} message={connectionMessage}
              onPick={pickPort} onCancel={cancelConnection} onMount={() => mountSelect.current?.focus()} /> :
            <div className="connection-compact"><button onClick={() => setShowConnections(true)}>Соединить элементы</button></div>)}
          {viewMode === '3d' && !placement && component && <div className="scene-context">
            <button disabled={routed} title={routed ? 'У детали есть проложенные трубы.' : undefined}
              onClick={() => pickPart({ typeId: component.typeId, movingId: component.id, quarterTurns: component.quarterTurns ?? 0 })}>Переместить деталь</button>
            <button aria-expanded={showConnections} onClick={() => setShowConnections((open) => !open)}>Подключения</button>
          </div>}
          {viewMode === '3d' && showConnections && !placement &&
            <ConnectionGuide titleRef={guideTitle} project={project} component={component} pending={pending} message={connectionMessage}
              onPick={pickPort} onCancel={cancelConnection} onMount={() => setPartsOpen(true)} />}
          {placement && <section className="placement-strip" aria-label="Размещение детали">
            <div><strong>{(moving ? 'Перемещаем: ' : 'В руке: ') + (equipmentRegistry.get(placement.typeId)?.titleRu ?? placement.typeId)}</strong>
              <p>Наведите на сетку и щёлкните по месту установки.</p></div>
            <div className="placement-actions">
              <button onClick={rotatePart}>Повернуть на 90° (R)</button>
              <button onClick={() => { setPlacement(null); setPlacementMessage(''); }}>Отмена (Esc)</button>
            </div>
            {viewMode === '2d' && <button onClick={() => place(nextPosition)}>Поставить в свободную точку</button>}
          </section>}
          {placementMessage && <p className="placement-status" role="status">{placementMessage}</p>}
          {sceneFailed && <p className="editor-error" role="alert">3D недоступно. Схема и расчёт сохранены в 2D.</p>}
          {viewMode === '3d' ? <Suspense fallback={<p>Загружаем 3D…</p>}><Scene project={project} level={level} selected={selected}
            live={liveScene} placement={placement} onPlace={place} onDrag={moveRequest} onSelect={setSelected} onUnavailable={() => { setSceneFailed(true); setViewMode('2d'); }} /></Suspense> :
            <Schematic project={project} level={level} selected={selected} onSelect={setSelected} onPlace={placement ? place : undefined} water={water} control={control}
              overlay={overlay.revision === project.revision ? overlay : undefined} />}
        </SimulationPanel>
      </div>
      <section className="work-panel" aria-label="Монтаж и свойства" hidden={viewMode === '3d' && !sceneInspector}>
        <h2>Монтаж оборудования</h2>
        <form onSubmit={addComponent} className="room-fields mount-fields">
          <label>Учебное оборудование<select ref={mountSelect} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {[...equipmentRegistry.values()].map((d) => <option key={d.id} value={d.id}>{d.titleRu}</option>)}
          </select></label>
          {viewMode === '2d' && <div className="mount-coordinates" key={level + ':' + placementKey}>
            <label>X, м<input name="x" inputMode="decimal" defaultValue={String(nextPosition.x).replace('.', ',')} /></label>
            <label>Z, м<input name="z" inputMode="decimal" defaultValue={String(nextPosition.z).replace('.', ',')} /></label>
          </div>}
          <button type="submit" disabled={project.components.length >= 220}>{viewMode === '3d' ? 'Взять для размещения' : 'Установить'}</button>
          {component && viewMode === '2d' && <button type="button" onClick={() => guideTitle.current?.focus()}>К соединениям</button>}
        </form>
        {room && <><h2>{room.name}</h2><RoomForm room={room} ctl={ctl} /><StartConditions room={room} project={project} ctl={ctl} /></>}
        {component && <><PortInspector project={project} component={component} pending={pending} onPick={(portId) => pickPort({ componentId: component.id, portId })} />
          <Inspector key={component.id + ':' + component.typeId} component={component} project={project} ctl={ctl} /></>}
        <RouteTools key={level} level={level} project={project} ctl={ctl} onOverlay={(next) => setOverlay({ ...next, revision: project.revision })} />
        <h2>Связи этажа</h2>
        {!links.length && <p>Нет связей</p>}
        {links.map(({ domain, link }) => <div key={domain + link.id} className="link-row">
          <span title={link.id}>{endpointLabel(link.from)} → {endpointLabel(link.to)}</span>
          <button aria-label={'Удалить связь ' + link.id} onClick={() => ctl.apply({ kind: 'disconnect', commandId: editorId('edit'), domain, linkId: link.id })}>Удалить</button>
        </div>)}
      </section>
    </div>
  </main>;
}
