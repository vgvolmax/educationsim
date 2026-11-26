import { expect, test } from 'vitest';
import { applyControlFaults, applyHydraulicFaults, applyJammedActuators, advanceFaults, emptyFaultState } from '../../src/simulation/faults';
import { advanceControls, compileControls } from '../../src/simulation/controls';
import type { ControlInput } from '../../src/simulation/controls';

const targets = { channels: ['pipe'], sensors: ['probe'], actuators: ['drive'] };
test('trapped_air_and_dirty_filter_recover_after_service', () => {
  const start = emptyFaultState();
  const damage = advanceFaults(start, targets, [
    { kind: 'air', id: 'pipe', extent: .5 }, { kind: 'filter', id: 'pipe', extent: 1 },
  ]);
  if (!damage.ok) throw new Error('Cannot model faults');
  expect(applyHydraulicFaults({ resistance: {}, fixedDarcyFactors: { pipe: .02 } }, damage.value))
    .toMatchObject({ resistanceMultipliers: { pipe: 10 }, fixedDarcyFactors: { pipe: .02 } });
  const full = advanceFaults(damage.value, targets, [{ kind: 'air', id: 'pipe', extent: 1 }]);
  if (!full.ok) throw new Error('Cannot block branch');
  expect(applyHydraulicFaults({ resistance: {} }, full.value).closedChannels).toContain('pipe');
  const fixed = advanceFaults(full.value, targets, [{ kind: 'vent', id: 'pipe' }, { kind: 'clean', id: 'pipe' }]);
  if (!fixed.ok) throw new Error('Cannot recover');
  expect(applyHydraulicFaults({ resistance: {} }, fixed.value).resistanceMultipliers).toEqual({});
  expect(applyHydraulicFaults({ resistance: {} }, fixed.value).closedChannels).toEqual([]);
  expect(start).toEqual(emptyFaultState());
});

test('high_limit_disables_target_next_tick and latched_limit_requires_reset_after_condition_clears', () => {
  const g = compileControls([
    { id: 'sensor', kind: 'sensor', sampleId: 'probe', measurement: 'supply', maxAgeTicks: 1 },
    { id: 'limit', kind: 'high-limit', limitC: 45, hysteresisC: 2, latching: true },
    { id: 'drive', kind: 'actuator', normally: 'NC', travelSeconds: 1, wantsLimiter: true },
  ], [
    { id: 's1', from: 'sensor', to: 'limit', port: 'temperature' },
    { id: 's2', from: 'limit', to: 'drive', port: 'permit' },
  ]);
  if (!g.ok) throw new Error('Invalid test control network');
  const input: ControlInput = { tick: 1, seconds: 1, powered: true,
    samples: { probe: { tick: 0, celsius: 41 } }, manualDemand: { drive: true }, sourceAvailable: { drive: true } };
  const initial = advanceControls(g.value, input);
  if (!initial.ok) throw new Error('Initial tick failed');
  expect(initial.value.actuators.drive!.commandOpen).toBe(true);
  const next = advanceControls(g.value, { ...input, tick: 2, previous: initial.value, samples: { probe: { tick: 1, celsius: 50 } } });
  if (!next.ok) throw new Error('Next tick failed');
  expect(next.value.actuators.drive!.commandOpen).toBe(false);
  const cooled = advanceControls(g.value, { ...input, tick: 3, previous: next.value, samples: { probe: { tick: 2, celsius: 41 } } });
  if (!cooled.ok) throw new Error('Recovery tick failed');
  expect(cooled.value.actuators.drive!.commandOpen).toBe(false);

  const failure = advanceFaults(emptyFaultState(), targets, [{ kind: 'sensor-failure', id: 'probe' }, { kind: 'jam', id: 'drive', opening: .4 }]);
  if (!failure.ok) throw new Error('Fault tick failed');
  const faultInput: ControlInput = { ...input, tick: 4, previous: cooled.value, samples: { probe: { tick: 3, celsius: 40 } }, reset: ['limit'] };
  const blocked = advanceControls(g.value, applyControlFaults(faultInput, failure.value));
  if (!blocked.ok) throw new Error('Fault protection failed');
  expect(applyJammedActuators(blocked.value, failure.value).actuators.drive).toMatchObject({ opening: .4, commandOpen: false, heatEffective: false });
  const cleared = advanceFaults(failure.value, targets, [{ kind: 'sensor-repair', id: 'probe' }, { kind: 'unjam', id: 'drive' }]);
  if (!cleared.ok) throw new Error('Recovery failed');
  const restored = advanceControls(g.value, applyControlFaults({ ...faultInput, tick: 5, previous: blocked.value, samples: { probe: { tick: 4, celsius: 40 } } }, cleared.value));
  if (!restored.ok) throw new Error('Reset failed');
  expect(restored.value.actuators.drive!.commandOpen).toBe(true);
});

test('the same hydraulic loop loses flow with damage and recovers after clearing it', async () => {
  const [{ solveHydraulics }, { compileProject }, { parseProject }, { trainingRegistry }, { default: direct }] = await Promise.all([
    import('../../src/simulation/hydraulics'), import('../../src/simulation/compile'),
    import('../../src/project/document'), import('../../src/project/registry'), import('../fixtures/projects/direct-small.json'),
  ]);
  const p = parseProject(direct);
  if (!p.ok) throw new Error('Bad project fixture');
  const c = compileProject(p.value, trainingRegistry);
  if (!c.ok) throw new Error('Bad compiled fixture');
  const inputs = {
    resistance: {}, fixedDarcyFactors: Object.fromEntries(c.value.hydraulicChannels.filter((channel) => channel.kind === 'pipe').map(({ id }) => [id, .035])),
    pumps: { 'component:source:source': { mode: 'fixed-speed' as const, points: [
      { flowM3s: 0, headPa: 30000 }, { flowM3s: .0001, headPa: 0 },
    ] } },
  };
  const check = (faults: ReturnType<typeof emptyFaultState>) => {
    const s = solveHydraulics(c.value, applyHydraulicFaults(inputs, faults));
    if (!s.ok) throw new Error(JSON.stringify(s.diagnostics));
    return s.value.channels['link:pipe-a']!.flowM3s;
  };
  const normal = check(emptyFaultState());
  const allowed = { ...targets, channels: ['link:pipe-a'] };
  const jammed = advanceFaults(emptyFaultState(), allowed, [{ kind: 'filter', id: 'link:pipe-a', extent: 1 }]);
  if (!jammed.ok) throw new Error('Fault command rejected');
  expect(check(jammed.value)).toBeLessThan(normal);
  const recovered = advanceFaults(jammed.value, allowed, [{ kind: 'clean', id: 'link:pipe-a' }]);
  if (!recovered.ok) throw new Error('Recovery command rejected');
  expect(check(recovered.value)).toBeCloseTo(normal, 12);
});
