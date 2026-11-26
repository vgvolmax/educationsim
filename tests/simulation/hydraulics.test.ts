import { expect, test } from 'vitest';
import { resolveFluid } from '../../src/simulation/fluids';
import { solveHydraulics } from '../../src/simulation/hydraulics';
import type { HydraulicInputs, HydraulicSnapshot } from '../../src/simulation/hydraulics';
import type { CompiledSystem, HydraulicChannel, HydraulicNode } from '../../src/simulation/types';

const lpm = (value: number) => value / 60_000;
const pressure = (kPa: number) => kPa * 1000;
const ramp = [{ flowM3s: lpm(0), headPa: pressure(30) }, { flowM3s: lpm(6), headPa: 0 }];
const resist = (kPaAtOne: number) => ({ quadraticPaPerM3s2: pressure(kPaAtOne) / lpm(1) ** 2 });
const nodes = (ids: string[]): HydraulicNode[] => ids.map((id) => ({ id, elevationM: 0, componentId: id, ports: [] }));
const edge = (id: string, from: string, to: string, kind: 'pipe' | 'pump' = 'pipe'): HydraulicChannel => ({
  id, from, to, kind, domainId: 'circuit', enabled: true, origin: { linkId: id },
  ...(kind === 'pipe' ? { lengthM: 1, diameterM: .012, localLossCoefficient: 0, lengthSource: 'link-route' as const } : {}),
}) as HydraulicChannel;

function circuit(channels: HydraulicChannel[], ns = nodes(['return', 'supply'])): CompiledSystem {
  return {
    projectId: 'test', projectRevision: 5, initialWaterC: 20, components: [], nodes: ns,
    hydraulicChannels: channels,
    hydraulicDomains: [{
      id: 'circuit', nodeIds: ns.map((node) => node.id), channelIds: channels.map((channel) => channel.id),
      activity: 'driven', flowConstraint: 'solve', referenceNodeId: 'return', pressureAtReferencePa: pressure(100),
      fluid: resolveFluid('water')!,
    }],
    thermalLinks: [], thermalRooms: [], controlLinks: [],
  };
}
function value(system: CompiledSystem, inputs: HydraulicInputs): HydraulicSnapshot {
  const result = solveHydraulics(system, inputs);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}
function flow(snapshot: HydraulicSnapshot, id: string, expected: number) {
  expect(Math.abs(snapshot.channels[id]!.flowM3s - lpm(expected))).toBeLessThan(lpm(.02));
}
function head(snapshot: HydraulicSnapshot, id: string, expected: number) {
  expect(Math.abs(snapshot.channels[id]!.pump!.headPa - pressure(expected))).toBeLessThan(150);
}

test('parallel_equal_and_unequal_match_v01_v02', () => {
  const system = circuit([edge('pump', 'return', 'supply', 'pump'), edge('a', 'supply', 'return'), edge('b', 'supply', 'return')]);
  const pumps = { pump: { mode: 'constant-pressure' as const, points: ramp, targetPa: pressure(15) } };
  const equal = value(system, { pumps, resistance: { a: resist(15), b: resist(15) } });
  flow(equal, 'a', 1); flow(equal, 'b', 1); flow(equal, 'pump', 2);
  const unequal = value(system, { pumps, resistance: { a: resist(15), b: resist(60) } });
  flow(unequal, 'a', 1); flow(unequal, 'b', .5); flow(unequal, 'pump', 1.5);
});

test('pump_intersection_matches_closed_form and v10_pump_saturates_at_2_lpm_and_20_kpa', () => {
  const system = circuit([edge('pump', 'return', 'supply', 'pump'), edge('loop', 'supply', 'return')]);
  const resistance = { loop: resist(5) };
  const fixed = value(system, { pumps: { pump: { mode: 'fixed-speed', points: ramp } }, resistance });
  flow(fixed, 'pump', 2); head(fixed, 'pump', 20);
  const saturated = value(system, { pumps: { pump: { mode: 'constant-pressure', points: ramp, targetPa: pressure(30) } }, resistance });
  flow(saturated, 'pump', 2); head(saturated, 'pump', 20);
  expect(saturated.channels.pump?.pump?.status).toBe('saturated');
});

test('v10_closed_network_keeps_shutoff_head', () => {
  const system = circuit([edge('pump', 'return', 'supply', 'pump'), edge('closed', 'supply', 'return')]);
  const snapshot = value(system, {
    pumps: { pump: { mode: 'fixed-speed', points: ramp } }, resistance: {}, closedChannels: ['closed'],
  });
  flow(snapshot, 'pump', 0); flow(snapshot, 'closed', 0); head(snapshot, 'pump', 30);
  expect(snapshot.channels.pump?.pump?.status).toBe('shutoff');
});

test('v10_off_pump_allows_only_compatible_passive_flow', () => {
  const system = circuit([edge('on', 'return', 'supply', 'pump'), edge('off', 'return', 'supply', 'pump'), edge('loop', 'supply', 'return')]);
  const pumps = { on: { mode: 'fixed-speed' as const, points: ramp }, off: { mode: 'off' as const } };
  const resistance = { loop: resist(5), off: resist(5) };
  const open = value(system, { pumps, resistance });
  expect(open.channels.off!.flowM3s).toBeLessThan(0);
  expect(open.channels.off!.direction).toBe('reverse');
  const blocked = value(system, { pumps: { ...pumps, off: { mode: 'off', blockReverse: true } }, resistance });
  expect(blocked.channels.off!.flowM3s).toBe(0);
  flow(blocked, 'loop', 2);
});

test('node_balance_matches_v09, static pressure uses p+rho*g*z', () => {
  const ns = nodes(['return', 'supply', 'split']);
  ns[2]!.elevationM = 2;
  const system = circuit([edge('pump', 'return', 'supply', 'pump'), edge('feed', 'supply', 'split'), edge('a', 'split', 'return'), edge('b', 'split', 'return')], ns);
  const snapshot = value(system, {
    pumps: { pump: { mode: 'fixed-speed', points: ramp } },
    resistance: { feed: resist(1), a: resist(5), b: resist(10) },
  });
  const q = (id: string) => snapshot.channels[id]!.flowM3s;
  expect(Math.abs(q('feed') - q('a') - q('b'))).toBeLessThan(2e-8);
  expect(Math.abs(q('pump') - q('feed'))).toBeLessThan(2e-8);
  const hydrostatic = value(circuit([edge('passive', 'return', 'split')], [ns[0]!, ns[2]!]), { resistance: { passive: resist(10) } });
  expect(hydrostatic.pressurePa.split).toBeCloseTo(100_000 - 1000 * 9.80665 * 2, 5);
});

test('disconnected_loop_has_no_forced_flow; unsupported configuration is a typed failure', () => {
  const system = circuit([edge('pump', 'return', 'supply', 'pump'), edge('loop', 'supply', 'return')]);
  const silent = { ...system, hydraulicDomains: [{ ...system.hydraulicDomains[0]!, activity: 'inactive' as const, flowConstraint: 'zero' as const }] };
  const r = value(silent, { resistance: {} });
  expect(r.channels.pump!.flowM3s).toBe(0);
  expect(r.channels.loop!.flowM3s).toBe(0);
  expect(solveHydraulics(system, { resistance: {} })).toMatchObject({ ok: false });
  const outOfCurve = solveHydraulics(system, { pumps: { pump: { mode: 'fixed-speed', points: [
    {flowM3s: 0, headPa: 30_000}, {flowM3s: lpm(1), headPa: 25_000},
  ] } }, resistance: { loop: resist(5) } });
  expect(outOfCurve).toMatchObject({ ok: false });
  if (!outOfCurve.ok) expect(outOfCurve.diagnostics.some((d) => d.code === 'pump_curve_limit')).toBe(true);
});

test('preserves conservation through an independent compiled two-loop project', async () => {
  const [{ compileProject }, { trainingRegistry }, { parseProject }, { default: direct }] = await Promise.all([
    import('../../src/simulation/compile'), import('../../src/project/registry'), import('../../src/project/document'),
    import('../fixtures/projects/direct-small.json'),
  ]);
  const project = parseProject(direct);
  if (!project.ok) throw new Error('Bad project fixture');
  const compiled = compileProject(project.value, trainingRegistry);
  if (!compiled.ok) throw new Error('Bad compiled fixture');
  const snapshot = value(compiled.value, {
    resistance: {}, pumps: { 'component:source:source': { mode: 'fixed-speed', points: ramp } },
    fixedDarcyFactors: Object.fromEntries(compiled.value.hydraulicChannels.filter((channel) => channel.kind === 'pipe').map(({ id }) => [id, .035])),
  });
  const a = snapshot.channels['link:pipe-a']!.flowM3s, b = snapshot.channels['link:pipe-b']!.flowM3s;
  expect(a).toBeGreaterThan(0);
  expect(a).toBeCloseTo(b, 10);
  expect(Math.abs(snapshot.channels['link:supply']!.flowM3s - a - b)).toBeLessThan(2e-8);
});

test('bounds nonlinear iterations and does not invent pressure for a detached segment', () => {
  const system = circuit([
    edge('pump', 'return', 'supply', 'pump'), edge('loop', 'supply', 'return'), edge('cap', 'supply', 'dead-end'),
  ], nodes(['return', 'supply', 'dead-end']));
  const inputs: HydraulicInputs = { pumps: { pump: { mode: 'fixed-speed', points: ramp } }, resistance: { loop: resist(5) }, closedChannels: ['cap'] };
  const r = solveHydraulics(system, { ...inputs, maxIterations: 0 });
  expect(r).toMatchObject({ ok: false, diagnostics: [{ code: 'hydraulics_nonconvergent' }] });
  const resolved = solveHydraulics(system, inputs);
  expect(resolved).toMatchObject({ ok: true, value: { pressurePa: { 'dead-end': null } } });
  expect(resolved.diagnostics).toContainEqual(expect.objectContaining({ code: 'unreferenced_island' }));
});

test('does not turn an ineffective tiny coefficient into a finite-looking result', () => {
  const system = circuit([edge('passive', 'supply', 'return')]);
  expect(solveHydraulics(system, { resistance: { passive: { linearPaPerM3s: Number.MIN_VALUE } } })).toMatchObject({
    ok: false, diagnostics: [{ code: 'invalid_resistance' }],
  });
});
