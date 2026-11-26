import type { CatalogContext, CatalogOffer } from './catalog';
import { analogueAvailability, catalogueSnapshot, previewAnalogueReplacement } from './mounting';
import { editorId } from '../editor/useProject';
import type { ProjectController } from '../editor/useProject';
import type { ComponentInstance, ProjectDocument, ReplaceComponentCommand } from '../project/types';
import { useState } from 'react';

type Props = { offer: CatalogOffer; context: CatalogContext; project: ProjectDocument; selected: ComponentInstance | undefined;
  releaseId: string; level: number; ctl: ProjectController; onPlaced(id: string): void };
export function CompatibilityPreview({ offer, context, project, selected, releaseId, level, ctl, onPlaced }: Props) {
  const result = analogueAvailability(offer, context);
  const [pending, setPending] = useState<{ command: ReplaceComponentCommand; retained: number; lost: string[] }>();
  if (!result.allowed && !offer.analogue) return <p>{result.reason}</p>;
  return <section className="catalog-fit" aria-label="Учебное применение">
    <h4>Учебное применение</h4>
    <p>{result.allowed ? 'Отдельная учебная модель: ' + result.profile.titleRu + '. Она не подтверждает присоединения и параметры SKU.' : result.reason}</p>
    <div className="catalog-actions">
      <button disabled={!result.allowed} onClick={() => {
        if (!result.allowed) return;
        const type = result.profile.component, id = editorId('catalog');
        const snapshot = catalogueSnapshot(offer, releaseId, type.id, editorId('snapshot'), context);
        const room = project.rooms.find((room) => room.level === level);
        const anchor = room?.outline[0];
        const component: ComponentInstance = { id, typeId: type.id, level, roomId: null,
          position: { x: (anchor?.x ?? 0) + .7, y: level * 3, z: (anchor?.z ?? 0) + .9 },
          catalogSnapshotId: snapshot.id, parameters: { ...type.defaultParameters } };
        if (ctl.apply({ kind: 'add_component', commandId: editorId('install'), component, catalogSnapshot: snapshot })) onPlaced(id);
      }}>Установить учебный аналог</button>
      {selected && <button disabled={!result.allowed} onClick={() => {
        if (!result.allowed) return;
        const snapshot = catalogueSnapshot(offer, releaseId, result.profile.id, editorId('snapshot'), context);
        const proposal = previewAnalogueReplacement(project, selected, snapshot, editorId('replace'));
        if (!proposal.ok) { ctl.setError(proposal.diagnostics[0].message); return; }
        setPending(proposal);
      }}>Предпросмотр замены из каталога</button>}
    </div>
    {pending && <div className="replacement-summary">
      <p>Связей сохранится: {pending.retained}. Отсоединится: {pending.lost.length}.</p>
      {!!pending.lost.length && <p>{pending.lost.join(', ')}. Укладки отсоединённых связей тоже будут сняты.</p>}
      {pending.command.expectedRevision !== project.revision && <p>Схема изменилась. Пересчитайте предпросмотр.</p>}
      <button disabled={pending.command.expectedRevision !== project.revision} onClick={() => {
        if (ctl.apply(pending.command)) { onPlaced(pending.command.componentId); setPending(undefined); }
      }}>Применить учебную замену</button>
      <button onClick={() => setPending(undefined)}>Отменить замену</button>
    </div>}
  </section>;
}
