import type { Diagnostic, Result } from '../project/types';
import { finiteTemperature } from './mixing';

type Measurement = 'air' | 'floor' | 'return' | 'supply';
type BooleanSignal = 'demand' | 'permit';
type Signal = Measurement | BooleanSignal;
export type ControlDevice = { id: string } & (
  | { kind: 'sensor'; measurement: Measurement; sampleId: string; maxAgeTicks: number }
  | { kind: 'thermostat'; targetC: number; hysteresisC: number }
  | { kind: 'surface-limit' | 'rtl' | 'high-limit'; limitC: number; hysteresisC: number; latching: boolean }
  | { kind: 'and' | 'or'; signal: BooleanSignal; inputs: number }
  | { kind: 'delay'; signal: BooleanSignal; initial: boolean }
  | { kind: 'actuator'; normally: 'NC' | 'NO'; travelSeconds: number; wantsLimiter: boolean }
);
export type ControlWire = { id: string; from: string; to: string; port: string };
export type ControlGraph = {
  ordered: readonly ControlDevice[];
  wiresByTarget: ReadonlyMap<string, ReadonlyMap<string, string>>;
  protectedActuators: ReadonlySet<string>;
};

function output(device: ControlDevice): Signal | undefined {
  switch (device.kind) {
    case 'sensor': return device.measurement;
    case 'thermostat': return 'demand';
    case 'surface-limit': case 'rtl': case 'high-limit': return 'permit';
    case 'delay': case 'and': case 'or': return device.signal;
    case 'actuator': return undefined;
  }
}

function inputs(device: ControlDevice): Readonly<Record<string, Signal>> {
  switch (device.kind) {
    case 'thermostat': return { temperature: 'air' };
    case 'surface-limit': return { temperature: 'floor' };
    case 'rtl': return { temperature: 'return' };
    case 'high-limit': return { temperature: 'supply' };
    case 'actuator': return { demand: 'demand', permit: 'permit' };
    case 'delay': return { in: device.signal };
    case 'and': case 'or':
      return Object.fromEntries(Array.from({ length: device.inputs }, (_, i) => [`i${i + 1}`, device.signal]));
    case 'sensor': return {};
  }
}

const isBooleanSignal = (value: unknown): value is BooleanSignal => value === 'demand' || value === 'permit';
const hysteresis = (value: number): boolean => Number.isFinite(value) && value > 0 && value <= 100;
const idPattern = /^[a-z0-9][a-z0-9_-]{0,95}$/i;

function valid(device: ControlDevice): boolean {
  if (!idPattern.test(device.id)) return false;
  switch (device.kind) {
    case 'sensor': return ['air', 'floor', 'return', 'supply'].includes(device.measurement) && Boolean(device.sampleId) &&
        Number.isSafeInteger(device.maxAgeTicks) && device.maxAgeTicks > 0;
    case 'thermostat': return finiteTemperature(device.targetC) && hysteresis(device.hysteresisC) &&
        finiteTemperature(device.targetC - device.hysteresisC);
    case 'surface-limit': case 'rtl': case 'high-limit':
      return finiteTemperature(device.limitC) && hysteresis(device.hysteresisC) &&
        finiteTemperature(device.limitC - device.hysteresisC) && typeof device.latching === 'boolean';
    case 'actuator': return (device.normally === 'NC' || device.normally === 'NO') && Number.isFinite(device.travelSeconds) &&
        device.travelSeconds > 0 && typeof device.wantsLimiter === 'boolean';
    case 'delay': return typeof device.initial === 'boolean' && device.signal === 'demand';
    case 'and': case 'or': return isBooleanSignal(device.signal) && (device.signal === 'demand' || device.kind === 'and') && Number.isInteger(device.inputs) && device.inputs > 0 && device.inputs <= 8;
  }
}

export const controlIssue = (code: string, path: string, componentId: string, message: string, severity: Diagnostic['severity'] = 'error'): Diagnostic =>
  ({ code, path, componentId, message, severity });

export function compileControls(devices: readonly ControlDevice[], wires: readonly ControlWire[]): Result<ControlGraph> {
  const fail = (code: string, id: string, message: string): Result<ControlGraph> =>
    ({ ok: false, diagnostics: [controlIssue(code, 'control', id, message)] });
  if (devices.length > 2048 || wires.length > 8192) return fail('control_graph_budget', '', 'Слишком большая схема автоматики.');
  const indexed = new Map<string, ControlDevice>();
  const targets = new Map<string, Map<string, string>>();
  const dependentIds = new Map<string, string[]>(), indegree = new Map<string, number>();
  const wireIds = new Set<string>();
  for (const device of devices) {
    if (!valid(device) || indexed.has(device.id)) return fail('invalid_control_device', device.id, 'Повторный идентификатор или некорректный профиль автоматики.');
    indexed.set(device.id, Object.freeze({ ...device }));
    targets.set(device.id, new Map()); indegree.set(device.id, 0); dependentIds.set(device.id, []);
  }
  for (const wire of wires) {
    const from = indexed.get(wire.from), target = indexed.get(wire.to);
    if (!from || !target || !wire.id || wireIds.has(wire.id)) return fail('invalid_control_wire', wire.to, 'Связь автоматики не имеет корректного адреса или идентификатора.');
    wireIds.add(wire.id);
    const accept = inputs(target);
    if (!Object.hasOwn(accept, wire.port) || output(from) !== accept[wire.port]) {
      return fail('incompatible_control_signal', wire.to, 'Датчик или выход не соответствует сигнальному входу.');
    }
    const incoming = targets.get(wire.to)!;
    if (incoming.has(wire.port)) return fail('multiple_control_writers', wire.to, 'На один вход может писать один источник; используйте явный логический блок.');
    incoming.set(wire.port, wire.from);
    if (target.kind === 'delay') continue; // Captured only after the full combinational pass.
    indegree.set(wire.to, indegree.get(wire.to)! + 1);
    dependentIds.get(wire.from)!.push(wire.to);
  }

  const available = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id).sort();
  const ordered: ControlDevice[] = [];
  for (let i = 0; i < available.length; i++) {
    const id = available[i]!;
    ordered.push(indexed.get(id)!);
    for (const next of dependentIds.get(id)!.sort()) {
      const degree = indegree.get(next)! - 1;
      indegree.set(next, degree);
      if (degree === 0) available.push(next);
    }
  }
  const blocked = [...indegree].filter(([, degree]) => degree > 0).map(([id]) => id).sort()[0];
  if (blocked) return fail('zero_delay_cycle', blocked, 'Цикл управления требует явного блока задержки.');
  const verifiedPermission = new Set<string>(), protectedActuators = new Set<string>();
  for (const device of ordered) {
    const incoming = targets.get(device.id)!;
    if (device.kind === 'high-limit' || device.kind === 'surface-limit' || device.kind === 'rtl') {
      verifiedPermission.add(device.id);
    } else if (device.kind === 'and' && device.signal === 'permit' &&
        incoming.size === device.inputs && [...incoming.values()].every((id) => verifiedPermission.has(id))) {
      verifiedPermission.add(device.id);
    } else if (device.kind === 'actuator' && verifiedPermission.has(incoming.get('permit') ?? '')) {
      protectedActuators.add(device.id);
    }
  }
  return { ok: true, value: { ordered, wiresByTarget: targets, protectedActuators }, diagnostics: [] };
}
