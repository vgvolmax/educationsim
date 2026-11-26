import type { Result } from '../project/types';
import type { FluidProfile } from './fluids';
import type { HydraulicSnapshot } from './hydraulics';
import { finiteTemperature } from './mixing';
import { applyService, bindStorage } from './storage-tank';
import type { CellState, ServiceExchange, StorageBinding } from './storage-tank';
import { advectiveWatts, thermalJunctions } from './thermal-advection';
import type { CompiledSystem } from './types';

type HeatSink = { cellId: string; kind: 'ambient' | 'radiator'; uaWPerK: number; ambientC: number };
type Transfer = { from: string; to: string; ua: number };
type Energy = {
  startJ: number; endJ: number; sourceJ: number; ambientLossJ: number; radiatorLossJ: number;
  makeupJ: number; drainJ: number; residualJ: number;
};
export type FluidThermalInput = {
  system: CompiledSystem;
  hydraulics: HydraulicSnapshot;
  seconds: number;
  state: { cells: Readonly<Record<string, CellState>> };
  storage?: readonly StorageBinding[];
  sources?: readonly { cellId: string; powerW: number }[];
  sinks?: readonly HeatSink[];
  service?: readonly ServiceExchange[];
};
export type FluidThermalState = {
  cells: Record<string, CellState>; fluidProfileByCell: Record<string, string>;
  advectiveJ: Record<string, number>; energy: Energy; substeps: number;
};
const fail = (code: string, path: string, message: string): Result<FluidThermalState> =>
  ({ ok: false, diagnostics: [{ code, path, message, severity: 'error' }] });
const positive = (n: number): boolean => Number.isFinite(n) && n > 0;
const nonnegative = (n: number): boolean => Number.isFinite(n) && n >= 0;
const add = (map: Map<string, number>, id: string, value: number): void => { map.set(id, (map.get(id) ?? 0) + value); };

export function advanceFluidTemperatures(input: FluidThermalInput): Result<FluidThermalState> {
  const { system, hydraulics, seconds } = input;
  if (hydraulics.projectId !== system.projectId || hydraulics.projectRevision !== system.projectRevision) {
    return fail('stale_hydraulics', 'hydraulics', 'Снимок расхода относится к другому проекту или ревизии.');
  }
  if (!positive(seconds) || seconds > 120) return fail('invalid_thermal_step', 'seconds', 'Шаг переноса должен быть больше 0 и не больше 120 с.');
  const bindings = bindStorage(system, input.storage ?? []);
  if (!bindings) return fail('invalid_storage', 'storage', 'Буфер и гидрострелка не могут объединять разные контуры или дублировать каналы.');
  const domainByChannel = new Map(system.hydraulicChannels.map((channel) => [channel.id, channel.domainId]));
  const domains = new Map(system.hydraulicDomains.map((domain) => [domain.id, domain.fluid]));
  const cellByChannel = new Map<string, string>(), profiles = new Map<string, FluidProfile>();

  for (const channel of system.hydraulicChannels) {
    const fluid = domains.get(channel.domainId);
    if (!fluid || !positive(fluid.specificHeatJkgK) || !positive(fluid.densityKgM3)) {
      return fail('invalid_thermal_fluid', channel.id, 'У жидкости отсутствует пригодный тепловой профиль.');
    }
    const cell = bindings.get(channel.id) ?? channel.id;
    cellByChannel.set(channel.id, cell);
    profiles.set(cell, fluid);
  }
  if (!profiles.size) return fail('invalid_thermal_cell', 'cells', 'Нет тепловых ячеек.');
  for (const id of Object.keys(input.state.cells)) {
    if (!profiles.has(id)) return fail('invalid_thermal_cell', id, 'Тепловая ячейка не соответствует текущей схеме.');
  }
  const mass = new Map<string, number>(), temperatures = new Map<string, number>(), capacities = new Map<string, number>();
  let startJ = 0, makeupJ = 0, drainJ = 0;
  for (const [id, fluid] of profiles) {
    const value = input.state.cells[id];
    if (!value || !positive(value.massKg) || !finiteTemperature(value.temperatureC)) return fail('invalid_thermal_cell', id, 'Нужно заданное начальное состояние и положительная масса жидкости.');
    mass.set(id, value.massKg); temperatures.set(id, value.temperatureC);
    startJ += value.massKg * fluid.specificHeatJkgK * value.temperatureC;
  }
  for (const operation of input.service ?? []) {
    const { cellId } = operation;
    const fluid = profiles.get(cellId);
    const result = fluid && applyService({ massKg: mass.get(cellId)!, temperatureC: temperatures.get(cellId)! }, fluid.specificHeatJkgK, operation);
    if (!result) return fail('invalid_service_exchange', cellId, 'Невозможно выполнить указанную подпитку или слив.');
    mass.set(cellId, result.next.massKg); temperatures.set(cellId, result.next.temperatureC);
    makeupJ += result.makeupJ; drainJ += result.drainJ;
  }
  for (const [id, fluid] of profiles) {
    const c = mass.get(id)! * fluid.specificHeatJkgK;
    if (!positive(c)) return fail('invalid_thermal_cell', id, 'Теплоёмкость ячейки вышла за диапазон.');
    capacities.set(id, c);
  }
  const network = thermalJunctions(system, hydraulics, cellByChannel);
  if ('code' in network) return fail(network.code, network.path, 'Потоки в тепловой схеме не образуют согласованный баланс.');
  const transfers: Transfer[] = [], transferIds = new Set<string>();
  for (const link of system.thermalLinks) {
    if (link.kind !== 'heat-exchanger') continue;
    const from = cellByChannel.get(link.primaryChannelId), to = cellByChannel.get(link.secondaryChannelId);
    if (!from || !to || domainByChannel.get(link.primaryChannelId) === domainByChannel.get(link.secondaryChannelId) ||
        !positive(link.uaWPerK) || transferIds.has(link.componentId)) return fail('invalid_exchanger', link.componentId, 'Теплообменник должен связывать разные контуры без смешения среды.');
    transfers.push({ from, to, ua: link.uaWPerK }); transferIds.add(link.componentId);
  }

  const sourceByCell = new Map<string, number>(), conductance = new Map<string, number>();
  for (const source of input.sources ?? []) {
    if (!profiles.has(source.cellId) || !nonnegative(source.powerW)) return fail('invalid_heat_source', source.cellId, 'Нужна конечная неотрицательная мощность источника.');
    add(sourceByCell, source.cellId, source.powerW);
  }
  for (const sink of input.sinks ?? []) {
    if (!profiles.has(sink.cellId) || !nonnegative(sink.uaWPerK) || !finiteTemperature(sink.ambientC) ||
        (sink.kind !== 'ambient' && sink.kind !== 'radiator')) return fail('invalid_heat_sink', sink.cellId, 'Неверная среда или теплопередача.');
    add(conductance, sink.cellId, sink.uaWPerK);
  }
  for (const { from, to, ua } of transfers) { add(conductance, from, ua); add(conductance, to, ua); }
  for (const junction of network.junctions) for (const stream of junction.input) add(conductance, stream.cellId, stream.conductance);

  let substeps = 1;
  for (const [id, ua] of conductance) substeps = Math.max(substeps, Math.ceil(seconds * (ua / capacities.get(id)!) * 128));
  if (!Number.isFinite(substeps) || substeps > 2048) return fail('thermal_step_budget', 'seconds', 'Нужен меньший шаг для устойчивого теплопереноса.');
  const dt = seconds / substeps;
  const advectiveJ = new Map<string, number>([...profiles.keys()].map((id) => [id, 0]));
  let ambientLossJ = 0, radiatorLossJ = 0;
  const sourceJ = [...sourceByCell.values()].reduce((sum, w) => sum + w, 0) * seconds;
  for (let step = 0; step < substeps; step++) {
    const power = advectiveWatts(network.junctions, temperatures);
    for (const [id, w] of power) add(advectiveJ, id, w * dt);
    for (const [id, w] of sourceByCell) add(power, id, w);
    for (const { from, to, ua } of transfers) {
      const w = ua * (temperatures.get(from)! - temperatures.get(to)!);
      add(power, from, -w); add(power, to, w);
    }
    for (const sink of input.sinks ?? []) {
      const loss = sink.uaWPerK * (temperatures.get(sink.cellId)! - sink.ambientC);
      if (sink.kind === 'radiator') radiatorLossJ += loss * dt;
      else ambientLossJ += loss * dt;
      add(power, sink.cellId, -loss);
    }
    for (const [id, w] of power) {
      const t = temperatures.get(id)! + (w * dt) / capacities.get(id)!;
      if (!finiteTemperature(t)) return fail('invalid_thermal_result', id, 'Температура вышла за допустимый диапазон.');
      temperatures.set(id, t);
    }
  }
  const endJ = [...temperatures].reduce((sum, [id, t]) => sum + t * capacities.get(id)!, 0);
  const residualJ = endJ - startJ - sourceJ + ambientLossJ + radiatorLossJ - makeupJ + drainJ;
  const total = Math.abs(startJ) + Math.abs(endJ) + Math.abs(sourceJ) + Math.abs(makeupJ) + Math.abs(drainJ) + Math.abs(ambientLossJ) + Math.abs(radiatorLossJ);
  if (!Number.isFinite(total) || !Number.isFinite(residualJ) || Math.abs(residualJ) > Math.max(1e-7, total * 1e-10) ||
      [...advectiveJ.values()].some((j) => !Number.isFinite(j))) return fail('thermal_energy_balance', 'energy', 'Не сошёлся баланс энергии.');
  return { ok: true, value: {
    cells: Object.fromEntries([...temperatures].map(([id, temperatureC]) => [id, { massKg: mass.get(id)!, temperatureC }])),
    fluidProfileByCell: Object.fromEntries([...profiles].map(([id, profile]) => [id, profile.id])),
    advectiveJ: Object.fromEntries(advectiveJ), substeps,
    energy: { startJ, endJ, sourceJ, ambientLossJ, radiatorLossJ, makeupJ, drainJ, residualJ },
  }, diagnostics: [] };
}
