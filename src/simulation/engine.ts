import type { Diagnostic, Result } from '../project/types';
import { advanceControls, compileControls } from './controls';
import type { ControlInput } from './controls';
import { stagePressure, stageService } from './engine-pressure';
import { advanceFaults, applyControlFaults, applyHydraulicFaults, applyJammedActuators, emptyFaultState } from './faults';
import type { FaultCommand } from './faults';
import { advanceFluidTemperatures } from './heat-transfer';
import { solveHydraulics } from './hydraulics';
import { finiteTemperature } from './mixing';
import { advanceBuilding } from './room';
import { regulateSource } from './sources';
import { bindStorage } from './storage-tank';
import type { ServiceExchange } from './storage-tank';
import type { SimulationCommand, SimulationScenario, SimulationState } from './engine-types';

export type { SimulationCommand, SimulationScenario, SimulationState } from './engine-types';
export type SimulationEngine = {
  initial(): SimulationState;
  step(state: SimulationState, commands: readonly SimulationCommand[]): Result<SimulationState>;
};
const failure = <T>(code: string, path: string, message: string): Result<T> =>
  ({ ok: false, diagnostics: [{ code, path, message, severity: 'error' }] });

export function openSimulation(input: SimulationScenario): Result<SimulationEngine> {
  // Clone the serializable authoring data once; a caller cannot mutate a running scenario retroactively.
  const scenario = structuredClone(input);
  const { system } = scenario;
  const graph = compileControls(scenario.control.devices, scenario.control.wires);
  if (!graph.ok) return graph;
  const compiledControls = graph.value;
  if (!finiteTemperature(scenario.outdoorC)) return failure('invalid_engine_scenario', 'outdoorC', 'В сценарии нет допустимой наружной температуры.');
  const bindings = bindStorage(system, scenario.fluid.storage ?? []);
  if (!bindings) return failure('invalid_engine_scenario', 'storage', 'Некорректная привязка ёмкостей.');
  const channels = new Map(system.hydraulicChannels.map((channel) => [channel.id, channel]));
  const domains = new Map(system.hydraulicDomains.map((domain) => [domain.id, domain.fluid]));
  const profileByCell = new Map<string, string>(), cellDomains = new Map<string, string>();
  for (const channel of channels.values()) {
    const profile = domains.get(channel.domainId);
    const cell = bindings.get(channel.id) ?? channel.id;
    const value = scenario.fluid.cells[cell];
    if (!profile || !value || !Number.isFinite(value.massKg) || value.massKg <= 0 || !finiteTemperature(value.temperatureC)) {
      return failure('invalid_engine_scenario', 'fluid', 'Нет начального теплового состояния для канала.');
    }
    profileByCell.set(cell, profile.id); cellDomains.set(cell, channel.domainId);
  }
  if (Object.keys(scenario.fluid.cells).length !== profileByCell.size) {
    return failure('invalid_engine_scenario', 'fluid', 'Тепловая ёмкость не принадлежит текущей схеме.');
  }
  const actuatorIds = new Set(scenario.control.devices.filter((x) => x.kind === 'actuator').map(({ id }) => id));
  const resetIds = new Set(scenario.control.devices.filter((x) => x.kind === 'high-limit' || x.kind === 'rtl' || x.kind === 'surface-limit').map(({ id }) => id));
  const samples = scenario.control.devices.flatMap((x) => x.kind === 'sensor' ? [x.sampleId] : []);
  if (new Set(scenario.control.bindings.map(({ sampleId }) => sampleId)).size !== scenario.control.bindings.length ||
      scenario.control.bindings.some((b) => !samples.includes(b.sampleId))) {
    return failure('invalid_engine_scenario', 'control', 'Датчики должны иметь однозначный источник измерения.');
  }
  const zoneIds = new Set<string>();
  for (const [id, ids] of Object.entries(scenario.control.zoneChannels ?? {})) {
    if (!actuatorIds.has(id)) return failure('invalid_engine_scenario', id, 'У зоны отсутствует привод.');
    for (const channelId of ids) {
      const channel = channels.get(channelId);
      if (!channel || channel.kind === 'pump' || channel.kind === 'source' || zoneIds.has(channelId) ||
          Object.hasOwn(scenario.hydraulic.valves ?? {}, channelId)) {
        return failure('invalid_engine_scenario', channelId, 'Канал зоны не может принадлежать нескольким устройствам.');
      }
      if (scenario.hydraulic.mixingValves?.some((item) => item.first === channelId || item.second === channelId)) {
        return failure('invalid_engine_scenario', channelId, 'Канал зоны уже управляется трёхходовым клапаном.');
      }
      zoneIds.add(channelId);
    }
  }
  const sourceIds = new Set<string>();
  for (const source of scenario.sources) {
    if (!source.componentId || sourceIds.has(source.componentId) || channels.get(source.channelId)?.kind !== 'source' ||
        !profileByCell.has(source.waterCellId) || (bindings.get(source.channelId) ?? source.channelId) !== source.waterCellId ||
        !source.actuatorIds.length || source.actuatorIds.some((id) => !actuatorIds.has(id))) {
      return failure('invalid_engine_scenario', source.componentId, 'Источник должен иметь свой канал и связанные команды приводов.');
    }
    sourceIds.add(source.componentId);
  }

  const pressureIds = new Set<string>();
  for (const { domainId } of scenario.pressure ?? []) {
    if (!domains.has(domainId) || pressureIds.has(domainId) || ![...cellDomains.values()].includes(domainId)) {
      return failure('invalid_engine_scenario', domainId, 'Давление должно ссылаться на единственный водяной контур.');
    }
    pressureIds.add(domainId);
  }
  const initial = (): SimulationState => ({
    projectId: system.projectId, projectRevision: system.projectRevision, tick: 0, powered: true,
    manual: {}, faults: emptyFaultState(), control: null, sources: {},
    fluid: { cells: structuredClone(scenario.fluid.cells), fluidProfileByCell: Object.fromEntries(profileByCell) },
    hydraulics: null, building: null, energy: null, health: 'normal', pressure: {}, pressureReliefJ: 0,
  });

  function step(state: SimulationState, commands: readonly SimulationCommand[]): Result<SimulationState> {
    if (state.projectId !== system.projectId || state.projectRevision !== system.projectRevision ||
        !Number.isSafeInteger(state.tick) || state.tick < 0 || state.tick === Number.MAX_SAFE_INTEGER) {
      return failure('stale_engine_state', 'simulation', 'Снимок не соответствует сохранённой схеме.');
    }
    if (state.health === 'stopped') return failure('stopped_engine', 'simulation', 'Расчёт остановлен на границе модели.');
    if (commands.length > 128) return failure('invalid_engine_command', 'commands', 'Слишком много команд за один тик.');
    const manual = new Map(Object.entries(state.manual)), resets: string[] = [], faultCommands: FaultCommand[] = [];
    const service: ServiceExchange[] = [];
    let powered = state.powered;
    for (const command of commands) {
      if (command.kind === 'manual' && actuatorIds.has(command.actuatorId) && typeof command.demand === 'boolean') manual.set(command.actuatorId, command.demand);
      else if (command.kind === 'power' && typeof command.powered === 'boolean') powered = command.powered;
      else if (command.kind === 'reset-limit' && resetIds.has(command.limiterId)) resets.push(command.limiterId);
      else if (command.kind === 'fault') faultCommands.push(command.command);
      else if (command.kind === 'service') service.push(command);
      else return failure('invalid_engine_command', 'commands', 'Команда содержит неизвестную цель или состояние.');
    }
    const tick = state.tick + 1, diagnostics: Diagnostic[] = [];
    const faults = advanceFaults(state.faults, { channels: [...channels.keys()], sensors: samples, actuators: [...actuatorIds] }, faultCommands);
    if (!faults.ok) return faults;
    const previousBuilding = state.building ?? (scenario.building && {
      roomsC: scenario.building.roomsC, floors: scenario.building.floorTemperatures,
    });
    const sampleValues: ControlInput['samples'] = Object.fromEntries(scenario.control.bindings.map((binding) => [
      binding.sampleId, { tick: state.tick, celsius: (binding.kind === 'fluid' ? state.fluid.cells[binding.id]?.temperatureC :
        binding.kind === 'room' ? previousBuilding?.roomsC[binding.id] : previousBuilding?.floors[binding.id]?.surfaceC) ?? null },
    ]));
    const sourceAvailable = Object.fromEntries(scenario.sources.flatMap(({ actuatorIds }) => actuatorIds.map((id) => [id, powered])));
    const request: ControlInput = {
      tick, seconds: 1, powered, previous: state.control ?? undefined, manualDemand: Object.fromEntries(manual),
      samples: sampleValues, reset: resets, sourceAvailable,
    };
    const controls = advanceControls(compiledControls, applyControlFaults(request, faults.value));
    if (!controls.ok) return controls;
    diagnostics.push(...controls.diagnostics);
    const control = applyJammedActuators(controls.value, faults.value);
    const valveSettings: NonNullable<HydraulicInputsLocal['valves']> = Object.fromEntries([
      ...Object.entries(scenario.hydraulic.valves ?? {}),
      ...Object.entries(scenario.control.zoneChannels ?? {}).flatMap(([id, ids]) =>
        ids.map((channelId) => [channelId, { kind: 'zone', opening: control.actuators[id]!.opening }] as const)),
    ]);
    const pumps: HydraulicInputsLocal['pumps'] = powered ? scenario.hydraulic.pumps : Object.fromEntries(
      [...channels.values()].filter((channel) => channel.kind === 'pump' || channel.kind === 'source').map(({ id }) => [
        id, { mode: 'off', blockReverse: scenario.hydraulic.pumps?.[id]?.blockReverse },
      ]),
    );
    const hydraulics = solveHydraulics(system, applyHydraulicFaults({ ...scenario.hydraulic, valves: valveSettings, pumps }, faults.value));
    if (!hydraulics.ok) return hydraulics;
    diagnostics.push(...hydraulics.diagnostics);

    const sourceOutputs: SimulationState['sources'] = Object.create(null) as SimulationState['sources'];
    const power: Array<{ cellId: string; powerW: number }> = [];
    for (const source of scenario.sources) {
      const demands = source.actuatorIds.map((id) => control.actuators[id]!);
      const r = regulateSource(source.profile, {
        demand: demands.some((a) => a.requested), manual: false, powered, available: powered,
        permitted: demands.some((a) => a.requested && a.permitted),
        outdoorC: scenario.building?.climate.outdoorC ?? scenario.outdoorC,
        flowM3s: hydraulics.value.channels[source.channelId]?.flowM3s ?? 0,
        requestedPowerW: source.profile.ratedPowerW, supplyC: state.fluid.cells[source.waterCellId]!.temperatureC,
      });
      if (!r.ok) return r;
      sourceOutputs[source.componentId] = r.value;
      power.push({ cellId: source.waterCellId, powerW: r.value.powerW });
    }
    const transfers = stageService(scenario, state.fluid, cellDomains, service);
    if (!transfers.ok) return transfers;
    const thermal = advanceFluidTemperatures({ system, hydraulics: hydraulics.value, seconds: 1, state: state.fluid,
      storage: scenario.fluid.storage, sinks: scenario.fluid.sinks, sources: power, service });
    if (!thermal.ok) return thermal;
    let fluid: SimulationState['fluid'] = { cells: thermal.value.cells, fluidProfileByCell: thermal.value.fluidProfileByCell };
    let building: SimulationState['building'] = null;
    if (scenario.building && previousBuilding) {
      const heated = advanceBuilding({ ...scenario.building, seconds: 1, fluidProfiles: [...domains.values()],
        state: { roomsC: previousBuilding.roomsC, floors: previousBuilding.floors, fluid } });
      if (!heated.ok) return heated;
      building = heated.value;
      fluid = building.fluid;
    }
    const pressure = stagePressure(scenario, state, fluid, hydraulics.value, cellDomains, transfers.value.admitted);
    if (!pressure.ok) return pressure;
    return { ok: true, value: { projectId: system.projectId, projectRevision: system.projectRevision, tick, powered,
      manual: Object.fromEntries(manual), faults: faults.value, control, ...pressure.value,
      building: building ? { ...building, fluid: pressure.value.fluid } : null, sources: sourceOutputs,
      energy: thermal.value.energy }, diagnostics: [...diagnostics, ...pressure.diagnostics] };
  }
  return { ok: true, value: { initial, step }, diagnostics: [] };
}
type HydraulicInputsLocal = SimulationScenario['hydraulic'];
