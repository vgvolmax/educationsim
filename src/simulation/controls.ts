import type { Diagnostic, Result } from '../project/types';
import { controlIssue } from './control-graph';
import type { ControlGraph } from './control-graph';
import { finiteTemperature } from './mixing';

export { compileControls } from './control-graph';
export type { ControlGraph, ControlWire, ControlDevice } from './control-graph';
type Sample = { tick: number; celsius: number | null };
type ControlEvent = { tick: number; componentId: string; kind: 'limiter-tripped' | 'limiter-reset'; reason: 'sensor' | 'temperature' };
type Actuation = {
  requested: boolean; sourceAvailable: boolean; powered: boolean; permitted: boolean;
  commandOpen: boolean; opening: number; heatEffective: boolean;
};
export type ControlState = {
  tick: number; setpointsC: Record<string, number>; actuators: Record<string, Actuation>;
  demandByDevice: Record<string, boolean>; limits: Record<string, boolean>; delay: Record<string, boolean>;
  events: ControlEvent[];
};
export type ControlInput = {
  tick: number; seconds: number; powered: boolean; previous?: ControlState;
  samples: Readonly<Record<string, Sample>>;
  manualDemand?: Readonly<Record<string, boolean>>;
  sourceAvailable?: Readonly<Record<string, boolean>>;
  reset?: readonly string[];
};

export function advanceControls(graph: ControlGraph, input: ControlInput): Result<ControlState> {
  const { tick, seconds, previous } = input;
  if (!Number.isSafeInteger(tick) || tick <= 0 || !Number.isFinite(seconds) || seconds <= 0 || seconds > 60 ||
      typeof input.powered !== 'boolean' || (previous && previous.tick !== tick - 1)) {
    return { ok: false, diagnostics: [controlIssue('invalid_control_step', 'control', '', 'Неверная последовательность или длительность шага автоматики.')] };
  }
  const signals = new Map<string, boolean | number | null>(), actuators = new Map<string, Actuation>(), setpoints = new Map<string, number>();
  const demand = new Map<string, boolean>(), limits = new Map<string, boolean>(), delay = new Map<string, boolean>();
  const events: ControlEvent[] = [], diagnostics: Diagnostic[] = [];
  const reset = new Set(input.reset);
  const warn = (code: string, componentId: string, message: string): void => {
    diagnostics.push(controlIssue(code, 'control', componentId, message, 'warning'));
  };
  function read(id: string, port: string): boolean | number | null {
    const from = graph.wiresByTarget.get(id)?.get(port);
    return from ? signals.get(from) ?? null : null;
  }

  for (const device of graph.ordered) {
    const id = device.id;
    switch (device.kind) {
      case 'sensor': {
        const sample = input.samples[device.sampleId];
        const age = sample ? tick - sample.tick : Infinity;
        const c = sample?.celsius;
        if (c === null || c === undefined || !finiteTemperature(c) || !Number.isSafeInteger(age) || age <= 0 || age > device.maxAgeTicks) {
          warn('sensor_unavailable', id, 'Нет корректного измерения из допустимого предыдущего тика.');
          signals.set(id, null);
        } else signals.set(id, c);
        break;
      }
      case 'thermostat': {
        const t = read(id, 'temperature');
        let next = false;
        setpoints.set(id, device.targetC);
        if (typeof t === 'number') {
          next = t <= device.targetC - device.hysteresisC ||
            (t < device.targetC + device.hysteresisC && previous?.demandByDevice[id] === true);
        } else warn('thermostat_sensor_missing', id, 'Нет рабочего датчика комнатного воздуха.');
        demand.set(id, next); signals.set(id, next);
        break;
      }
      case 'surface-limit': case 'rtl': case 'high-limit': {
        const t = read(id, 'temperature'), wasTripped = previous?.limits[id] === true;
        const hasSample = typeof t === 'number';
        const coolEnough = hasSample && t <= device.limitC - device.hysteresisC;
        const next = !hasSample || t >= device.limitC ||
          (wasTripped && !(coolEnough && (!device.latching || reset.has(id))));
        if (!hasSample) warn('limiter_sensor_unavailable', id, 'Разрешение снято: измерение ограничителя отсутствует или устарело.');
        if (next !== wasTripped) events.push({ tick, componentId: id, kind: next ? 'limiter-tripped' : 'limiter-reset',
          reason: hasSample ? 'temperature' : 'sensor' });
        limits.set(id, next); signals.set(id, !next);
        break;
      }
      case 'delay':
        signals.set(id, previous?.delay[id] ?? device.initial);
        break;
      case 'and': case 'or': {
        const states = Array.from({ length: device.inputs }, (_, i) => read(id, `i${i + 1}`) === true);
        signals.set(id, device.kind === 'and' ? states.every(Boolean) : states.some(Boolean));
        break;
      }
      case 'actuator': {
        const requested = read(id, 'demand') === true || input.manualDemand?.[id] === true;
        const hasLimiter = graph.wiresByTarget.get(id)?.has('permit') === true;
        const protectionIsWired = graph.protectedActuators.has(id);
        if (device.wantsLimiter && !protectionIsWired) warn('limiter_disconnected', id, 'Ограничитель не связан с приводом: это подключение не защищено.');
        const permitted = !hasLimiter || (protectionIsWired && read(id, 'permit') === true);
        const sourceAvailable = input.sourceAvailable?.[id] === true;
        const commandOpen = requested && permitted && input.powered;
        const normal = device.normally === 'NO' ? 1 : 0;
        const target = input.powered ? Number(commandOpen) : normal;
        const old = previous?.actuators[id]?.opening ?? normal;
        if (!Number.isFinite(old) || old < 0 || old > 1) {
          return { ok: false, diagnostics: [controlIssue('invalid_actuator_state', 'control', id, 'Неверное предыдущее положение привода.')] };
        }
        const opening = old + Math.sign(target - old) * Math.min(Math.abs(target - old), seconds / device.travelSeconds);
        actuators.set(id, { requested, sourceAvailable, powered: input.powered, permitted, commandOpen, opening,
          heatEffective: sourceAvailable && input.powered && permitted && opening > 0 });
        break;
      }
    }
  }
  for (const device of graph.ordered) if (device.kind === 'delay') delay.set(device.id, read(device.id, 'in') === true);
  return { ok: true, value: {
    tick, setpointsC: Object.fromEntries(setpoints), actuators: Object.fromEntries(actuators), demandByDevice: Object.fromEntries(demand),
    limits: Object.fromEntries(limits), delay: Object.fromEntries(delay), events,
  }, diagnostics };
}
