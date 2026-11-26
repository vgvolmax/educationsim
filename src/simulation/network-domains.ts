import type { Diagnostic, ProjectDocument } from '../project/types';
import { resolveFluid } from './fluids';
import type { FluidProfile } from './fluids';
import { diagnostic, portKey } from './network-build';
import type { DraftChannel, NetworkDraft } from './network-build';
import type { HydraulicChannel, HydraulicDomain } from './types';

export function assignDomains(draft: NetworkDraft, project: ProjectDocument, diagnostics: Diagnostic[]): {
  hydraulicDomains: HydraulicDomain[]; hydraulicChannels: HydraulicChannel[];
} {
  const neighbors = new Map<string, DraftChannel[]>();
  for (const nodeId of draft.nodes.keys()) neighbors.set(nodeId, []);
  for (const channel of draft.channels) {
    neighbors.get(channel.from)?.push(channel);
    neighbors.get(channel.to)?.push(channel);
  }

  const groups = new Map<string, { nodes: string[]; channels: Set<DraftChannel> }>();
  const groupByNode = new Map<string, string>();
  for (const id of [...draft.nodes.keys()].sort()) {
    if (groupByNode.has(id)) continue;
    const key = `domain:${id}`;
    const nodes: string[] = [id];
    const channels = new Set<DraftChannel>();
    groupByNode.set(id, key);
    for (let i = 0; i < nodes.length; i++) {
      const here = nodes[i]!;
      for (const channel of neighbors.get(here) ?? []) {
        channels.add(channel);
        const next = channel.from === here ? channel.to : channel.from;
        if (!groupByNode.has(next)) { groupByNode.set(next, key); nodes.push(next); }
      }
    }
    groups.set(key, { nodes: nodes.sort(), channels });
  }

  const fluids = new Map<string, FluidProfile>();
  const defaultFluid = resolveFluid(project.environment.fluid, project.environment.glycolMassFraction);
  if (!defaultFluid) diagnostics.push(diagnostic('unsupported_fluid', 'environment.fluid', 'Нет расчётного профиля для выбранного теплоносителя.'));
  for (const rule of draft.fluids) {
    const group = groupByNode.get(rule.nodeId);
    if (!group) continue;
    const profile = resolveFluid(rule.kind, rule.concentration);
    if (!profile) {
      diagnostics.push(diagnostic('unsupported_fluid', 'components.parameters', 'Нет расчётного профиля для теплоносителя этого контура.',
        { componentId: rule.componentId }));
      continue;
    }
    const known = fluids.get(group);
    if (known && known.id !== profile.id) {
      diagnostics.push(diagnostic('conflicting_fluids', 'components.parameters', 'Разные теплоносители соединены в один гидравлический контур.',
        { componentId: rule.componentId }));
    } else fluids.set(group, profile);
  }

  const hydraulicDomains: HydraulicDomain[] = [];
  const domainByChannel = new Map<string, string>();
  const inactiveGroups = new Set<string>();
  for (const [id, group] of groups) {
    const activity = !group.nodes.some((node) => draft.activeNodes.has(node))
      ? 'inactive'
      : [...group.channels].some((c) => c.enabled && (c.kind === 'source' || c.kind === 'pump')) ? 'driven' : 'passive';
    const fluid = fluids.get(id) ?? defaultFluid;
    if (!fluid) continue;
    const referenceNodeId = group.nodes.find((node) => draft.pressureCandidates.has(node)) ?? group.nodes[0]!;
    for (const channel of group.channels) domainByChannel.set(channel.id, id);
    hydraulicDomains.push({
      id, nodeIds: group.nodes, channelIds: [...group.channels].map((c) => c.id).sort(), activity, fluid,
      flowConstraint: activity === 'inactive' ? 'zero' : 'solve',
      referenceNodeId, pressureAtReferencePa: project.initialConditions.gaugePressurePa,
    });
    if (activity === 'inactive') inactiveGroups.add(id);
    if (activity === 'inactive') diagnostics.push(diagnostic('disabled_domain', id,
      'Изолированное отключённое оборудование остаётся на схеме с нулевым расходом.', { severity: 'warning' }));
    if (activity === 'passive') diagnostics.push(diagnostic('passive_domain', id,
      'В контуре нет включённого насоса. Принудительный расход не задан.', { severity: 'warning' }));
  }

  for (const { path, endpoint, nodeId } of draft.requiredPorts) {
    if (draft.usedPorts.has(portKey(endpoint)) || inactiveGroups.has(groupByNode.get(nodeId) ?? '')) continue;
    diagnostics.push(diagnostic('open_operating_port', path, 'Рабочий гидравлический порт не закрыт.',
      { componentId: endpoint.componentId, portId: endpoint.portId }));
  }
  for (const link of draft.thermalLinks) {
    if (link.kind === 'heat-exchanger' && domainByChannel.get(link.primaryChannelId) === domainByChannel.get(link.secondaryChannelId)) {
      diagnostics.push(diagnostic('exchanger_bypassed', 'hydronicLinks',
        'Стороны теплообменника гидравлически соединены; требуется два независимых контура.', { componentId: link.componentId }));
    }
  }
  return {
    hydraulicDomains,
    hydraulicChannels: draft.channels.flatMap((channel) => {
      const domainId = domainByChannel.get(channel.id);
      return domainId ? [{ ...channel, domainId }] : [];
    }),
  };
}
