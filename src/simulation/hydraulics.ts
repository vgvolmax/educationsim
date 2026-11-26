import type { Diagnostic, Result } from '../project/types';
import { solveHeads } from './hydraulic-solver';
import type { FlowEdge } from './hydraulic-solver';
import { flowTolerance, makePump, pumpAtRest, pumpFlow, pumpOperatingPoint } from './pump';
import type { PumpInput, PumpLaw, PumpOperatingPoint } from './pump';
import { flowScale, makeResistance, passiveFlow, pipeResistance, pressureScale } from './resistance';
import type { ResistanceLaw, ResistanceProfile } from './resistance';
import { parseValve, scaleResistance, validMixingTopology, valveLaw } from './valves';
import type { MixingValveInput, ValveInput, ValveLaw, ValveProfile, ValveStatus } from './valves';
import type { ChannelOrigin, CompiledSystem, HydraulicChannel, HydraulicDomain, HydraulicNode } from './types';

export type HydraulicInputs = {
  resistance: Readonly<Record<string, ResistanceProfile>>;
  pumps?: Readonly<Record<string, PumpInput>>;
  resistanceMultipliers?: Readonly<Record<string, number>>;
  fixedDarcyFactors?: Readonly<Record<string, number>>;
  closedChannels?: readonly string[];
  valves?: Readonly<Record<string, ValveInput>>;
  mixingValves?: readonly MixingValveInput[];
  maxIterations?: number;
};
type ChannelState = {
  flowM3s: number;
  direction: 'forward' | 'reverse' | 'none';
  state: 'open' | 'closed' | 'inactive';
  potentialDropPa: number | null;
  resistance?: ResistanceProfile;
  origin: ChannelOrigin;
  pump?: PumpOperatingPoint;
  valve?: ValveStatus;
};
export type HydraulicSnapshot = {
  projectId: string;
  projectRevision: number;
  pressurePa: Record<string, number | null>;
  flowResidualM3s: Record<string, number>;
  channels: Record<string, ChannelState>;
};
type EdgeLaw = {
  channel: HydraulicChannel; resistance: ResistanceLaw;
  pump?: PumpLaw; off?: { blockReverse?: boolean }; valve?: ValveLaw;
};
const gravity = 9.80665;
const zeroResistance: ResistanceLaw = { linear: 0, quadratic: 0, profile: {} };
const issue = (code: string, path: string, message: string, severity: Diagnostic['severity'] = 'error'): Diagnostic =>
  ({ code, path, message, severity });
const failure = (error: Diagnostic): Result<HydraulicSnapshot> => ({ ok: false, diagnostics: [error] });

function channelLaw(channel: HydraulicChannel, domain: HydraulicDomain, inputs: HydraulicInputs,
  valve?: Exclude<ValveProfile, { mode: 'closed' }>,
): EdgeLaw | Diagnostic {
  const powered = channel.kind === 'pump' || channel.kind === 'source';
  const input = powered
    ? channel.enabled ? inputs.pumps?.[channel.id] : { mode: 'off' as const, blockReverse: inputs.pumps?.[channel.id]?.blockReverse }
    : undefined;
  if (powered && !input) return issue('missing_pump_curve', channel.id, 'У насоса нет заданной характеристики или режима.');
  const factor = inputs.fixedDarcyFactors?.[channel.id];
  const supplied = inputs.resistance[channel.id];
  const specified = supplied ?? (channel.kind === 'pipe' && factor !== undefined ? pipeResistance(channel, domain.fluid, factor) : null);
  const drive = input && input.mode !== 'off';
  let resistance = specified ? makeResistance(specified) : drive || valve?.mode === 'regulator' ? zeroResistance : null;
  const multiplier = (inputs.resistanceMultipliers?.[channel.id] ?? 1) * (valve?.mode === 'factor' ? valve.factor : 1);
  if (resistance && multiplier !== 1) resistance = scaleResistance(resistance, multiplier);
  if (!resistance) return issue('invalid_resistance', channel.id, 'Нужно положительное сопротивление или явно заданный профиль трубы.');
  if (!input || input.mode === 'off') {
    return { channel, resistance, ...(input && { off: input }), ...(valve && { valve: valveLaw(valve, resistance) }) };
  }
  const pump = makePump(input, resistance);
  return pump ? { channel, resistance, pump } : issue('invalid_pump_curve', channel.id, 'Характеристика насоса должна быть конечной и убывающей.');
}

function evaluateLaw(edge: EdgeLaw, delta: number): { q: number; dq: number } {
  if (edge.valve) return edge.valve.evaluate(delta);
  if (edge.pump) return pumpFlow(edge.pump, delta);
  if (edge.off?.blockReverse && delta < 0) return { q: 0, dq: 1e-8 };
  return passiveFlow(edge.resistance, delta);
}
type Island = { ids: string[]; edges: EdgeLaw[]; anchored: boolean };

function activeIslands(nodeIds: readonly string[], reference: string, edges: readonly EdgeLaw[]): Island[] {
  const adjacency = new Map<string, EdgeLaw[]>(nodeIds.map((id) => [id, []]));
  for (const edge of edges) { adjacency.get(edge.channel.from)?.push(edge); adjacency.get(edge.channel.to)?.push(edge); }
  const seen = new Set<string>(), result: Island[] = [];
  for (const root of [reference, ...nodeIds]) {
    if (seen.has(root)) continue;
    const ids = [root], group = new Set<EdgeLaw>();
    seen.add(root);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      for (const edge of adjacency.get(id) ?? []) {
        group.add(edge);
        const other = edge.channel.from === id ? edge.channel.to : edge.channel.from;
        if (!seen.has(other)) { seen.add(other); ids.push(other); }
      }
    }
    result.push({ ids, edges: [...group], anchored: root === reference });
  }
  return result;
}

function staticPressure(node: HydraulicNode, reference: HydraulicNode, domain: HydraulicDomain, head: number): number {
  return domain.pressureAtReferencePa + head * pressureScale -
    domain.fluid.densityKgM3 * gravity * (node.elevationM - reference.elevationM);
}

export function solveHydraulics(system: CompiledSystem, inputs: HydraulicInputs): Result<HydraulicSnapshot> {
  const nodeMap = new Map(system.nodes.map((n) => [n.id, n]));
  const channelMap = new Map(system.hydraulicChannels.map((c) => [c.id, c]));
  const closed = new Set(inputs.closedChannels ?? []);
  const diagnostics: Diagnostic[] = [];
  const maxIterations = inputs.maxIterations ?? 65;
  if (!Number.isInteger(maxIterations) || maxIterations < 0 || maxIterations > 100 ||
      [...closed].some((id) => !channelMap.has(id)) || Object.entries(inputs.resistanceMultipliers ?? {}).some(
        ([id, multiplier]) => !channelMap.has(id) || !Number.isFinite(multiplier) || multiplier <= 0)) return failure(issue('invalid_hydraulic_inputs', '', 'Некорректные параметры расчёта.'));
  const configuredValves = new Map(Object.entries(inputs.valves ?? {}));
  for (const mixing of inputs.mixingValves ?? []) {
    const first = channelMap.get(mixing.first), second = channelMap.get(mixing.second);
    if (!first || !second || !validMixingTopology(first, second) ||
        configuredValves.has(first.id) || configuredValves.has(second.id) ||
        !Number.isFinite(mixing.position) || mixing.position < 0 || mixing.position > 1) {
      return failure(issue('invalid_mixing_topology', mixing.first, 'Трёхходовой клапан должен назначать две разные ветви общего узла.'));
    }
    configuredValves.set(first.id, { kind: 'three-way', opening: mixing.position });
    configuredValves.set(second.id, { kind: 'three-way', opening: 1 - mixing.position });
  }
  const valves = new Map<string, ValveProfile>();
  for (const [id, valve] of configuredValves) {
    const channel = channelMap.get(id);
    if (!channel || channel.kind === 'pump' || channel.kind === 'source') {
      return failure(issue('invalid_valve_channel', id, 'Клапан должен быть добавлен в отдельную гидравлическую ветвь.'));
    }
    const profile = parseValve(valve);
    if (!profile) return failure(issue('invalid_valve_profile', id, 'Профиль клапана некорректен.'));
    valves.set(id, profile);
  }
  const snapshot: HydraulicSnapshot = {
    projectId: system.projectId, projectRevision: system.projectRevision, pressurePa: Object.create(null) as HydraulicSnapshot['pressurePa'],
    flowResidualM3s: Object.create(null) as HydraulicSnapshot['flowResidualM3s'],
    channels: Object.create(null) as HydraulicSnapshot['channels'],
  };
  const zero = (channel: HydraulicChannel, state: 'closed' | 'inactive'): void => {
    const valve = valves.get(channel.id);
    snapshot.channels[channel.id] = { flowM3s: 0, direction: 'none', state, origin: channel.origin, potentialDropPa: null,
      ...(valve && { valve: { kind: valve.kind, status: 'closed' } }) };
  };
  for (const domain of system.hydraulicDomains) {
    const reference = nodeMap.get(domain.referenceNodeId);
    const domainIds = new Set(domain.nodeIds);
    if (!reference || !domainIds.has(reference.id) || !Number.isFinite(domain.pressureAtReferencePa) ||
        !Number.isFinite(domain.fluid.densityKgM3) || domain.fluid.densityKgM3 <= 0) {
      return failure(issue('invalid_hydraulic_domain', domain.id, 'Не определён опорный узел давления.'));
    }
    const edges: EdgeLaw[] = [];
    for (const id of domain.channelIds) {
      const channel = channelMap.get(id);
      if (!channel || !domainIds.has(channel.from) || !domainIds.has(channel.to) || channel.from === channel.to) {
        return failure(issue('invalid_hydraulic_domain', id, 'Канал не соединяет узлы своего контура.'));
      }
      if (domain.flowConstraint === 'zero') { zero(channel, 'inactive'); continue; }
      const valve = valves.get(id);
      if (closed.has(id) || valve?.mode === 'closed') { zero(channel, 'closed'); continue; }
      const law = channelLaw(channel, domain, inputs, valve);
      if ('severity' in law) return failure(law);
      edges.push(law);
    }
    if (domain.flowConstraint === 'zero') {
      for (const id of domain.nodeIds) {
        const node = nodeMap.get(id);
        const pressure = node ? staticPressure(node, reference, domain, 0) : NaN;
        if (!Number.isFinite(pressure)) return failure(issue('invalid_pressure', id, 'Некорректное исходное давление.'));
        snapshot.pressurePa[id] = pressure; snapshot.flowResidualM3s[id] = 0;
      }
      continue;
    }

    for (const island of activeIslands(domain.nodeIds, reference.id, edges)) {
      const index = new Map(island.ids.map((id, i) => [id, i]));
      const normalized: FlowEdge[] = island.edges.map((edge) => ({
        from: index.get(edge.channel.from)!, to: index.get(edge.channel.to)!,
        atRestDelta: edge.pump ? -pumpAtRest(edge.pump) : 0,
        evaluate: (delta) => evaluateLaw(edge, delta),
      }));
      const solved = solveHeads(island.ids.length, normalized, maxIterations);
      if (!solved) return failure(issue('hydraulics_nonconvergent', domain.id, 'Расчёт расхода не сошёлся в пределах числа итераций.'));
      const states = island.edges.map((edge, i) => {
        const { from, to } = normalized[i]!;
        const potential = solved.heads[from]! - solved.heads[to]!;
        const q = solved.evaluation.samples[i]!.q;
        let valve = edge.valve?.status(potential);
        if (valve && ['check', 'bypass', 'regulator'].includes(valve.kind) && Math.abs(q) <= flowTolerance) {
          valve = { kind: valve.kind, status: 'blocked' };
        }
        const operating = edge.pump ? pumpOperatingPoint(edge.pump, potential, q) :
          edge.off ? { headPa: 0, status: edge.off.blockReverse && potential < 0 ? 'check-closed' : 'off' } as PumpOperatingPoint : undefined;
        return { edge, potential, q, valve, operating };
      });
      const conductive = states.filter(({ valve, operating }) =>
        valve?.status !== 'blocked' && (typeof operating !== 'object' || operating.status !== 'check-closed')).map(({ edge }) => edge);
      const partitions = activeIslands(island.ids, island.ids[0]!, conductive);
      const partitionByNode = new Map<string, Island>();
      for (const part of partitions) {
        for (const id of part.ids) partitionByNode.set(id, part);
        if (!island.anchored || !part.anchored) diagnostics.push(issue('unreferenced_island', part.ids[0]!,
          'Нет опоры для абсолютного уровня давления изолированной группы.', 'warning'));
      }
      for (const [i, id] of island.ids.entries()) {
        const node = nodeMap.get(id);
        if (!node) return failure(issue('invalid_hydraulic_domain', id, 'Отсутствует гидравлический узел.'));
        const pressure = island.anchored && partitionByNode.get(id)?.anchored ? staticPressure(node, reference, domain, solved.heads[i]!) : null;
        if (pressure !== null && !Number.isFinite(pressure)) return failure(issue('invalid_pressure', id, 'Давление вышло за численный диапазон.'));
        snapshot.pressurePa[id] = pressure;
        snapshot.flowResidualM3s[id] = solved.evaluation.residual[i]! / flowScale;
      }
      for (const { edge, potential, q, valve, operating } of states) {
        const samePressureGroup = partitionByNode.get(edge.channel.from) === partitionByNode.get(edge.channel.to);
        if (operating === 'curve_limit') return failure(issue('pump_curve_limit', edge.channel.id, 'Рабочая точка вышла за предел характеристики насоса.'));
        if (operating === 'unsupported_reverse') return failure(issue('pump_reverse_unmodeled', edge.channel.id, 'Обратный расход включённого насоса не описан его характеристикой.'));
        if (!Number.isFinite(q) || !Number.isFinite(potential * pressureScale) || (operating && !Number.isFinite(operating.headPa))) {
          return failure(issue('invalid_hydraulic_result', edge.channel.id, 'Расход или давление вышли за численный диапазон.'));
        }
        snapshot.channels[edge.channel.id] = {
          flowM3s: Math.abs(q) <= flowTolerance ? 0 : q / flowScale,
          direction: Math.abs(q) <= flowTolerance ? 'none' : q > 0 ? 'forward' : 'reverse',
          state: 'open', potentialDropPa: samePressureGroup ? potential * pressureScale : null, resistance: edge.resistance.profile,
          origin: edge.channel.origin, ...(operating && { pump: operating }),
          ...(valve && { valve }),
        };
      }
    }
  }
  return { ok: true, value: snapshot, diagnostics };
}
