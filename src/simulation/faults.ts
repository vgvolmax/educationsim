import type { Result } from '../project/types';
import type { ControlInput, ControlState } from './controls';
import type { HydraulicInputs } from './hydraulics';

export type FaultState = {
  channels: Record<string, { air: number; filter: number }>;
  sensors: readonly string[]; jammed: Record<string, number>;
};
type FaultTargets = { channels: readonly string[]; sensors: readonly string[]; actuators: readonly string[] };
export type FaultCommand = { id: string } & (
  | { kind: 'air' | 'filter'; extent: number }
  | { kind: 'vent' | 'clean' | 'sensor-failure' | 'sensor-repair' | 'unjam' }
  | { kind: 'jam'; opening: number }
);
export const emptyFaultState = (): FaultState => ({ channels: {}, sensors: [], jammed: {} });
const ratio = (x: number): boolean => Number.isFinite(x) && x >= 0 && x <= 1;

export function advanceFaults(previous: FaultState, targets: FaultTargets, commands: readonly FaultCommand[]): Result<FaultState> {
  const allowed = { channels: new Set(targets.channels), sensors: new Set(targets.sensors), actuators: new Set(targets.actuators) };
  const channels = new Map(Object.entries(previous.channels)), sensors = new Set(previous.sensors), jammed = new Map(Object.entries(previous.jammed));
  const fail = (id: string): Result<FaultState> => ({ ok: false,
    diagnostics: [{ code: 'invalid_fault_command', path: 'faults', componentId: id, message: 'Некорректный адрес или степень отказа.', severity: 'error' }] });
  if (commands.length > 128) return fail('');
  for (const command of commands) {
    const { id, kind } = command;
    switch (kind) {
      case 'air': case 'filter': case 'vent': case 'clean': {
        if (!allowed.channels.has(id) || ('extent' in command && !ratio(command.extent))) return fail(id);
        const current = { ...(channels.get(id) ?? { air: 0, filter: 0 }) };
        if (kind === 'air') current.air = command.extent;
        if (kind === 'filter') current.filter = command.extent;
        if (kind === 'vent') current.air = 0;
        if (kind === 'clean') current.filter = 0;
        if (current.air || current.filter) channels.set(id, current);
        else channels.delete(id);
        break;
      }
      case 'sensor-failure': case 'sensor-repair':
        if (!allowed.sensors.has(id)) return fail(id);
        if (kind === 'sensor-failure') sensors.add(id);
        else sensors.delete(id);
        break;
      case 'jam': case 'unjam':
        if (!allowed.actuators.has(id)) return fail(id);
        if (kind === 'jam') {
          if (!ratio(command.opening)) return fail(id);
          jammed.set(id, command.opening);
        } else jammed.delete(id);
        break;
    }
  }
  return { ok: true, value: { channels: Object.fromEntries(channels), sensors: [...sensors].sort(), jammed: Object.fromEntries(jammed) }, diagnostics: [] };
}

export function applyHydraulicFaults(input: HydraulicInputs, state: FaultState): HydraulicInputs {
  const closed = new Set(input.closedChannels), losses = new Map(Object.entries(input.resistanceMultipliers ?? {}));
  for (const [id, fault] of Object.entries(state.channels)) {
    if (fault.air >= 1) closed.add(id);
    else losses.set(id, (losses.get(id) ?? 1) * (1 + 3 * fault.air) * (1 + 3 * fault.filter));
  }
  return { ...input, closedChannels: [...closed], resistanceMultipliers: Object.fromEntries(losses) };
}

export function applyControlFaults(input: ControlInput, state: FaultState): ControlInput {
  const failed = new Set(state.sensors);
  const samples = Object.fromEntries(Object.entries(input.samples).map(([id, sample]) =>
    [id, failed.has(id) ? { ...sample, celsius: null } : sample]));
  return { ...input, samples };
}

export function applyJammedActuators(control: ControlState, state: FaultState): ControlState {
  return { ...control, actuators: Object.fromEntries(Object.entries(control.actuators).map(([id, actuator]) => {
    const opening = Object.hasOwn(state.jammed, id) ? state.jammed[id] : undefined;
    return [id, opening !== undefined ? { ...actuator, opening, heatEffective: actuator.sourceAvailable && actuator.powered && actuator.permitted && opening > 0 } : actuator];
  })) };
}
