import benchmark from './projects/benchmark-large.json';
import { parseProject } from '../../src/project/document';
import { trainingRegistry } from '../../src/project/registry';
import { compileProject } from '../../src/simulation/compile';
import type { ComponentType, HydronicPort, Result } from '../../src/project/types';
import type { SimulationScenario } from '../../src/simulation/engine-types';
import type { HydraulicInputs } from '../../src/simulation/hydraulics';

const port = (id: string): HydronicPort => ({ id, domain: 'hydronic', medium: 'heating',
  connector: { family: 'tube', diameterMm: 16, mate: 'socket' } });
const lanePorts = (count: number, prefix: string) => Array.from({ length: count }, (_, i) => port(prefix + i));
const make = (id: string, ports: HydronicPort[], belongs: (port: string) => string): ComponentType =>
  ({ id, category: 'equipment', ports, defaultParameters: {},
    hydraulics: { portNodes: Object.fromEntries(ports.map(({ id }) => [id, belongs(id)])), channels: [] } });
const registry = new Map(trainingRegistry);
for (const count of [2, 8]) {
  const id = 'benchmark-bank-' + count;
  registry.set(id, make(id, [port('main'), ...lanePorts(count, 'lane-')], () => 'header'));
}
const manifold = make('benchmark-manifold-8', [port('feed'), port('return'), ...lanePorts(8, 'supply-'), ...lanePorts(8, 'return-')],
  (id) => id.startsWith('return') ? 'return' : 'supply');
registry.set(manifold.id, manifold);

/** Stress fixture only: six independent manifolds loaded by distributed parallel resistance banks. */
export function makeBenchmarkScenario(): Result<SimulationScenario> {
  const doc = parseProject(benchmark);
  if (!doc.ok) return doc;
  const compiled = compileProject(doc.value, registry);
  if (!compiled.ok) return compiled;
  const system = compiled.value;
  const resistance = Object.fromEntries(system.hydraulicChannels.map(({ id }) => [id, { linearPaPerM3s: 2e7 }]));
  const pumps: HydraulicInputs['pumps'] = Object.fromEntries(system.hydraulicChannels.filter(({ kind }) => kind === 'source').map(({ id }) =>
    [id, { mode: 'fixed-speed', points: [{ flowM3s: 0, headPa: 30_000 }, { flowM3s: .0006, headPa: 0 }] }]));
  return { ok: true, diagnostics: compiled.diagnostics, value: {
    system, hydraulic: { resistance, pumps },
    fluid: { cells: Object.fromEntries(system.hydraulicChannels.map(({ id }) => [id, { massKg: 1, temperatureC: 20 }])) },
    control: { devices: [], bindings: [], wires: [] }, outdoorC: 0, sources: [],
  } };
}
