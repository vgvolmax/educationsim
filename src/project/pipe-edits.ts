import type { ComponentRegistry } from './registry';
import type { HydronicLink, ProjectDocument, ProjectEdit, Result } from './types';

const fail = (message: string): Result<ProjectEdit[]> =>
  ({ ok: false, diagnostics: [{ code: 'pipe_replacement_unavailable', message, path: 'hydronicLinks', severity: 'error' }] });

export function pipeReplacement(project: ProjectDocument, registry: ComponentRegistry, componentId: string, id: string): Result<ProjectEdit[]> {
  const component = project.components.find((c) => c.id === componentId);
  const type = component && registry.get(component.typeId);
  if (!type?.hydraulics || type.hydraulics.channels.length !== 1 || type.hydraulics.channels[0]?.kind !== 'passive' ||
      type.ports.filter((p) => p.domain === 'hydronic').length !== 2) return fail('Участком трубы можно заменить только проходной узел с двумя портами.');
  const attached = project.hydronicLinks.filter((link) => [link.from.componentId, link.to.componentId].includes(componentId));
  const incoming = attached.find((link) => link.to.componentId === componentId);
  const outgoing = attached.find((link) => link.from.componentId === componentId);
  if (attached.length !== 2 || !incoming || !outgoing || incoming === outgoing ||
      project.controlLinks.some((l) => [l.from.componentId, l.to.componentId].includes(componentId)) ||
      project.loopRoutes.some((r) => attached.some((l) => r.linkId === l.id))) {
    return fail('Необходимы две направленные связи без закреплённой петли или управляющей линии.');
  }
  const points = [...incoming.points, ...outgoing.points];
  if (points.length) return fail('Связи имеют собственную геометрию. Снимите трассировку перед заменой участком трубы.');
  const link: HydronicLink = { id, from: incoming.from, to: outgoing.to, points: [],
    materialId: incoming.materialId, innerDiameterM: Math.min(incoming.innerDiameterM, outgoing.innerDiameterM) };
  return { ok: true, diagnostics: [], value: [
    { kind: 'remove_component', commandId: id + '-remove', componentId },
    { kind: 'connect_hydronic', commandId: id + '-connect', link },
  ] };
}
