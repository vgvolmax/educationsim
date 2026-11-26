import { measureRoute } from '../project/routing';
import type { ComponentRegistry } from '../project/registry';
import type { Diagnostic, PortEndpoint, ProjectDocument } from '../project/types';
import type { CompiledComponent, HydraulicChannel, HydraulicNode, PipeChannel, ThermalLink } from './types';

export type DraftChannel = Omit<PipeChannel, 'domainId'> | Omit<Exclude<HydraulicChannel, PipeChannel>, 'domainId'>;
export type FluidSelection = { nodeId: string; kind: unknown; concentration: unknown; componentId: string };
type RequiredPort = { nodeId: string; endpoint: PortEndpoint; path: string };

export type NetworkDraft = {
  components: CompiledComponent[];
  nodes: Map<string, HydraulicNode>;
  channels: DraftChannel[];
  thermalLinks: ThermalLink[];
  activeNodes: Set<string>;
  pressureCandidates: Set<string>;
  requiredPorts: RequiredPort[];
  usedPorts: Set<string>;
  fluids: FluidSelection[];
};

export const portKey = ({ componentId, portId }: PortEndpoint): string => `${componentId}:${portId}`;
export const diagnostic = (code: string, path: string, message: string, extras?: Partial<Diagnostic>): Diagnostic =>
  ({ code, path, message, severity: 'error', ...extras });

export function buildNetwork(project: ProjectDocument, registry: ComponentRegistry, diagnostics: Diagnostic[]): NetworkDraft {
  const draft: NetworkDraft = {
    components: [], nodes: new Map(), channels: [], thermalLinks: [], activeNodes: new Set(),
    pressureCandidates: new Set(), requiredPorts: [], usedPorts: new Set(), fluids: [],
  };
  const junctionByPort = new Map<string, string>();
  const snapshots = new Map(project.appliedCatalogSnapshots.map((snapshot) => [snapshot.id, snapshot]));
  const positioned = new Map(project.components.map((component) => [component.id, component.position]));

  for (const [i, component] of project.components.entries()) {
    const type = registry.get(component.typeId);
    const path = `components.${i}`;
    const context = { componentId: component.id };
    if (!type) {
      diagnostics.push(diagnostic('missing_component_model', `${path}.typeId`, 'Для компонента не найдена модель.', context));
      continue;
    }
    const snapshot = component.catalogSnapshotId ? snapshots.get(component.catalogSnapshotId) : undefined;
    if (component.catalogSnapshotId && snapshot?.typeId !== type.id) {
      diagnostics.push(diagnostic('catalog_model_mismatch', `${path}.catalogSnapshotId`, 'Паспортный снимок не соответствует модели компонента.', context));
      continue;
    }
    const params = { ...type.defaultParameters, ...snapshot?.parameters, ...component.parameters };
    if (params.enabled !== undefined && typeof params.enabled !== 'boolean') {
      diagnostics.push(diagnostic('invalid_component_state', `${path}.parameters.enabled`, 'Состояние «включён» должно быть логическим.', context));
      continue;
    }
    const enabled = params.enabled !== false;
    draft.components.push({ id: component.id, typeId: type.id, catalogSnapshotId: component.catalogSnapshotId,
      roomId: component.roomId, enabled, parameters: params });
    const ports = type.ports.filter(({ domain }) => domain === 'hydronic');
    const model = type.hydraulics;
    const invalid = () => diagnostics.push(diagnostic('invalid_internal_model', path, 'Внутренняя расчётная схема компонента неполная.', context));
    if (!model) {
      if (ports.length) invalid();
      continue;
    }

    const localNodes = new Map<string, HydraulicNode>();
    const localChannels = new Set<string>();
    function node(name: string): HydraulicNode {
      let found = localNodes.get(name);
      if (!found) {
        const id = `${component.id}:${name}`;
        found = { id, componentId: component.id, elevationM: component.position.y, ports: [] };
        localNodes.set(name, found);
        draft.nodes.set(id, found);
        if (enabled) draft.activeNodes.add(id);
      }
      return found;
    }

    for (const port of ports) {
      const name = model.portNodes[port.id];
      if (!name) { invalid(); continue; }
      const junction = node(name);
      const endpoint = { componentId: component.id, portId: port.id };
      junction.ports.push(endpoint);
      junctionByPort.set(portKey(endpoint), junction.id);
      draft.requiredPorts.push({ endpoint, nodeId: junction.id, path });
    }
    for (const channel of model.channels) {
      if (!channel.from || !channel.to || channel.from === channel.to || localChannels.has(channel.id)) {
        invalid(); continue;
      }
      localChannels.add(channel.id);
      draft.channels.push({
        id: `component:${component.id}:${channel.id}`, from: node(channel.from).id, to: node(channel.to).id,
        kind: channel.kind, enabled, origin: { componentId: component.id },
      });
    }
    if (model.pressureReference) {
      const reference = localNodes.get(model.pressureReference);
      if (reference) draft.pressureCandidates.add(reference.id);
      else invalid();
    }

    for (const rule of model.fluids ?? []) {
      const target = localNodes.get(rule.node);
      if (!target) { invalid(); continue; }
      if (rule.selection === 'project-default') {
        draft.fluids.push({ nodeId: target.id, kind: project.environment.fluid,
          concentration: project.environment.glycolMassFraction, componentId: component.id });
      } else {
        const kind = params[rule.selection.kindParameter];
        const concentration = params[rule.selection.concentrationParameter];
        // No override means the documented default project profile for this isolated side.
        if (kind === undefined && concentration === undefined) {
          draft.fluids.push({ nodeId: target.id, kind: project.environment.fluid,
            concentration: project.environment.glycolMassFraction, componentId: component.id });
        } else {
          draft.fluids.push({ nodeId: target.id, kind, concentration, componentId: component.id });
        }
      }
    }
    if (model.heatExchange) {
      const { primary, secondary, uaParameter } = model.heatExchange;
      const ua = params[uaParameter];
      if (primary === secondary || !localChannels.has(primary) || !localChannels.has(secondary) ||
          typeof ua !== 'number' || !Number.isFinite(ua) || ua <= 0) invalid();
      else draft.thermalLinks.push({ kind: 'heat-exchanger', componentId: component.id,
        primaryChannelId: `component:${component.id}:${primary}`, secondaryChannelId: `component:${component.id}:${secondary}`, uaWPerK: ua });
    }
  }

  const loopRoutes = new Map<string, ProjectDocument['loopRoutes'][number]>();
  for (const [i, route] of project.loopRoutes.entries()) {
    if (loopRoutes.has(route.linkId)) diagnostics.push(diagnostic('ambiguous_loop_route', `loopRoutes.${i}.linkId`, 'У ветви должно быть не более одной трассы петли.'));
    else loopRoutes.set(route.linkId, route);
  }
  for (const [i, link] of project.hydronicLinks.entries()) {
    const path = `hydronicLinks.${i}`;
    const a = portKey(link.from), b = portKey(link.to);
    const from = junctionByPort.get(a), to = junctionByPort.get(b);
    if (!from || !to) continue;
    if (from === to) { diagnostics.push(diagnostic('shorted_junction', path, 'Труба замыкает один внутренний узел сама на себя.')); continue; }
    draft.usedPorts.add(a);
    draft.usedPorts.add(b);

    const loop = loopRoutes.get(link.id);
    const routePoints = loop?.points ?? link.points;
    let lengthM = measureRoute(routePoints);
    let lengthSource: PipeChannel['lengthSource'] = loop ? 'loop-route' : 'link-route';
    if (!routePoints.length) {
      const start = positioned.get(link.from.componentId), end = positioned.get(link.to.componentId);
      lengthM = start && end ? measureRoute([start, end]) : 0;
      lengthSource = 'component-position';
      if (lengthM > 0) diagnostics.push(diagnostic('estimated_link_length', path,
        'Длина прямой подводки оценена по позициям компонентов; уточните трассу.', { severity: 'warning' }));
    }
    if (!Number.isFinite(lengthM) || lengthM <= 0 || routePoints.length === 1) {
      diagnostics.push(diagnostic('missing_pipe_length', `${path}.points`, 'Не определена положительная длина трубы.'));
      continue;
    }
    const id = `link:${link.id}`;
    draft.channels.push({ id, from, to, kind: 'pipe', enabled: true, lengthM, lengthSource,
      diameterM: link.innerDiameterM, localLossCoefficient: link.localLossCoefficient ?? 0,
      origin: { linkId: link.id, ...(loop && { loopRouteId: loop.id, roomId: loop.roomId }) } });
    if (loop) draft.thermalLinks.push({ kind: 'floor-loop', channelId: id, roomId: loop.roomId, loopRouteId: loop.id });
  }
  return draft;
}
