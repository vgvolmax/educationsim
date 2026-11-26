import { expect, test } from 'vitest';
import { createTemplateProject } from '../../src/project/templates';
import { compileLiveScenario } from '../../src/project/live-scenario';
import { createSession } from '../../src/simulation/session';
import { replay } from '../../src/simulation/replay';

function network() {
  const base = createTemplateProject('direct', 'active-live-fixture');
  if (!base.ok) throw new Error('Fixture is invalid');
  return base.value;
}
test('a real mounted thermostat feeds the active project, using its edited settings, while source protection stays wired', () => {
  const p = network();
  p.revision = 7;
  p.components.push({ id: 'actual-thermostat', typeId: 'training-thermostat', position: { x: 1, y: 0, z: 1 },
    level: 0, roomId: 'room-a', catalogSnapshotId: null, parameters: { targetC: 30, deadbandK: 1 } });
  p.components.find((c) => c.id === 'source')!.parameters.powerW = 1850;
  p.controlLinks.push({ id: 'actual-wiring', from: { componentId: 'actual-thermostat', portId: 'demand' },
    to: { componentId: 'source', portId: 'heat-request' } });
  const compiled = compileLiveScenario(p, 'direct');
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const made = createSession(compiled.value);
  if (!made.ok) throw new Error(JSON.stringify(made.diagnostics));
  const run = made.value;
  run.stepOnce();
  expect(run.view.snapshot).toMatchObject({ projectRevision: 7, tick: 1, sources: { source: { powerW: 1850 } } });
  run.command({ kind: 'fault', command: { kind: 'sensor-failure', id: 'supply' } });
  run.stepOnce();
  expect(run.view.snapshot.sources.source).toMatchObject({ powerW: 0, reason: 'blocked' });
});
test('aperture overrides replay exactly with safe bounds and affect the physical next tick', () => {
  const compiled = compileLiveScenario(network(), 'direct');
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const made = createSession(compiled.value);
  if (!made.ok) throw new Error(JSON.stringify(made.diagnostics));
  const run = made.value, id = 'link:pipe-a';
  run.stepOnce();
  expect(run.view.snapshot.hydraulics?.channels[id]?.flowM3s).toBeGreaterThan(0);
  run.command({ kind: 'set-valve', channelId: id, opening: 0 });
  expect(run.view.snapshot.hydraulics?.channels[id]?.flowM3s).toBeGreaterThan(0);
  run.stepOnce();
  expect(run.view.snapshot.hydraulics?.channels[id]?.flowM3s).toBe(0);
  const before = run.view.snapshot;
  const record = run.record();
  if (!record) throw new Error('Recording missing');
  expect(replay(record)).toMatchObject({ ok: true, value: { snapshot: before } });
  run.command({ kind: 'set-valve', channelId: 'component:source:source', opening: 1 });
  run.stepOnce();
  expect(run.view.stale).toBe(true);
  expect(run.view.snapshot).toBe(before);
});
