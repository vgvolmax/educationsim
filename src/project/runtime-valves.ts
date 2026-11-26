import { equipmentRegistry } from './registry';
import type { ProjectDocument } from './types';
import type { CompiledSystem } from '../simulation/types';
import type { ValveInput } from '../simulation/valves';

export function trainingValveLaws(doc: ProjectDocument, system: CompiledSystem): Record<string, ValveInput> {
  const result: Record<string, ValveInput> = {};
  const components = new Map(system.components.map((c) => [c.id, c]));
  const links = new Map(doc.hydronicLinks.map((l) => [l.id, l]));
  for (const channel of system.hydraulicChannels) {
    const link = channel.origin.linkId && links.get(channel.origin.linkId);
    if (link && link.from.componentId === link.to.componentId &&
        equipmentRegistry.get(components.get(link.from.componentId)?.typeId ?? '')?.variant === 'pair-flowmeters' &&
        /^supply-\d+$/.test(link.from.portId) && link.from.portId.slice(7) === link.to.portId.replace(/^return-/, '')) {
      result[channel.id] = { kind: 'balance', opening: 1 };
      continue;
    }
    const component = channel.origin.componentId ? components.get(channel.origin.componentId) : undefined;
    const profile = component ? equipmentRegistry.get(component.typeId) : undefined;
    if (!profile || channel.kind !== 'passive') continue;
    const params = component?.parameters;
    const position = typeof params?.position === 'number' ? params.position : 1;
    if (profile.family === 'balancing') result[channel.id] = { kind: 'balance', opening: position };
    if (profile.family === 'isolation') result[channel.id] = { kind: 'shutoff', opening: position };
    if (profile.variant === 'check') result[channel.id] = { kind: 'check', crackingPa: typeof params?.thresholdPa === 'number' ? params.thresholdPa : 100 };
    if (profile.variant === 'bypass') result[channel.id] = { kind: 'bypass', opensPa: typeof params?.thresholdPa === 'number' ? params.thresholdPa : 15000 };
    if (profile.family === 'filtration') result[channel.id] = { kind: 'filter',
      loading: typeof params?.contamination === 'number' ? params.contamination : 0, maxLossMultiplier: 4 };
  }
  return result;
}
