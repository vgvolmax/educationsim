import { equipmentRegistry, trainingRegistry } from '../../project/registry';
import { portLabel } from '../../editor/portLabel';
import type { ProjectDocument } from '../../project/types';
import type { SessionView } from '../../simulation/session';
import type { CompiledSystem } from '../../simulation/types';
import { hasLiveFrame } from './heatMap';

const available = new Set(['manifolds', 'circulation', 'mixing']);
const specific = new Set(['check', 'bypass', 'relief-valve', 'safety-group', 'expansion-vessel', 'plate-exchanger', 'external-source']);
export function canOpenCutaway(typeId: string): boolean {
  const d = equipmentRegistry.get(typeId);
  return !!d && (available.has(d.family) || specific.has(d.variant));
}
export function componentCutaway(doc: ProjectDocument, system: CompiledSystem | null, componentId: string, view: SessionView | null) {
  const component = doc.components.find((c) => c.id === componentId);
  if (!component || !canOpenCutaway(component.typeId)) return null;
  const definition = equipmentRegistry.get(component.typeId)!;
  const current = system?.projectId === doc.projectId && system.projectRevision === doc.revision &&
    view?.snapshot.projectId === doc.projectId && view.snapshot.projectRevision === doc.revision && hasLiveFrame(view);
  const related = new Map(doc.hydronicLinks.filter((l) => l.from.componentId === componentId || l.to.componentId === componentId)
    .map((l) => [l.id, l]));
  const isExchanger = definition.variant === 'plate-exchanger' || definition.variant === 'external-source';
  const internal = system?.hydraulicChannels.filter((c) => c.origin.componentId === componentId) ?? [];
  const chosen = internal.length ? internal : system?.hydraulicChannels.filter((c) => c.origin.linkId && related.has(c.origin.linkId)) ?? [];
  const components = new Map(doc.components.map((item) => [item.id, item]));
  function portName(ownerId: string, portId: string) {
    const owner = components.get(ownerId);
    const port = owner && trainingRegistry.get(owner.typeId)?.ports.find(({ id }) => id === portId);
    return port ? portLabel(port) : portId === 'return' ? 'Обратка' :
      portId === 'supply' ? 'Подача' : portId === 'feed' ? 'Вход подачи' : 'Внутренний канал';
  }
  const paths = chosen.map((c) => {
    const channel = current ? view.snapshot.hydraulics?.channels[c.id] : undefined;
    const liquid = system?.hydraulicDomains.find((d) => d.id === c.domainId)?.fluid.kind ?? null;
    const link = c.origin.linkId ? related.get(c.origin.linkId) : undefined;
    const local = (value: string) => value.startsWith(componentId + ':') ? value.slice(componentId.length + 1) : value;
    return { id: c.id,
      from: portName(link?.from.componentId ?? componentId, link?.from.portId ?? local(c.from)),
      to: portName(link?.to.componentId ?? componentId, link?.to.portId ?? local(c.to)),
      lMin: channel ? channel.flowM3s * 60_000 : null, liquid,
      opening: current ? view.snapshot.valveOpenings[c.id] ?? null : null, status: channel?.valve?.status ?? channel?.state ?? null };
  });
  const domain = chosen[0]?.domainId;
  const pressure = current && domain ? view.snapshot.pressure[domain] : undefined;
  return { title: definition.titleRu, key: definition.variant, paths, separated: isExchanger,
    pressurePa: pressure?.gaugePa ?? null, releasedKg: pressure?.relief.dischargedKg ?? null };
}
