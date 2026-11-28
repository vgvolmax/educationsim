import type { CatalogContext, CatalogOffer } from './catalog';
import { analogueAvailability, catalogueSnapshot, previewAnalogueReplacement } from './mounting';
import { editorId } from '../editor/useProject';
import type { ProjectController } from '../editor/useProject';
import type { ComponentInstance, ProjectDocument, ReplaceComponentCommand } from '../project/types';
import type { Placement } from '../editor/placement';
import { useState } from 'react';

type Props = { offer: CatalogOffer; context: CatalogContext; project: ProjectDocument; selected: ComponentInstance | undefined;
  releaseId: string; ctl: ProjectController; onPlaced(id: string): void; onPlace(placement: Placement): void };
export function CompatibilityPreview({ offer, context, project, selected, releaseId, ctl, onPlaced, onPlace }: Props) {
  const result = analogueAvailability(offer, context);
  const [pending, setPending] = useState<{ command: ReplaceComponentCommand; retained: number; lost: string[] }>();
  if (!result.allowed) return <p className="catalog-assistance">{result.reason} В проекте можно выбрать деталь из палитры «Детали».</p>;
  return <section className="catalog-fit" aria-label="Учебное применение">
    <div className="catalog-actions">
      <button className="action-primary" type="button" onClick={() => {
        const typeId = result.profile.id;
        const snapshot = catalogueSnapshot(offer, releaseId, typeId, editorId('snapshot'), context);
        onPlace({ typeId, snapshot, quarterTurns: 0 });
      }}>Разместить на сцене</button>
      {selected && <button onClick={() => {
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
