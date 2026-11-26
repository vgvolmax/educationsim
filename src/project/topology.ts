import type { ComponentRegistry } from './registry';
import type { Diagnostic, HydronicConnector, HydronicPort, PortEndpoint, ProjectDocument } from './types';

export type LinkCandidate = { domain: 'hydronic' | 'control'; from: PortEndpoint; to: PortEndpoint };
type Reason = 'missing_port' | 'same_port' | 'wrong_domain' | 'occupied_port' | 'wrong_medium' |
  'wrong_direction' | 'wrong_signal' | 'incompatible_connector' | 'needs_adapter';
export type RejectedConnection = {
  ok: false; reason: Reason; at: 'from' | 'to'; port: PortEndpoint; adapterTypeIds?: string[];
};
export type ConnectionDecision = { ok: true } | RejectedConnection;

const explanation: Record<Reason, string> = {
  missing_port: 'Порт отсутствует в модели компонента.',
  same_port: 'Нельзя соединить порт с самим собой.',
  wrong_domain: 'Гидравлический и сигнальный порты не соединяются напрямую.',
  occupied_port: 'К этому порту уже подключена допустимая связь.',
  wrong_medium: 'Порты относятся к разным средам.',
  wrong_direction: 'Сигнал должен идти с выхода на вход.',
  wrong_signal: 'Типы сигнала несовместимы.',
  incompatible_connector: 'Типы или размеры присоединения несовместимы.',
  needs_adapter: 'Для этих присоединений нужен переходник.',
};

function mates(a: HydronicConnector, b: HydronicConnector): boolean {
  if (a.family === 'tube' && b.family === 'tube') return a.diameterMm === b.diameterMm && a.mate !== b.mate;
  if (a.family === 'thread' && b.family === 'thread') return a.size === b.size && a.profile === b.profile && a.mate !== b.mate;
  return false;
}

function adapterIds(registry: ComponentRegistry, from: HydronicPort, to: HydronicPort): string[] {
  const result: string[] = [];
  for (const type of registry.values()) {
    if (type.category !== 'adapter') continue;
    const [a, b, ...rest] = type.ports;
    if (rest.length || a?.domain !== 'hydronic' || b?.domain !== 'hydronic' ||
      a.medium !== from.medium || b.medium !== to.medium) continue;
    if ((mates(from.connector, a.connector) && mates(to.connector, b.connector)) ||
      (mates(from.connector, b.connector) && mates(to.connector, a.connector))) result.push(type.id);
  }
  return result.sort();
}

// V1 IDs cannot contain the separator.
const key = (port: PortEndpoint): string => `${port.componentId}:${port.portId}`;
function index(project: ProjectDocument) {
  const components = new Map(project.components.map((component) => [component.id, component.typeId]));
  const hydraulic = new Map<string, number>();
  const writers = new Map<string, number>();
  function mark(map: Map<string, number>, endpoint: PortEndpoint): void {
    const id = key(endpoint);
    map.set(id, (map.get(id) ?? 0) + 1);
  }
  for (const link of project.hydronicLinks) { mark(hydraulic, link.from); mark(hydraulic, link.to); }
  for (const link of project.controlLinks) mark(writers, link.to);
  return { components, hydraulic, writers };
}

function assess(
  topology: ReturnType<typeof index>,
  link: LinkCandidate,
  registry: ComponentRegistry,
  alreadyPresent: boolean,
): ConnectionDecision {
  const fail = (reason: Reason, at: 'from' | 'to', adapterTypeIds?: string[]): RejectedConnection =>
    ({ ok: false, reason, at, port: link[at], ...(adapterTypeIds ? { adapterTypeIds } : {}) });
  if (key(link.from) === key(link.to)) return fail('same_port', 'to');
  function resolve(at: 'from' | 'to') {
    const typeId = topology.components.get(link[at].componentId);
    return typeId === undefined ? undefined : registry.get(typeId)?.ports.find(({ id }) => id === link[at].portId);
  }
  const from = resolve('from');
  const to = resolve('to');
  if (!from) return fail('missing_port', 'from');
  if (!to) return fail('missing_port', 'to');
  if (from.domain !== link.domain) return fail('wrong_domain', 'from');
  if (to.domain !== link.domain) return fail('wrong_domain', 'to');

  const max = alreadyPresent ? 1 : 0;
  if (from.domain === 'hydronic' && to.domain === 'hydronic') {
    if ((topology.hydraulic.get(key(link.from)) ?? 0) > max) return fail('occupied_port', 'from');
    if ((topology.hydraulic.get(key(link.to)) ?? 0) > max) return fail('occupied_port', 'to');
    if (from.medium !== to.medium) return fail('wrong_medium', 'to');
    // A drawn tube can bridge two sockets of its drawing size; other connectors mate directly.
    const a = from.connector;
    const b = to.connector;
    const compatibleSockets = a.family === 'tube' && b.family === 'tube' &&
      a.mate === 'socket' && b.mate === 'socket' && a.diameterMm === b.diameterMm;
    if (compatibleSockets || mates(a, b)) return { ok: true };
    const adapters = adapterIds(registry, from, to);
    return adapters.length ? fail('needs_adapter', 'to', adapters) : fail('incompatible_connector', 'to');
  }

  if (from.domain === 'control' && to.domain === 'control') {
    if (from.direction !== 'output') return fail('wrong_direction', 'from');
    if (to.direction !== 'input') return fail('wrong_direction', 'to');
    if (from.signal !== to.signal) return fail('wrong_signal', 'to');
    if ((topology.writers.get(key(link.to)) ?? 0) > max) return fail('occupied_port', 'to');
    return { ok: true };
  }
  return fail('wrong_domain', 'to');
}

export function checkConnection(project: ProjectDocument, candidate: LinkCandidate, registry: ComponentRegistry): ConnectionDecision {
  return assess(index(project), candidate, registry, false);
}

export function connectionDiagnostic(decision: RejectedConnection, path: string): Diagnostic {
  return { code: decision.reason, path: `${path}.${decision.at}.portId`, message: explanation[decision.reason],
    severity: 'error', componentId: decision.port.componentId, portId: decision.port.portId };
}

export function validateTopology(project: ProjectDocument, registry: ComponentRegistry): Diagnostic[] {
  const topology = index(project);
  const errors: Diagnostic[] = [];
  for (const [collection, domain] of [['hydronicLinks', 'hydronic'], ['controlLinks', 'control']] as const) {
    project[collection].forEach((link, i) => {
      const result = assess(topology, { domain, ...link }, registry, true);
      if (!result.ok) errors.push(connectionDiagnostic(result, `${collection}.${i}`));
    });
  }
  return errors;
}
