import { expect, test } from 'vitest';
import { resolveFluid } from '../../src/simulation/fluids';
import { solveHydraulics } from '../../src/simulation/hydraulics';
import type { HydraulicInputs, HydraulicSnapshot } from '../../src/simulation/hydraulics';
import type { CompiledSystem, HydraulicChannel } from '../../src/simulation/types';

const lpm = (v: number) => v / 60_000;
const pa = (v: number) => 1000 * v;
const r = (kpa: number) => ({ quadraticPaPerM3s2: pa(kpa) / lpm(1) ** 2 });
const pumpPoints = [{ flowM3s: 0, headPa: 30_000 }, { flowM3s: lpm(6), headPa: 0 }];
function system(backwards = false, mixing = false): CompiledSystem {
  const nodes = ['low', 'high', ...(mixing ? ['inlet'] : [])];
  const pipe = (id: string, from: string, to: string): HydraulicChannel => ({
    id, from, to, domainId: 'network', kind: 'pipe', enabled: true, lengthM: 1,
    diameterM: .012, localLossCoefficient: 0, lengthSource: 'link-route', origin: { linkId: id },
  });
  const channels: HydraulicChannel[] = [
    { id: 'pump', from: 'low', to: 'high', kind: 'pump', enabled: true, origin: {}, domainId: 'network' },
    pipe('loop', 'high', 'low'), pipe('valve', backwards ? 'low' : 'high', mixing ? 'inlet' : backwards ? 'high' : 'low'),
    ...(mixing ? [pipe('mix-second', 'low', 'inlet'), pipe('mix-return', 'inlet', 'low')] : []),
  ];
  return {
    projectId: 'test', projectRevision: 0, initialWaterC: 20, components: [],
    nodes: nodes.map((id) => ({ id, componentId: id, elevationM: 0, ports: [] })),
    hydraulicChannels: channels, hydraulicDomains: [
      { id: 'network', nodeIds: nodes, channelIds: channels.map(({ id }) => id), activity: 'driven', flowConstraint: 'solve',
        referenceNodeId: 'low', pressureAtReferencePa: 100_000, fluid: resolveFluid('water')! },
    ], thermalLinks: [], thermalRooms: [], controlLinks: [],
  };
}
const inputs = (target = 15): HydraulicInputs => ({
  pumps: { pump: { mode: 'constant-pressure', targetPa: pa(target), points: pumpPoints } },
  resistance: { loop: r(100), valve: r(20), 'mix-second': r(20), 'mix-return': r(20) },
});
function snapshot(s: CompiledSystem, i: HydraulicInputs): HydraulicSnapshot {
  const result = solveHydraulics(s, i);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}
test('check_valve_blocks_reverse_flow', () => {
  const reverse = snapshot(system(true), { ...inputs(), valves: { valve: { kind: 'check' } } });
  expect(reverse.channels.valve).toMatchObject({ flowM3s: 0, valve: { status: 'blocked' } });
  const forward = snapshot(system(true), { ...inputs(), valves: { valve: { kind: 'check', orientation: 'reverse' } } });
  expect(forward.channels.valve!.flowM3s).toBeLessThan(0);
});
test('bypass_only_opens_above_threshold in the same pressure and flow solve', () => {
  const valves = { valve: { kind: 'bypass' as const, opensPa: pa(20), closesPa: pa(16) } };
  expect(snapshot(system(), { ...inputs(15), valves }).channels.valve).toMatchObject({ flowM3s: 0, valve: { status: 'blocked' } });
  const high = snapshot(system(), { ...inputs(25), valves });
  expect(high.channels.valve?.valve?.status).toBe('open');
  expect(high.channels.valve!.flowM3s / lpm(1)).toBeCloseTo(.5, 2);
  expect(high.channels.pump!.flowM3s).toBeCloseTo(high.channels.valve!.flowM3s + high.channels.loop!.flowM3s, 10);
  const hysteresis = snapshot(system(), {
    ...inputs(18), valves: { valve: { ...valves.valve, previouslyOpen: true } },
  });
  expect(hysteresis.channels.valve?.valve?.status).toBe('open');
});
test('zero_flow_when_closed, proportional openings and dirty filters reduce flow', () => {
  const original = snapshot(system(), inputs()).channels.valve!.flowM3s;
  const zero = snapshot(system(), { ...inputs(), valves: { valve: { kind: 'zone', opening: 0 } } });
  expect(zero.channels.valve).toMatchObject({ flowM3s: 0, state: 'closed', valve: { status: 'closed' } });
  const half = snapshot(system(), { ...inputs(), valves: { valve: { kind: 'balance', opening: .5 } } });
  expect(half.channels.valve!.flowM3s / original).toBeCloseTo(.5, 2);
  const dirty = snapshot(system(), { ...inputs(), valves: { valve: { kind: 'filter', loading: 1, maxLossMultiplier: 4 } } });
  expect(dirty.channels.valve!.flowM3s / original).toBeCloseTo(.5, 2);
});
test('dynamic_regulator_respects_working_range', () => {
  const valves = { valve: { kind: 'regulator' as const, flowM3s: lpm(.35), minPa: pa(10), maxPa: pa(20) } };
  const regulated = snapshot(system(), { ...inputs(15), valves }).channels.valve!;
  expect(regulated.flowM3s / lpm(1)).toBeCloseTo(.35, 3);
  expect(regulated.valve?.status).toBe('regulated');
  const limited = snapshot(system(), { ...inputs(5), valves }).channels.valve!;
  expect(limited.flowM3s / lpm(1)).toBeCloseTo(.35 * Math.sqrt(.5), 3);
  expect(limited.valve?.status).toBe('below-range');
  const outside = snapshot(system(), { ...inputs(25), valves }).channels.valve!;
  expect(outside.valve?.status).toBe('above-range');
});
test('three-way position works on two declared branches with a common junction', () => {
  const mixed = snapshot(system(false, true), { ...inputs(), mixingValves: [{ first: 'valve', second: 'mix-second', position: 1 }] });
  expect(mixed.channels.valve?.valve).toMatchObject({ kind: 'three-way', status: 'open' });
  expect(mixed.channels['mix-second']).toMatchObject({ state: 'closed', flowM3s: 0, valve: { kind: 'three-way', status: 'closed' } });
  expect(solveHydraulics(system(), { ...inputs(), mixingValves: [{ first: 'valve', second: 'loop', position: 1 }] })).toMatchObject({ ok: false, diagnostics: [{ code: 'invalid_mixing_topology' }] });
});
test('nonconverging_network_returns_diagnostic and invalid profiles do not silently pass', () => {
  const valves = { valve: { kind: 'bypass' as const, opensPa: pa(20) } };
  expect(solveHydraulics(system(), { ...inputs(25), valves, maxIterations: 0 })).toMatchObject({
    ok: false, diagnostics: [{ code: 'hydraulics_nonconvergent' }],
  });
  expect(solveHydraulics(system(), { ...inputs(), valves: { valve: { kind: 'filter', loading: -1, maxLossMultiplier: 4 } } })).toMatchObject({
    ok: false, diagnostics: [{ code: 'invalid_valve_profile' }],
  });
});

test('a seated directional valve does not create a pressure reference across itself', () => {
  const s = system();
  s.nodes.push({ id: 'blind', componentId: 'blind', elevationM: 0, ports: [] });
  s.hydraulicDomains[0]!.nodeIds.push('blind');
  s.hydraulicChannels.find(({ id }) => id === 'valve')!.to = 'blind';
  const result = solveHydraulics(s, { ...inputs(), valves: { valve: { kind: 'check', crackingPa: 2000 } } });
  expect(result).toMatchObject({
    ok: true, value: { pressurePa: { blind: null }, channels: { valve: { flowM3s: 0, potentialDropPa: null, valve: { status: 'blocked' } } } },
  });
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'unreferenced_island', path: 'blind' }));
});
