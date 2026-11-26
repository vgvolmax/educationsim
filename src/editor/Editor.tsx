import { useEffect, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { rectangleOf } from '../project/editor-geometry';
import { equipmentRegistry, trainingRegistry } from '../project/registry';
import type { PortEndpoint, ProjectDocument, Room } from '../project/types';
import { parseRussianDecimal } from '../project/units';
import { Inspector, StartConditions } from './Inspector';
import { PortInspector } from './PortInspector';
import { RouteTools } from './RouteTools';
import type { RouteOverlay } from './RouteTools';
import { Schematic } from '../views/schematic/Schematic';
import { editorId } from './useProject';
import type { ProjectController } from './useProject';
import './editor.css';

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

export function Editor({ ctl, project, onHome }: { ctl: ProjectController; project: ProjectDocument; onHome(): void }) {
  const [level, setLevel] = useState(project.viewPreferences.level);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<PortEndpoint | null>(null);
  const [overlay, setOverlay] = useState<RouteOverlay & { revision?: number }>({});
  const [typeId, setTypeId] = useState('training-heat-source');
  const [water, setWater] = useState(true), [control, setControl] = useState(true);
  const room = project.rooms.find((r) => r.id === selected);
  const component = project.components.find((c) => c.id === selected);
  const components = project.components.filter((c) => c.level === level);
  const rooms = project.rooms.filter((r) => r.level === level);
  const links = [...project.hydronicLinks.map((link) => ({ link, domain: 'hydronic' as const })),
    ...project.controlLinks.map((link) => ({ link, domain: 'control' as const }))]
    .filter(({ link }) => components.some((c) => c.id === link.from.componentId || c.id === link.to.componentId));

  useEffect(() => {
    document.querySelector<HTMLElement>('.editor h1')?.focus();
  }, []);

  function keyEdit(e: KeyboardEvent) {
    if (e.key === 'Escape') { setPending(null); return; }
    if (!(e.ctrlKey || e.metaKey) || e.altKey || (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
    const key = e.key.toLowerCase();
    if (key === 'z' || key === 'y') {
      e.preventDefault();
      setPending(null);
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
    const type = trainingRegistry.get(typeId);
    if (!type) return;
    const data = new FormData(e.currentTarget);
    const x = parseRussianDecimal(String(data.get('x'))), z = parseRussianDecimal(String(data.get('z')));
    if (x === null || z === null) { ctl.setError('Координаты монтажа должны быть числами.'); return; }
    const id = editorId('mount');
    if (ctl.apply({ kind: 'add_component', commandId: editorId('edit'),
      component: { id, typeId, position: { x, y: 3 * level, z }, level, roomId: null, catalogSnapshotId: null, parameters: { ...type.defaultParameters } },
    })) setSelected(id);
  }
  function pickPort(id: string) {
    if (!component) return;
    const next = { componentId: component.id, portId: id };
    if (!pending) { setPending(next); ctl.setError(null); return; }
    if (pending.componentId === next.componentId && pending.portId === next.portId) { setPending(null); return; }
    const start = project.components.find((c) => c.id === pending.componentId);
    const from = start && trainingRegistry.get(start.typeId)?.ports.find((p) => p.id === pending.portId);
    if (!start || !from) { setPending(null); ctl.setError('Исходный порт больше недоступен.'); return; }
    if (from.domain === 'hydronic' && start.level !== component.level && ![start, component].some((c) => equipmentRegistry.get(c.typeId)?.variant === 'riser')) {
      ctl.setError('Для межэтажной связи добавьте стояк.'); return;
    }
    const ends = { id: editorId('link'), from: pending, to: next };
    const commandId = editorId('edit');
    const done = from.domain === 'hydronic'
      ? ctl.apply({ kind: 'connect_hydronic', commandId, link: { ...ends, points: [], materialId: 'training-pipe',
        innerDiameterM: (from.connector.family === 'tube' ? from.connector.diameterMm : 16) * .00075 } })
      : ctl.apply({ kind: 'connect_control', commandId, link: ends });
    if (done) setPending(null);
  }
  return <main className="editor" onKeyDown={keyEdit}>
    <header className="work-header">
      <button onClick={onHome}>← Старт</button>
      <div><p className="eyebrow">Волмакс / конструктор</p><h1 tabIndex={-1}>{project.title}</h1></div>
      <span className="revision">Редакция {project.revision}</span>
    </header>
    <div className="work-toolbar" aria-label="Инструменты схемы">
      <label>Этаж <select value={level} onChange={(e) => { setLevel(Number(e.target.value)); setSelected(null); setOverlay({}); }}>
        {[0, 1, 2].map((n) => <option key={n} value={n}>{n + 1}</option>)}
      </select></label>
      <button onClick={addRoom} disabled={project.rooms.length >= 12}>Добавить комнату</button>
      <button disabled={!ctl.history?.past.length} onClick={() => { setPending(null); ctl.changeHistory('undo'); }}>Отменить</button>
      <button disabled={!ctl.history?.future.length} onClick={() => { setPending(null); ctl.changeHistory('redo'); }}>Повторить</button>
      <label><input type="checkbox" checked={water} onChange={(e) => setWater(e.target.checked)} /> Вода</label>
      <label><input type="checkbox" checked={control} onChange={(e) => setControl(e.target.checked)} /> Управление</label>
    </div>
    {ctl.error && <p className="editor-error" role="alert">{ctl.error}</p>}
    <div className="work-body">
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
      <Schematic project={project} level={level} selected={selected} onSelect={setSelected} water={water} control={control} overlay={overlay.revision === project.revision ? overlay : undefined} />
      <section className="work-panel" aria-label="Монтаж и свойства">
        {room && <><h2>{room.name}</h2><RoomForm room={room} ctl={ctl} /><StartConditions room={room} project={project} ctl={ctl} /></>}
        {component && <><PortInspector project={project} component={component} pending={pending} onPick={pickPort} />
          <Inspector key={component.id + ':' + component.typeId} component={component} project={project} ctl={ctl} /></>}
        {pending && <div className="pick-port"><p>Начало: {pending.portId}. Выберите второй порт.</p><button onClick={() => setPending(null)}>Отменить соединение</button></div>}
        <h2>Монтаж</h2>
        <form onSubmit={addComponent} className="room-fields">
          <label>Учебное оборудование<select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {[...equipmentRegistry.values()].map((d) => <option key={d.id} value={d.id}>{d.titleRu}</option>)}
          </select></label>
          <label>X, м<input name="x" inputMode="decimal" defaultValue="1" /></label>
          <label>Z, м<input name="z" inputMode="decimal" defaultValue="1" /></label>
          <button type="submit" disabled={project.components.length >= 220}>Установить</button>
        </form>
        <RouteTools key={level} level={level} project={project} ctl={ctl} onOverlay={(next) => setOverlay({ ...next, revision: project.revision })} />
        <h2>Связи этажа</h2>
        {!links.length && <p>Нет связей</p>}
        {links.map(({ domain, link }) => <div key={domain + link.id} className="link-row">
          <span title={link.id}>{link.from.portId} → {link.to.portId}</span>
          <button aria-label={'Удалить связь ' + link.id} onClick={() => ctl.apply({ kind: 'disconnect', commandId: editorId('edit'), domain, linkId: link.id })}>Удалить</button>
        </div>)}
      </section>
    </div>
  </main>;
}
