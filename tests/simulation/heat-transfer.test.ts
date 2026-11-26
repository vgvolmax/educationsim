import { expect, test } from 'vitest';
import { advanceFluidTemperatures } from '../../src/simulation/heat-transfer';
import type { FluidThermalInput, FluidThermalState } from '../../src/simulation/heat-transfer';
import type { HydraulicSnapshot } from '../../src/simulation/hydraulics';
import type { CompiledSystem, HydraulicChannel } from '../../src/simulation/types';
import { resolveFluid } from '../../src/simulation/fluids';

const water = resolveFluid('water')!, pg = resolveFluid('propylene-glycol', .3)!;
const tube = (id: string, domainId: string, from: string, to: string): HydraulicChannel => ({
  id, domainId, from, to, kind: 'pipe', enabled: true, origin: { linkId: id },
  lengthM: 1, diameterM: .01, localLossCoefficient: 0, lengthSource: 'link-route',
});
function fixture(channels: HydraulicChannel[], flows: Record<string, number>, temperatures: Record<string, { massKg: number; temperatureC: number }>): FluidThermalInput {
  const nodes = [...new Set(channels.flatMap((c) => [c.from, c.to]))];
  const system: CompiledSystem = {
    projectId: 'thermal', projectRevision: 1, initialWaterC: 20, components: [],
    nodes: nodes.map((id) => ({ id, componentId: id, elevationM: 0, ports: [] })),
    hydraulicChannels: channels, thermalLinks: [], thermalRooms: [], controlLinks: [],
    hydraulicDomains: [...new Set(channels.map((c) => c.domainId))].map((id) => {
      const members = channels.filter((c) => c.domainId === id);
      return { id, channelIds: members.map((c) => c.id), nodeIds: [...new Set(members.flatMap((c) => [c.from, c.to]))],
        activity: 'driven', flowConstraint: 'solve', referenceNodeId: members[0]!.from,
        pressureAtReferencePa: 100000, fluid: id === 'glycol' ? pg : water };
    }),
  };
  const hydraulics: HydraulicSnapshot = {
    projectId: system.projectId, projectRevision: 1, pressurePa: {}, flowResidualM3s: {},
    channels: Object.fromEntries(channels.map(({ id }) => [id, {
      flowM3s: flows[id] ?? 0, state: 'open', direction: flows[id] === 0 ? 'none' : (flows[id] ?? 0) < 0 ? 'reverse' : 'forward',
      origin: {}, potentialDropPa: null,
    }])),
  };
  return { system, hydraulics, seconds: 1, state: { cells: temperatures } };
}
function recheck(input: FluidThermalInput): FluidThermalState {
  const r = advanceFluidTemperatures(input);
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  return r.value;
}
test('zero_flow_stops_advective_heat_but_allows_residual_heat', () => {
  const p = fixture([tube('rad', 'water', 'a', 'b')], {}, { rad: { massKg: 1, temperatureC: 60 } });
  const r = recheck({ ...p, sinks: [{ cellId: 'rad', kind: 'radiator', uaWPerK: 10, ambientC: 20 }] });
  expect(r.advectiveJ.rad).toBe(0);
  expect(r.cells.rad!.temperatureC).toBeLessThan(60);
  expect(r.energy.radiatorLossJ).toBeCloseTo(400, 5);
  expect(r.energy.residualJ).toBeCloseTo(0, 8);
  expect(p.state.cells.rad!.temperatureC).toBe(60);
});
test('exchanger_conserves_heat_with_isolated_fluids and matches independent transient solution', () => {
  const p = fixture([tube('hot', 'water', 'a', 'b'), tube('cold', 'glycol', 'c', 'd')], {},
    { hot: { massKg: 1000 / 4180, temperatureC: 60 }, cold: { massKg: 500 / 3960, temperatureC: 20 } });
  p.system.thermalLinks.push({ kind: 'heat-exchanger', componentId: 'hx', primaryChannelId: 'hot', secondaryChannelId: 'cold', uaWPerK: 20 });
  const r = recheck({ ...p, seconds: 10 });
  expect(Math.abs(r.cells.hot!.temperatureC - 53.984155)).toBeLessThan(.05);
  expect(Math.abs(r.cells.cold!.temperatureC - 32.031690)).toBeLessThan(.08);
  expect(r.cells.hot!.massKg).toBe(p.state.cells.hot!.massKg);
  expect(r.cells.cold!.massKg).toBe(p.state.cells.cold!.massKg);
  expect(r.fluidProfileByCell.hot).toBe(water.id);
  expect(r.fluidProfileByCell.cold).toBe(pg.id);
  expect(Math.abs((60 - r.cells.hot!.temperatureC) * 1000 - (r.cells.cold!.temperatureC - 20) * 500)).toBeLessThan(1e-7);
  expect(r.energy.residualJ).toBeCloseTo(0, 7);
});
test('buffer_accumulates_and_loses_heat as one explicit same-domain storage cell', () => {
  const p = fixture([tube('first', 'water', 'a', 'b'), tube('second', 'water', 'b', 'a')], {},
    { tank: { massKg: 10, temperatureC: 20 } });
  const heated = recheck({ ...p, storage: [{ id: 'tank', kind: 'buffer', channelIds: ['first', 'second'] }],
    sources: [{ cellId: 'tank', powerW: 4180 }] });
  expect(heated.cells.tank!.temperatureC).toBeCloseTo(20.1, 10);
  const cooled = recheck({ ...p, state: heated, storage: [{ id: 'tank', kind: 'hydraulic-separator', channelIds: ['first', 'second'] }],
    sinks: [{ cellId: 'tank', kind: 'ambient', ambientC: 10, uaWPerK: 100 }] });
  expect(cooled.cells.tank!.temperatureC).toBeLessThan(20.1);
  expect(cooled.energy.ambientLossJ).toBeGreaterThan(0);
  expect(cooled.energy.residualJ).toBeCloseTo(0, 7);
});
test('global_energy_ledger_matches_v09 with distinct heater, loss, makeup, and drain terms', () => {
  const p = fixture([tube('tank', 'water', 'a', 'b')], {}, { tank: { massKg: 10, temperatureC: 40 } });
  const r = recheck({ ...p, sources: [{ cellId: 'tank', powerW: 500 }], sinks: [{ cellId: 'tank', kind: 'ambient', ambientC: 20, uaWPerK: 10 }],
    service: [{ cellId: 'tank', fillKg: 1, fillC: 10, drainKg: 2 }] });
  expect(r.cells.tank!.massKg).toBe(9);
  expect(r.energy.sourceJ).toBe(500);
  expect(r.energy.makeupJ).toBe(41800);
  expect(r.energy.drainJ).toBe(334400);
  expect(r.energy.ambientLossJ).toBeCloseTo(166.666667, 4);
  expect(r.energy.residualJ).toBeCloseTo(0, 8);
});
test('flow direction selects the upwind node; stale or nonconservative snapshots stop the step', () => {
  const edges = [tube('a', 'water', 'n1', 'n2'), tube('b', 'water', 'n2', 'n3'), tube('c', 'water', 'n3', 'n1')];
  const cells = { a: { massKg: 1, temperatureC: 60 }, b: { massKg: 1, temperatureC: 30 }, c: { massKg: 1, temperatureC: 10 } };
  const forward = recheck(fixture(edges, { a: .00001, b: .00001, c: .00001 }, cells));
  const reverse = recheck(fixture(edges, { a: -.00001, b: -.00001, c: -.00001 }, cells));
  expect(forward.cells.b!.temperatureC).toBeGreaterThan(30);
  expect(reverse.cells.b!.temperatureC).toBeLessThan(30);
  expect(forward.energy.residualJ).toBeCloseTo(0, 7);
  expect(reverse.energy.residualJ).toBeCloseTo(0, 7);
  const broken = fixture(edges, { a: .00001, b: .00001 }, cells);
  expect(advanceFluidTemperatures(broken)).toMatchObject({ ok: false, diagnostics: [{ code: 'unbalanced_thermal_flow' }] });
  const foreign = { ...broken, hydraulics: { ...broken.hydraulics, projectId: 'other', projectRevision: 1 } };
  expect(advanceFluidTemperatures(foreign)).toMatchObject({ ok: false, diagnostics: [{ code: 'stale_hydraulics' }] });
  broken.hydraulics.projectRevision = 0;
  expect(advanceFluidTemperatures(broken)).toMatchObject({ ok: false, diagnostics: [{ code: 'stale_hydraulics' }] });
});

test('true B02 output can advance a revision-bound B01 project without losing energy', async () => {
  const [{ solveHydraulics }, { compileProject }, { trainingRegistry }, { parseProject }, { default: direct }] = await Promise.all([
    import('../../src/simulation/hydraulics'), import('../../src/simulation/compile'),
    import('../../src/project/registry'), import('../../src/project/document'), import('../fixtures/projects/direct-small.json'),
  ]);
  const p = parseProject(direct);
  if (!p.ok) throw new Error('Bad project fixture');
  const c = compileProject(p.value, trainingRegistry);
  if (!c.ok) throw new Error('Bad compiled fixture');
  const channels = c.value.hydraulicChannels;
  const hydraulics = solveHydraulics(c.value, {
    resistance: {}, fixedDarcyFactors: Object.fromEntries(channels.filter((channel) => channel.kind === 'pipe').map(({ id }) => [id, .035])),
    pumps: { 'component:source:source': { mode: 'fixed-speed', points: [
      { flowM3s: 0, headPa: 30000 }, { flowM3s: .0001, headPa: 0 },
    ] } },
  });
  if (!hydraulics.ok) throw new Error('Bad hydraulics fixture');
  const cells = Object.fromEntries(channels.map(({ id }) => [id, { massKg: 1, temperatureC: id === 'component:source:source' ? 50 : 20 }]));
  const r = recheck({ system: c.value, hydraulics: hydraulics.value, state: { cells }, seconds: 1 });
  expect(r.cells['link:supply']!.temperatureC).toBeGreaterThan(20);
  expect(r.cells['component:source:source']!.temperatureC).toBeLessThan(50);
  expect(r.energy.residualJ).toBeCloseTo(0, 7);
});
test('rejects cross-domain storage and excessive substepping rather than giving a fake update', () => {
  const p = fixture([tube('a', 'water', 'a1', 'a2'), tube('b', 'glycol', 'b1', 'b2')], {},
    { a: { massKg: 1, temperatureC: 60 }, b: { massKg: 1, temperatureC: 20 } });
  expect(advanceFluidTemperatures({ ...p, storage: [{ id: 'invalid', kind: 'hydraulic-separator', channelIds: ['a', 'b'] }] }))
    .toMatchObject({ ok: false, diagnostics: [{ code: 'invalid_storage' }] });
  expect(advanceFluidTemperatures({ ...p, sinks: [{ cellId: 'a', ambientC: 20, kind: 'ambient', uaWPerK: 1e9 }] }))
    .toMatchObject({ ok: false, diagnostics: [{ code: 'thermal_step_budget' }] });
});
