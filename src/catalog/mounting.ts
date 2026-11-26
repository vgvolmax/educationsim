import { teachingAnalogue } from './catalog';
import type { CatalogContext, CatalogOffer } from './catalog';
import type { CatalogParameterSnapshot, ComponentInstance, ProjectDocument, ReplaceComponentCommand } from '../project/types';
import { equipmentRegistry, trainingRegistry } from '../project/registry';
import { previewReplacement } from '../project/reducer';

export function analogueAvailability(o: CatalogOffer, context: CatalogContext) {
  const known = teachingAnalogue(o);
  if (!known) return { allowed: false as const, reason: 'Эта карточка справочная. Подтверждённого учебного аналога нет.' };
  if (!o.allowedContexts.includes(context)) return { allowed: false as const, reason: 'Не подходит для выбранного контекста.' };
  const profile = equipmentRegistry.get(known.typeId);
  return profile ? { allowed: true as const, profile } : { allowed: false as const, reason: 'Учебный профиль не найден.' };
}

export function catalogueSnapshot(o: CatalogOffer, releaseId: string, typeId: string, id: string, context: CatalogContext): CatalogParameterSnapshot {
  return { id, catalogReleaseId: releaseId, typeId, basis: 'training', productId: (o.channel + '-' + o.offerId).length <= 96 ? o.channel + '-' + o.offerId : id,
    sourceUrls: [o.url], parameters: {}, catalogCard: { key: o.channel + ':' + o.offerId,
      context, article: o.article, title: o.title } };
}

export function previewAnalogueReplacement(project: ProjectDocument, existing: ComponentInstance, snapshot: CatalogParameterSnapshot, commandId: string) {
  const command: ReplaceComponentCommand = { kind: 'replace_component', componentId: existing.id, typeId: snapshot.typeId,
    commandId, expectedRevision: project.revision, catalogSnapshot: snapshot };
  const result = previewReplacement(project, command, trainingRegistry);
  return result.ok ? { ok: true as const, command, retained: result.value.links.filter((l) => l.action === 'keep').length,
    lost: result.value.links.filter((l) => l.action === 'detach').map((l) => l.linkId) } : result;
}
