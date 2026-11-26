import type { Diagnostic, Result } from '../project/types';
import type { EnginePressureState, SimulationScenario, SimulationState } from './engine-types';
import type { HydraulicSnapshot } from './hydraulics';
import { advancePressure } from './pressure';
import { advanceService } from './service';
import type { ServiceExchange } from './storage-tank';

type Snapshot = Pick<SimulationState, 'health' | 'pressureReliefJ' | 'pressure' | 'fluid'> & { hydraulics: HydraulicSnapshot };
export type CellDomains = ReadonlyMap<string, string>;
const fail = <T>(code: string, path: string, message: string): Result<T> =>
  ({ ok: false, diagnostics: [{ code, path, message, severity: 'error' }] });

export function stageService(
  scenario: SimulationScenario, fluid: SimulationState['fluid'], cellDomains: CellDomains, requests: readonly ServiceExchange[],
): Result<{ admitted: Map<string, number> }> {
  const contents = new Map(Object.entries(fluid.cells)), admitted = new Map<string, number>();
  const domains = new Map(scenario.system.hydraulicDomains.map((domain) => [domain.id, domain.fluid]));
  for (const request of requests) {
    const id = request.cellId, domain = cellDomains.get(id), old = contents.get(id);
    const profile = domain ? domains.get(domain) : undefined;
    const capacityM3 = scenario.serviceCapacityM3ByCell?.[id];
    if (!domain || !old || !profile || capacityM3 === undefined) {
      return fail('invalid_engine_service', id, 'Ячейка не допускает сервисное заполнение или слив.');
    }
    const transfer = advanceService({ capacityM3, liquidKg: old.massKg, temperatureC: old.temperatureC },
      { densityKgM3: profile.densityKgM3, cpJkgK: profile.specificHeatJkgK }, request);
    if (!transfer.ok) return transfer;
    const next = transfer.value.state;
    if (next.temperatureC === null) return fail('engine_empty_cell', id, 'Ячейка опорожнена: расчёт теплопереноса остановлен.');
    contents.set(id, { massKg: next.liquidKg, temperatureC: next.temperatureC });
    admitted.set(domain, (admitted.get(domain) ?? 0) + transfer.value.ledger.netVolumeM3);
  }
  return { ok: true, value: { admitted }, diagnostics: [] };
}

export function stagePressure(
  scenario: SimulationScenario, previous: SimulationState, fluid: SimulationState['fluid'],
  hydraulics: HydraulicSnapshot, cellDomains: CellDomains, admitted: ReadonlyMap<string, number>,
): Result<Snapshot> {
  let health: Snapshot['health'] = 'normal', pressureReliefJ = 0;
  const pressure: Record<string, EnginePressureState> = Object.create(null) as Record<string, EnginePressureState>;
  const diagnostics: Diagnostic[] = [];
  const inventory = new Map(Object.entries(fluid.cells));
  const pressurePa = { ...hydraulics.pressurePa };
  for (const binding of scenario.pressure ?? []) {
    const domain = scenario.system.hydraulicDomains.find((entry) => entry.id === binding.domainId)!;
    const cells = [...cellDomains].filter(([, id]) => id === binding.domainId).map(([id]) => id);
    const massKg = cells.reduce((m, id) => m + inventory.get(id)!.massKg, 0);
    const meanC = cells.reduce((sum, id) => {
      const cell = inventory.get(id)!; return sum + cell.massKg * cell.temperatureC / massKg;
    }, 0);
    const r = advancePressure({ ...binding.profile, seconds: 1,
      priorNetVolumeM3: previous.pressure[binding.domainId]?.netServiceVolumeM3 ?? 0,
      admittedVolumeM3: admitted.get(binding.domainId) ?? 0, meanC,
      densityKgM3: domain.fluid.densityKgM3, cpJkgK: domain.fluid.specificHeatJkgK });
    if (!r.ok) return r;
    const data = r.value;
    pressure[binding.domainId] = data;
    diagnostics.push(...r.diagnostics.map((diagnostic) => ({ ...diagnostic, path: `${binding.domainId}.pressure` })));
    if (data.status === 'stopped') health = 'stopped';
    else if (data.status === 'restricted' && health !== 'stopped') health = 'restricted';
    for (const nodeId of domain.nodeIds) {
      const original = pressurePa[nodeId];
      const adjusted = data.gaugePa === null || original === null || original === undefined ? null :
        original + data.gaugePa - domain.pressureAtReferencePa;
      if (adjusted !== null && !Number.isFinite(adjusted)) return fail('engine_pressure_overflow', nodeId, 'Невозможно опубликовать давление.');
      pressurePa[nodeId] = adjusted;
    }

    const lost = data.relief.dischargedKg ?? 0;
    if (lost > 0) {
      if (lost >= massKg) return fail('engine_relief_inventory', domain.id, 'Вычисленный сброс исчерпал теплоноситель: шаг не принят.');
      // Boyle module uses the domain mean; proportional withdrawal preserves exactly that enthalpy.
      for (const id of cells) {
        const cell = inventory.get(id)!;
        inventory.set(id, { ...cell, massKg: cell.massKg * (1 - lost / massKg) });
      }
      pressureReliefJ += data.relief.dischargedJ ?? 0;
    }
  }
  return { ok: true, value: { health, pressure, pressureReliefJ, hydraulics: { ...hydraulics, pressurePa },
    fluid: { ...fluid, cells: Object.fromEntries(inventory) } }, diagnostics };
}
