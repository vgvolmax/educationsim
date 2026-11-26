import { useState } from 'react';
import type { FormEvent } from 'react';
import { equipmentRegistry, trainingRegistry } from '../project/registry';
import { previewReplacement } from '../project/reducer';
import { pipeReplacement } from '../project/pipe-edits';
import { parseRussianDecimal } from '../project/units';
import type { ComponentInstance, ProjectDocument, ReplaceComponentCommand, Room } from '../project/types';
import { presentNumber, PropertyInput, readProperty, temperatureLabel } from './PropertyInput';
import { editorId } from './useProject';
import type { ProjectController } from './useProject';

export function StartConditions({ room, project, ctl }: { room: Room; project: ProjectDocument; ctl: ProjectController }) {
  const startC = project.initialConditions.airCByRoomId[room.id];
  return <details className="editor-section" open>
    <summary>Условия следующего прогона</summary>
    <p>Текущая температура: нет расчётного снимка.</p>
    <form className="room-fields" key={room.id + ':' + startC + ':' + room.airSetpointC + ':' + room.surfaceLimitC} onSubmit={(e) => {
      e.preventDefault();
      const data = new FormData(e.currentTarget);
      const [startC, targetC, limitC] = ['startC', 'targetC', 'limitC'].map((name) => parseRussianDecimal(String(data.get(name))));
      if (startC == null || targetC == null || limitC == null) { ctl.setError('Укажите три корректных температуры.'); return; }
      ctl.apply({ kind: 'set_room_start', commandId: editorId('conditions'), roomId: room.id, startC, targetC, limitC });
    }}>
      <label>{temperatureLabel('Начальная температура воздуха')}<input name="startC" inputMode="decimal" defaultValue={startC === undefined ? '' : presentNumber(startC)} /></label>
      <label>{temperatureLabel('Уставка воздуха')}<input name="targetC" inputMode="decimal" defaultValue={presentNumber(room.airSetpointC)} /></label>
      <label>{temperatureLabel('Лимит поверхности пола')}<input name="limitC" inputMode="decimal" defaultValue={presentNumber(room.surfaceLimitC)} /></label>
      <button type="submit">Сохранить начальные условия</button>
    </form>
  </details>;
}
type Pending = { command: ReplaceComponentCommand; changes: { name: string; detach: boolean }[]; routes: string[] };
export function Inspector({ component, project, ctl }: { component: ComponentInstance; project: ProjectDocument; ctl: ProjectController }) {
  const definition = equipmentRegistry.get(component.typeId);
  const snapshot = project.appliedCatalogSnapshots.find(({ id }) => id === component.catalogSnapshotId);
  const editable = !snapshot || snapshot.basis === 'training';
  const [replacement, setReplacement] = useState('');
  const [preview, setPreview] = useState<Pending | null>(null);
  const options = [...equipmentRegistry.values()].filter((d) => d.id !== component.typeId);
  const topology = definition?.component.hydraulics;
  function replacementCommand(typeId: string): ReplaceComponentCommand {
    return { kind: 'replace_component', commandId: editorId('replace'), componentId: component.id, expectedRevision: project.revision, typeId };
  }
  function previewChange() {
    if (!replacement) return;
    const command = replacementCommand(replacement);
    const res = previewReplacement(project, command, trainingRegistry);
    if (!res.ok) { ctl.setError(res.diagnostics[0].message); return; }
    const changes = res.value.links.map(({ domain, linkId, action }) => {
      const link = (domain === 'hydronic' ? project.hydronicLinks : project.controlLinks).find((l) => l.id === linkId);
      const endpoint = link?.from.componentId === component.id ? link.from : link?.to;
      return { name: endpoint?.portId ?? linkId, detach: action === 'detach' };
    });
    setPreview({ command, changes, routes: res.value.removedLoopRoutes });
    ctl.setError(null);
  }
  function parameters(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!definition) return;
    const data = new FormData(e.currentTarget), values: Record<string, string | number | boolean> = {};
    for (const [name, setting] of Object.entries(definition.settings)) {
      const next = readProperty(data, name, setting);
      if (next === null) { ctl.setError('Некорректное значение: ' + setting.titleRu + '.'); return; }
      if (next !== (component.parameters[name] ?? setting.initial)) values[name] = next;
    }
    if (Object.keys(values).length) ctl.apply({ kind: 'set_component_parameters', commandId: editorId('settings'), componentId: component.id, values });
    else ctl.setError(null);
  }
  const terminal = topology?.channels.length === 0 && Object.keys(topology.portNodes).length === 1 && component.typeId !== 'training-cap';
  const canSplice = topology?.channels.length === 1 && topology.channels[0]?.kind === 'passive' && Object.keys(topology.portNodes).length === 2;
  return <div className="inspector">
    <details className="editor-section" open>
      <summary>Параметры оборудования</summary>
      <p>{!editable ? 'Паспортный снимок. Редактирование учебных полей недоступно.' : 'Учебный экземпляр, не паспорт изделия.'}</p>
      {snapshot?.basis === 'training' && <p>Учебный аналог из каталога · {snapshot.catalogReleaseId}. {snapshot.catalogCard?.article}</p>}
      {definition && <p>{definition.installation}</p>}
      {definition && editable && <form className="room-fields" key={JSON.stringify(component.parameters)} onSubmit={parameters}>
        {Object.entries(definition.settings).map(([name, setting]) => <PropertyInput key={name} name={name} setting={setting} value={component.parameters[name]} />)}
        <button type="submit">Применить параметры</button>
      </form>}
    </details>
    <details className="editor-section" open>
      <summary>Монтажные действия</summary>
      <label className="replacement">Заменить на<select value={replacement} onChange={(e) => { setReplacement(e.target.value); setPreview(null); }}>
        <option value="">Выберите учебный тип</option>{options.map((opt) => <option value={opt.id} key={opt.id}>{opt.titleRu}</option>)}</select>
      </label>
      <button onClick={previewChange} disabled={!replacement}>Предпросмотр замены</button>
      {preview && <div className="replacement-summary" aria-label="Последствия замены">
        {preview.changes.length ? <ul>{preview.changes.map(({ name, detach }, i) => <li key={i}>{name}: {detach ? 'отсоединить' : 'сохранить'}</li>)}</ul> : <p>Подключений нет.</p>}
        {preview.routes.length > 0 && <p>Будут сняты петли: {preview.routes.join(', ')}.</p>}
        <button onClick={() => { if (ctl.apply(preview.command)) setPreview(null); }}>Подтвердить замену</button>
        <button onClick={() => setPreview(null)}>Оставить текущий узел</button>
      </div>}
      <button onClick={() => ctl.apply({ kind: 'remove_component', commandId: editorId('remove'), componentId: component.id })}>Удалить узел</button>
      {canSplice && <button onClick={() => {
        const splice = pipeReplacement(project, trainingRegistry, component.id, editorId('pipe'));
        if (!splice.ok) { ctl.setError(splice.diagnostics[0].message); return; }
        ctl.apply({ kind: 'batch', commandId: editorId('bypass'), edits: splice.value });
      }}>Заменить участком трубы</button>}
      {terminal && <button onClick={() => {
        const cap = replacementCommand('training-cap');
        const check = previewReplacement(project, cap, trainingRegistry);
        if (!check.ok || check.value.links.length !== 1 || check.value.links[0]?.action !== 'keep' || check.value.links[0]?.domain !== 'hydronic') {
          ctl.setError('Нужна одна совместимая водяная связь для установки заглушки.'); return;
        }
        ctl.apply(cap);
      }}>Снять и поставить заглушку</button>}
    </details>
  </div>;
}
