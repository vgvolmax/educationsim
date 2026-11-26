import { expect, test } from 'vitest';
import { openSimulation } from '../../src/simulation/engine';
import type { SimulationScenario } from '../../src/simulation/engine';
import { scenario } from '../fixtures/simulation-engine';

function open(s: SimulationScenario) {
  const r = openSimulation(s);
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  return r.value;
}

test('executes real B01–B06 models in one deterministic second with two balanced loops', () => {
  const config = scenario();
  const runtime = open(config);
  const initial = runtime.initial();
  const r = runtime.step(initial, [{ kind: 'manual', actuatorId: 'drive', demand: true }]);
  expect(r, JSON.stringify(r.diagnostics)).toMatchObject({ ok: true });
  if (!r.ok) return;
  expect(r.value).toMatchObject({ tick: 1, projectId: config.system.projectId, projectRevision: config.system.projectRevision });
  expect(r.value.hydraulics!.channels['link:pipe-a']!.flowM3s).toBeGreaterThan(0);
  expect(r.value.hydraulics!.channels['link:pipe-a']!.flowM3s).toBeCloseTo(r.value.hydraulics!.channels['link:pipe-b']!.flowM3s, 10);
  expect(r.value.fluid.cells['component:source:source']!.temperatureC).toBeGreaterThan(20);
  expect(r.value.control!.actuators.drive).toMatchObject({ requested: true, permitted: true, opening: .5 });
  expect(initial.fluid.cells['component:source:source']!.temperatureC).toBe(20);
  expect(initial.tick).toBe(0);
});
test('overheat from previous snapshot blocks requested heat at the next tick', () => {
  const config = scenario();
  config.fluid.cells['component:source:source']!.temperatureC = 55;
  const runtime = open(config);
  const r = runtime.step(runtime.initial(), [{ kind: 'manual', actuatorId: 'drive', demand: true }]);
  expect(r).toMatchObject({ ok: true, value: { tick: 1, control: { actuators: { drive: {
    requested: true, commandOpen: false, permitted: false,
  } } }, sources: { source: { powerW: 0, reason: 'blocked' } } } });
});
test('an invalid command or foreign or stale project cannot advance the snapshot', () => {
  const runtime = open(scenario()), initial = runtime.initial();
  expect(runtime.step(initial, [{ kind: 'manual', actuatorId: 'unknown', demand: true }]))
    .toMatchObject({ ok: false, diagnostics: [{ code: 'invalid_engine_command' }] });
  expect(runtime.step({ ...initial, projectRevision: initial.projectRevision + 1 }, []))
    .toMatchObject({ ok: false, diagnostics: [{ code: 'stale_engine_state' }] });
  expect(initial.tick).toBe(0);
});

test('power loss removes the pressure drive as well as the heat command', () => {
  const runtime = open(scenario());
  const on = runtime.step(runtime.initial(), [{ kind: 'manual', actuatorId: 'drive', demand: true }]);
  if (!on.ok) throw new Error('Initial tick failed');
  const off = runtime.step(on.value, [{ kind: 'power', powered: false }]);
  expect(off).toMatchObject({ ok: true, value: {
    powered: false, tick: 2, sources: { source: { powerW: 0 } },
    hydraulics: { channels: { 'link:pipe-a': { flowM3s: 0 } } },
  } });
});

test('applies one service transfer and one bounded pressure-relief withdrawal without inventing energy', () => {
  const cfg = scenario();
  const cell = 'component:source:source';
  const domainId = cfg.system.hydraulicDomains[0]!.id;
  cfg.serviceCapacityM3ByCell = { [cell]: .004 };
  cfg.pressure = [{
    domainId,
    profile: { referenceLiquidM3: .005, referenceC: 20, expansionPerK: .0003, atmosphericPa: 100000,
      referenceGaugePa: 100000, tank: { gasAtReferenceM3: .008, minimumGasM3: .001, maximumGasM3: .010 },
      relief: { opensGaugePa: 150000, ratedMaxM3s: .001 } },
  }];
  const runtime = open(cfg);
  const result = runtime.step(runtime.initial(), [{ kind: 'service', cellId: cell, fillKg: 2, fillC: 20, drainKg: 0 }]);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.value.health).toBe('restricted');
  expect(result.value.pressure[domainId]!.gaugePa).toBeCloseTo(150000, 6);
  expect(result.value.pressure[domainId]!.relief.dischargedKg).toBeCloseTo(.4, 8);
  expect(Object.values(result.value.fluid.cells).reduce((a, b) => a + b.massKg, 0)).toBeCloseTo(6.6, 8);
  expect(result.value.energy!.makeupJ).toBeCloseTo(2 * 4180 * 20, 7);
  expect(result.value.pressureReliefJ).toBeCloseTo(.4 * 4180 * 20, 7);
});
test('a pressure boundary stops the engine and hides pressures from the unsupported domain', () => {
  const cfg = scenario();
  const cell = 'component:source:source', domain = cfg.system.hydraulicDomains[0]!;
  cfg.serviceCapacityM3ByCell = { [cell]: .004 };
  cfg.pressure = [{ domainId: domain.id, profile: {
    referenceLiquidM3: .005, referenceC: 20, expansionPerK: .0003, atmosphericPa: 100000, referenceGaugePa: 100000,
  } }];
  const runtime = open(cfg);
  const state = runtime.step(runtime.initial(), [{ kind: 'service', cellId: cell, fillKg: 1, fillC: 20, drainKg: 0 }]);
  expect(state).toMatchObject({ ok: true, value: { health: 'stopped', pressure: { [domain.id]: { gaugePa: null } } } });
  if (!state.ok) return;
  expect(Object.values(state.value.hydraulics!.pressurePa).every((x) => x === null)).toBe(true);
  expect(runtime.step(state.value, [])).toMatchObject({ ok: false, diagnostics: [{ code: 'stopped_engine' }] });
});
