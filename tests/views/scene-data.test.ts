import { expect, test } from 'vitest';
import { particleDistance, pipeFlow } from '../../src/views/scene/flow';
import { compileLiveScenario } from '../../src/project/live-scenario';
import { createTemplateProject } from '../../src/project/templates';
import { createSession } from '../../src/simulation/session';
import { componentCutaway } from '../../src/views/scene/componentCutaway';
import { sceneHeat } from '../../src/views/scene/heatMap';
import type { TemplateId } from '../../src/project/templates';

function live(id: TemplateId) {
  const p = createTemplateProject(id, 'render-fixture');
  if (!p.ok) throw new Error(JSON.stringify(p.diagnostics));
  const assembled = compileLiveScenario(p.value, id);
  if (!assembled.ok) throw new Error(JSON.stringify(assembled.diagnostics));
  const run = createSession(assembled.value);
  if (!run.ok) throw new Error(JSON.stringify(run.diagnostics));
  run.value.stepOnce();
  return { run: run.value, project: p.value, system: assembled.value.system };
}

test('same_flow_two_diameters_obey_v11 and particle_direction_tracks_flow_sign', () => {
  const a = pipeFlow(.0001, .01)!, b = pipeFlow(.0001, .02)!;
  expect(a.lMin).toBe(6);
  expect(b.lMin).toBe(a.lMin);
  expect(a.speedMps / b.speedMps).toBeCloseTo(4, 2);
  expect(pipeFlow(-.0001, .01)?.speedMps).toBe(-a.speedMps);
  expect(pipeFlow(0, .02)?.speedMps).toBe(0);
  expect(pipeFlow(undefined, .02)).toBeNull();
});

test('cutaway_tracks_actual_port_flow_and_valve_position', () => {
  const { run, system, project } = live('direct');
  const valve = 'link:pipe-a';
  run.command({ kind: 'set-valve', channelId: valve, opening: 0 });
  run.stepOnce();
  const model = componentCutaway(project, system, 'manifold', run.view);
  expect(model?.paths.find((path) => path.id === valve)).toMatchObject({ lMin: 0, opening: 0 });
});

test('exchanger_cutaway_has_separated_liquids', () => {
  const { run, system, project } = live('water-glycol-exchanger');
  const hx = componentCutaway(project, system, 'exchanger', run.view);
  expect(hx?.paths).toHaveLength(2);
  expect(new Set(hx?.paths.map((p) => p.liquid))).toHaveProperty('size', 2);
});

test('heat_map_distinguishes_surface_from_coolant', () => {
  const { run, project } = live('water-glycol-exchanger');
  const heat = sceneHeat(project, run.view);
  const sample = heat.find(({ roomId }) => roomId === 'room-a');
  expect(sample?.surfaceC).toBeCloseTo(20, 1);
  expect(sample?.waterC).not.toBe(sample?.surfaceC);
  expect(sceneHeat(project, { ...run.view, stale: true })[0]?.surfaceC).toBeNull();
});

test('stationary markers preserve position while reverse travel subtracts distance', () => {
  expect(particleDistance(.6, 1, 0, 1)).toBeCloseTo(.6);
  expect(particleDistance(.6, 1, -.5, 1)).toBeLessThan(.6);
  expect(particleDistance(.6, 1, .5, 1)).toBeGreaterThan(.6);
});
