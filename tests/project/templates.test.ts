import { expect, test } from 'vitest';
import { compareSeparatorInterference, createTemplateProject, openTemplateScenario, templateIds } from '../../src/project/templates';
import { createSession } from '../../src/simulation/session';
import { parseProject } from '../../src/project/document';
import { makeBenchmarkScenario } from '../fixtures/benchmark-scenario';
import benchmark from '../fixtures/projects/benchmark-large.json';
import type { Result } from '../../src/project/types';

const expected = ['direct', 'floor-and-radiators', 'rtl-loop', 'two-floors-separator', 'heat-pump-buffer', 'water-glycol-exchanger'] as const;
const primaryMlS = { direct: 97.9412, 'floor-and-radiators': 117.4032, 'rtl-loop': 65.5995,
  'two-floors-separator': 104.1281, 'heat-pump-buffer': 104.1672, 'water-glycol-exchanger': 90.5677 };
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

test('all_six_templates_run on the real engine with reproducible finite snapshots', () => {
  expect([...templateIds].sort()).toEqual([...expected].sort());
  for (const id of expected) {
    const make = () => value(createSession(value(openTemplateScenario(id, 'template-test-' + id))));
    const first = make(), second = make();
    for (let i = 0; i < 12; i++) { first.stepOnce(); second.stepOnce(); }
    const snapshot = first.view.snapshot;
    expect(first.view.diagnostics, id).not.toContainEqual(expect.objectContaining({ severity: 'error' }));
    expect(snapshot.tick, id).toBe(12);
    expect(snapshot.health, id).not.toBe('stopped');
    expect(snapshot.hydraulics!.channels['component:source:source']!.flowM3s * 1e6, id).toBeCloseTo(primaryMlS[id], 2);
    expect(snapshot.sources['source']?.reason, id).toBe('heating');
    expect(Object.keys(snapshot.building!.floors).sort(), id).toEqual(id === 'rtl-loop' ? ['loop-a'] : ['loop-a', 'loop-b']);
    if (id === 'floor-and-radiators') expect(snapshot.building!.energy.radiatorToRoomJ).toBeGreaterThan(0);
    if (id === 'heat-pump-buffer') expect(snapshot.fluid.cells['storage-cell']!.temperatureC).toBeGreaterThan(20);
    if (id === 'water-glycol-exchanger') {
      expect(new Set(Object.values(snapshot.fluid.fluidProfileByCell)).size).toBe(2);
      expect(snapshot.fluid.cells['component:exchanger:secondary']!.temperatureC).toBeCloseTo(23.5505, 2);
    }
    expect(snapshot, id).toEqual(second.view.snapshot);
    expect(Object.values(snapshot.hydraulics!.channels).some(({ flowM3s }) => Math.abs(flowM3s) > 1e-7), id).toBe(true);
    expect(Number.isFinite(snapshot.energy!.residualJ), id).toBe(true);
    expect(Math.abs(snapshot.energy!.residualJ), id).toBeLessThan(0.05);
    expect(Object.values(snapshot.fluid.cells).every(({ temperatureC }) => Number.isFinite(temperatureC)), id).toBe(true);
  }
});

test('template_clone_keeps_graph_references and never shares mutable state', () => {
  for (const id of expected) {
    const a = value(createTemplateProject(id, 'first-instance')), b = value(createTemplateProject(id, 'second-instance'));
    expect(a.projectId).toBe('first-instance');
    expect(b.projectId).toBe('second-instance');
    expect(a.revision).toBe(0);
    expect({ ...a, projectId: b.projectId }).toEqual(b);
    const componentIds = new Set(a.components.map((c) => c.id));
    const linkIds = new Set(a.hydronicLinks.map((l) => l.id));
    for (const link of [...a.hydronicLinks, ...a.controlLinks]) {
      expect(componentIds.has(link.from.componentId) && componentIds.has(link.to.componentId), id).toBe(true);
    }
    for (const route of a.loopRoutes) expect(linkIds.has(route.linkId), id).toBe(true);
    a.components[0]!.parameters.enabled = false;
    a.hydronicLinks.splice(0, 1);
    expect(value(createTemplateProject(id, 'second-instance'))).toEqual(b);
  }
});

test('separator_reduces_pump_interference_and_preserves_flow_direction', () => {
  const comparison = value(compareSeparatorInterference());
  const { withSeparator, directSeries } = comparison;
  expect(Math.abs(withSeparator.primaryFast - withSeparator.primarySlow)).toBeLessThan(
    Math.abs(directSeries.primaryFast - directSeries.primarySlow) / 3,
  );
  expect(withSeparator.primarySlow).toBeGreaterThan(0);
  expect(withSeparator.primaryFast).toBeGreaterThan(0);
  expect(withSeparator.crossoverSlow).toBeGreaterThan(0);
  expect(withSeparator.crossoverFast).toBeLessThan(0);
});

test('benchmark_fixture_reaches_supported_scale with 48 flowing circuits and finite temperatures', () => {
  const supplied = makeBenchmarkScenario();
  const project = value(parseProject(benchmark));
  expect(new Set(project.rooms.map(({ level }) => level)).size).toBe(3);
  expect(project.rooms).toHaveLength(12);
  expect(project.components.filter(({ typeId }) => typeId === 'benchmark-manifold-8')).toHaveLength(6);
  expect(project.components).toHaveLength(220);
  expect(project.hydronicLinks.length + project.controlLinks.length).toBe(400);
  expect(project.loopRoutes).toHaveLength(48);
  const session = value(createSession(value(supplied)));
  session.stepOnce();
  expect(session.view.snapshot.tick).toBe(1);
  expect(session.view.snapshot.health).toBe('normal');
  for (const route of project.loopRoutes) {
    expect(session.view.snapshot.hydraulics!.channels['link:' + route.linkId]!.flowM3s).toBeGreaterThan(0);
  }
  expect(Object.values(session.view.snapshot.fluid.cells).every(({ temperatureC }) => Number.isFinite(temperatureC))).toBe(true);
});
