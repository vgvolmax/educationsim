import { expect, test } from 'vitest';
import { scenario } from '../fixtures/simulation-engine';
import { replay, recordingVersion } from '../../src/simulation/replay';
import type { SimulationRecord } from '../../src/simulation/replay';
import { createSession } from '../../src/simulation/session';

test('replay_matches_v08 for 600 solved model seconds including stable safety event IDs', () => {
  const record: SimulationRecord = { version: recordingVersion, scenario: scenario(), untilTick: 600, commands: [
    { tick: 1, seq: 0, command: { kind: 'manual', actuatorId: 'drive', demand: true } },
    { tick: 100, seq: 1, command: { kind: 'fault', command: { kind: 'sensor-failure', id: 'supply' } } },
    { tick: 104, seq: 2, command: { kind: 'fault', command: { kind: 'sensor-repair', id: 'supply' } } },
    { tick: 104, seq: 3, command: { kind: 'reset-limit', limiterId: 'limit' } },
  ] };
  const first = replay(record), second = replay(record);
  expect(first, JSON.stringify(first.diagnostics)).toMatchObject({ ok: true, value: { snapshot: { tick: 600 } } });
  expect(second).toEqual(first);
  if (first.ok) {
    expect(first.value.events).toContainEqual(expect.objectContaining({ id: '100:0', tick: 100, kind: 'limiter-tripped', componentId: 'limit' }));
    expect(first.value.events).toContainEqual(expect.objectContaining({ id: '104:0', tick: 104, kind: 'limiter-reset', componentId: 'limit' }));
  }
}, 20_000);

test('tick_equals_one_second_at_any_speed and paused_state_does_not_advance', () => {
  const fresh = () => {
    const s = createSession(scenario());
    if (!s.ok) throw new Error(JSON.stringify(s.diagnostics));
    return s.value;
  };
  const normal = fresh(), fast = fresh();
  normal.pulse(1000);
  expect(normal.view.snapshot.tick).toBe(0);
  normal.resume();
  fast.setSpeed(600);
  fast.resume();
  normal.pulse(1000);
  fast.pulse(1000 / 600 + .001);
  expect(normal.view.snapshot.tick).toBe(1);
  expect(fast.view.snapshot).toEqual(normal.view.snapshot);
  fast.visibility(false);
  fast.pulse(1000);
  expect(fast.view.mode).toBe('paused');
  expect(fast.view.snapshot.tick).toBe(1);
  fast.stepOnce();
  expect(fast.view.snapshot.tick).toBe(1);
  fast.visibility(true);
  expect(fast.view.mode).toBe('paused');
  fast.stepOnce();
  expect(fast.view.snapshot.tick).toBe(2);
  expect(fast.view.samples.map(({ tick }) => tick)).toEqual([0, 1, 2]);
});

test('does not replay unordered commands or skip a failed tick', () => {
  const r = replay({ version: recordingVersion, scenario: scenario(), untilTick: 1, commands: [
    { tick: 1, seq: 2, command: { kind: 'power', powered: false } },
    { tick: 1, seq: 1, command: { kind: 'power', powered: true } },
  ] });
  expect(r).toMatchObject({ ok: false, diagnostics: [{ code: 'invalid_record_order' }] });
  const s = createSession(scenario());
  if (!s.ok) throw new Error('Missing test session');
  s.value.command({ kind: 'manual', actuatorId: 'not-a-drive', demand: true });
  s.value.stepOnce();
  expect(s.value.view.mode).toBe('stopped');
  expect(s.value.view.snapshot.tick).toBe(0);
  expect(s.value.view.stale).toBe(true);
});

test('global energy balance survives 600 engine seconds without counting internal transfers', () => {
  const s = createSession(scenario());
  if (!s.ok) throw new Error('Bad test scenario');
  let sourcesJ = 0, expectedContent = 0, initialContent = 0;
  const content = (snapshot: typeof s.value.view.snapshot) =>
    Object.values(snapshot.fluid.cells).reduce((sum, cell) => sum + cell.massKg * 4180 * cell.temperatureC, 0);
  initialContent = content(s.value.view.snapshot);
  s.value.command({ kind: 'manual', actuatorId: 'drive', demand: true });
  for (let i = 0; i < 600; i++) {
    s.value.stepOnce();
    sourcesJ += s.value.view.snapshot.energy!.sourceJ;
  }
  expect(s.value.view.snapshot.tick).toBe(600);
  expect(sourcesJ).toBeGreaterThan(0);
  expectedContent = initialContent + sourcesJ;
  expect(Math.abs(content(s.value.view.snapshot) - expectedContent)).toBeLessThan(1e-6);
}, 20_000);
