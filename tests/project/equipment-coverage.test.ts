import { expect, test } from 'vitest';
import { equipmentFamilies, equipmentRegistry, trainingRegistry, validateEquipmentSettings } from '../../src/project/registry';
import { compileProject } from '../../src/simulation/compile';
import { solveHydraulics } from '../../src/simulation/hydraulics';
import { trainingCompositeHydraulics } from '../../src/project/component-types/composite-hydraulics';
import type { HydronicLink, PortEndpoint } from '../../src/project/types';
import { parseProject } from '../../src/project/document';
import simple from '../fixtures/projects/direct-small.json';

const required = {
  source: ['gas-boiler', 'electric-boiler', 'heat-pump', 'external-source'],
  conveyance: ['main-pipe', 'riser', 'loop-pipe', 'pipe-insulation'],
  fittings: ['coupling', 'elbow', 'tee', 'adapter', 'eurocone', 'union', 'cap'],
  manifolds: ['supply-manifold', 'return-manifold', 'pair-flowmeters', 'pair-plain', 'dynamic-manifold'],
  balancing: ['loop-balance', 'branch-balance', 'flowmeter'],
  isolation: ['ball-valve', 'loop-valve', 'motor-zone-valve'],
  directional: ['check', 'bypass', 'jumper', 'rtl'],
  circulation: ['pump', 'direct-pump-group'],
  mixing: ['pump-mixing-group', 'passive-mixing-group', 'two-way-mix', 'three-way-mix'],
  actuation: ['remote-head', 'mix-actuator', 'thermal-actuator'],
  'zone-sensing': ['air-thermostat', 'floor-sensor', 'supply-sensor', 'outdoor-sensor', 'zone-controller', 'weather-controller'],
  'safety-controls': ['high-limiter', 'emergency-relay'],
  pressure: ['expansion-vessel', 'safety-group', 'relief-valve', 'pressure-gauge'],
  service: ['air-vent', 'air-separator', 'end-block', 'drain-cock', 'fill-cock', 'protected-makeup'],
  filtration: ['strainer', 'dirt-separator', 'sludge-trap', 'magnetic-separator'],
  storage: ['hydraulic-separator', 'buffer', 'plate-exchanger'],
  'measurement-radiators': ['radiator', 'thermometer', 'heat-meter'],
  mounting: ['cabinet', 'bracket'],
  'floor-installation': ['floor-insulation', 'stud-mat', 'film', 'underlay', 'mesh', 'rail', 'clips', 'edge-tape', 'joint', 'sleeve'],
  'floor-build-up': ['screed', 'dry-plate', 'deck', 'floor-finish'],
} as const;

test('every_required_family_has_ports_parameters_and_outputs with independent variant coverage', () => {
  const familyIds = equipmentFamilies.map((f) => f.id);
  expect(new Set(familyIds).size).toBe(20);
  expect([...familyIds].sort()).toEqual(Object.keys(required).sort());
  const definitions = [...equipmentRegistry.values()];
  for (const [family, variants] of Object.entries(required)) {
    const found = definitions.filter((entry) => entry.family === family);
    expect([...new Set(found.map((d) => d.variant))].sort()).toEqual([...variants].sort());
  }
  for (const entry of definitions) {
    expect(entry.basis).toBe('training');
    expect(entry.titleRu).toMatch(/[а-я]/i);
    expect(entry.installation.length).toBeGreaterThan(6);
    expect(entry.readings.length).toBeGreaterThan(0);
    expect(Object.keys(entry.settings).length).toBeGreaterThan(0);
    expect(validateEquipmentSettings(entry.id, entry.component.defaultParameters)).toMatchObject({ ok: true });
    expect(validateEquipmentSettings(entry.id, Object.fromEntries(Object.entries(entry.settings)
      .map(([key, setting]) => [key, setting.initial])))).toMatchObject({ ok: true });
    const ports = entry.component.ports;
    expect(new Set(ports.map(({ id }) => id)).size).toBe(ports.length);
    if (entry.mode === 'material' || entry.mode === 'mount') {
      expect(ports).toEqual([]);
      expect(entry.component.hydraulics).toBeUndefined();
    } else {
      expect(ports.length).toBeGreaterThan(0);
      expect(ports.filter(({ domain }) => domain === 'hydronic').map(({ id }) => id).sort()).toEqual(
        Object.keys(entry.component.hydraulics?.portNodes ?? {}).sort(),
      );
    }
  }
});
test('checks ranges and declared types instead of copying inappropriate equipment metadata', () => {
  expect(validateEquipmentSettings('training-wall-cabinet', { widthM: 0 })).toMatchObject({
    ok: false, diagnostics: [{ code: 'equipment_parameter_range', path: 'parameters.widthM' }],
  });
  expect(validateEquipmentSettings('training-heat-source', { supplyC: '40' })).toMatchObject({
    ok: false, diagnostics: [{ code: 'equipment_parameter_range' }],
  });
  expect(validateEquipmentSettings('training-heat-source', { unknown: 1 })).toMatchObject({
    ok: false, diagnostics: [{ code: 'unknown_equipment_parameter' }],
  });
});
test('keeps prior hydraulic fixture and maps new composite ports to distinct lawful nodes', () => {
  const p = parseProject(simple);
  if (!p.ok) throw new Error('Bad project fixture');
  expect(compileProject(p.value, trainingRegistry)).toMatchObject({ ok: true });
  const mixing = trainingRegistry.get('training-pump-mixing-group')!.hydraulics!;
  expect(new Set(Object.values(mixing.portNodes)).size).toBeGreaterThan(2);
  expect(mixing.channels.some((c) => c.kind === 'pump')).toBe(true);
  const exchanger = trainingRegistry.get('training-heat-exchanger')!.hydraulics!;
  expect(new Set(Object.values(exchanger.portNodes)).size).toBe(4);
  expect(exchanger.heatExchange).toBeDefined();
  const cap = trainingRegistry.get('training-cap')!.hydraulics!;
  expect(Object.keys(cap.portNodes)).toHaveLength(1);
  expect(cap.channels).toEqual([]);
});


test('a connected pump-mixing assembly uses the real pump and complementary branches in the solver', () => {
  const solve = (position: number) => {
    const raw = structuredClone(simple);
    const project = parseProject({ ...raw, projectId: 'composite-mixing', components: [
      ...raw.components,
      { ...raw.components[1], id: 'mixer', typeId: 'training-pump-mixing-group', position: { x: 1, y: 0, z: 0 }, parameters: { position } },
      { ...raw.components[1], id: 'tee', typeId: 'training-tee', position: { x: 1, y: 0, z: .5 } },
    ], hydronicLinks: [
      ...raw.hydronicLinks.filter((link) => !['supply', 'return'].includes(link.id)),
      ...([
        ['supply', ['source', 'supply'], ['mixer', 'hot']],
        ['delivery', ['mixer', 'mixed'], ['manifold', 'feed']],
        ['return', ['manifold', 'return'], ['tee', 'a']],
        ['return-source', ['tee', 'b'], ['source', 'return']],
        ['recirc', ['tee', 'c'], ['mixer', 'return']],
      ] as const).map(([id, from, to]): HydronicLink => {
        const end = ([componentId, portId]: readonly [string, string]): PortEndpoint => ({ componentId, portId });
        return { id, from: end(from), to: end(to), points: [], materialId: 'training-pipe', innerDiameterM: .012 };
      }),
    ] });
    if (!project.ok) throw new Error(JSON.stringify(project.diagnostics));
    const system = compileProject(project.value, trainingRegistry);
    if (!system.ok) throw new Error(JSON.stringify(system.diagnostics));
    const inputs = trainingCompositeHydraulics(system.value);
    if (!inputs.ok) throw new Error(JSON.stringify(inputs.diagnostics));
    const solved = solveHydraulics(system.value, { ...inputs.value, resistance: {
      ...inputs.value.resistance, 'component:source:source': { linearPaPerM3s: 2e7 },
      ...Object.fromEntries(system.value.hydraulicChannels.filter((channel) => channel.kind === 'pipe')
        .map((channel) => [channel.id, { linearPaPerM3s: 4e7 }])),
    }, pumps: { ...inputs.value.pumps,
      'component:source:source': { mode: 'off' },
    } });
    // Off source has a finite passive path; source path remains closed for the recirculation check.
    if (!solved.ok) throw new Error(JSON.stringify(solved.diagnostics));
    return solved.value.channels;
  };
  const channels = solve(0);
  expect(channels['component:mixer:hot-valve']).toMatchObject({ state: 'closed', flowM3s: 0 });
  expect(channels['component:mixer:recirculation']?.flowM3s).toBeGreaterThan(0);
  expect(channels['component:mixer:delivery']?.flowM3s).toBeCloseTo(channels['component:mixer:recirculation']!.flowM3s, 11);
  expect(channels['component:mixer:delivery']?.pump).toBeDefined();
  const fullHot = solve(1);
  expect(fullHot['component:mixer:recirculation']).toMatchObject({ state: 'closed', flowM3s: 0 });
  expect(fullHot['component:mixer:hot-valve']?.flowM3s).toBeGreaterThan(0);
  expect(fullHot['component:mixer:delivery']?.flowM3s).toBeCloseTo(fullHot['component:mixer:hot-valve']!.flowM3s, 11);
});
