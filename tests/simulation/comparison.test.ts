import { expect, test } from 'vitest';
import { scenario } from '../fixtures/simulation-engine';
import { createSession } from '../../src/simulation/session';
import { captureFrame, compareCaptures } from '../../src/simulation/comparison';
import type { SimulationScenario } from '../../src/simulation/engine-types';

function run(input: SimulationScenario, close = false, ticks = 1) {
  const s = createSession(input);
  if (!s.ok) throw new Error(JSON.stringify(s.diagnostics));
  if (close) s.value.command({ kind: 'fault', command: { kind: 'air', id: 'link:pipe-a', extent: 1 } });
  for (let i = 0; i < ticks; i++) s.value.stepOnce();
  const capture = captureFrame(input, s.value.view);
  if (!capture) throw new Error('Frame absent');
  return capture;
}

test('compare_before_after_balance distinguishes measured zero from unavailable', () => {
  const input = scenario();
  const before = run(input), after = run(input, true);
  const diff = compareCaptures(before, after);
  expect(diff.sameTick).toBe(true);
  expect(diff.readings.find((r) => r.id === 'flow:link:pipe-a')).toMatchObject({ after: 0, before: expect.any(Number), delta: expect.any(Number) });
  expect(diff.readings.find((r) => r.id === 'flow:link:pipe-a')?.delta).toBeLessThan(0);
});

test('compare_two_revisions_at_same_elapsed_time_and_show_removed_device', () => {
  const input = scenario();
  input.system.components.push({ id: 'training-observer', typeId: 'training-thermometer', roomId: null,
    catalogSnapshotId: null, enabled: true, parameters: {} });
  const before = run(input);
  const edited = structuredClone(input);
  edited.system.projectRevision++;
  edited.outdoorC = -5;
  edited.system.components.pop();
  const after = run(edited);
  const diff = compareCaptures(before, after);
  expect(diff).toMatchObject({ sameTick: true, sameStart: false, removed: [{ id: 'training-observer', typeId: 'training-thermometer' }] });
  expect(compareCaptures(before, run(edited, false, 2)).readings.every((r) => r.delta === null)).toBe(true);
  input.system.components.pop();
  expect(before.components.some((c) => c.id === 'training-observer')).toBe(true);
});
