import { expect, test } from 'vitest';
import shape from '../fixtures/projects/direct-small.json';
import { parseProject } from '../../src/project/document';
import { trainingRegistry } from '../../src/project/registry';
import type { ComponentInstance, HydronicLink, ProjectDocument } from '../../src/project/types';
import { compileProject } from '../../src/simulation/compile';
import { resolveFluid } from '../../src/simulation/fluids';

function base(): ProjectDocument {
  const result = parseProject(shape);
  if (!result.ok) throw new Error('Invalid structural test fixture');
  return result.value;
}
function component(id: string, typeId: string, x: number, enabled = true): ComponentInstance {
  return { id, typeId, position: { x, y: 0, z: 0 }, level: 0, roomId: null, catalogSnapshotId: null, parameters: { enabled } };
}
function pipe(id: string, a: string, from: string, b: string, to: string): HydronicLink {
  return { id, from: { componentId: a, portId: from }, to: { componentId: b, portId: to },
    points: [], materialId: 'training-pipe', innerDiameterM: .012 };
}

test('compiles_two_parallel_loops with provenance, gauge anchor and distinct manifold headers', () => {
  const p = base();
  const result = compileProject(p, trainingRegistry);
  expect(result, JSON.stringify(result.diagnostics)).toMatchObject({ ok: true });
  if (!result.ok) return;
  const { nodes, hydraulicChannels, hydraulicDomains, thermalLinks } = result.value;
  expect(result.value.projectRevision).toBe(p.revision);
  expect(hydraulicDomains).toHaveLength(1);
  expect(hydraulicDomains[0]).toMatchObject({
    referenceNodeId: 'source:return', pressureAtReferencePa: 100_000, activity: 'driven', fluid: { kind: 'water' },
  });
  expect(nodes.find((node) => node.id === 'manifold:supply')?.ports.map((port) => port.portId)).toEqual(['feed', 'supply-1', 'supply-2']);
  const loops = hydraulicChannels.filter((channel) => channel.origin.loopRouteId !== undefined);
  expect(loops).toHaveLength(2);
  expect(loops.map((channel) => [channel.from, channel.to])).toEqual([
    ['manifold:supply', 'manifold:return'], ['manifold:supply', 'manifold:return'],
  ]);
  expect(loops[0]).toMatchObject({ lengthM: 10.75, origin: { linkId: 'pipe-a', loopRouteId: 'loop-a', roomId: 'room-a' } });
  expect(thermalLinks.map((edge) => edge.kind)).toEqual(['floor-loop', 'floor-loop']);
  expect(p).toEqual(base());
});

test('blocks_open_operating_port by exact authoring ID', () => {
  const p = base();
  p.hydronicLinks = p.hydronicLinks.filter((link) => link.id !== 'return');
  const result = compileProject(p, trainingRegistry);
  expect(result).toMatchObject({ ok: false });
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'open_operating_port', componentId: 'source', portId: 'return' }));
});

test('isolated_disabled_branch_has_zero_flow while enabled circuit still compiles', () => {
  const p = base();
  p.components.push(component('spare', 'training-circulator', 10, false));
  const result = compileProject(p, trainingRegistry);
  expect(result).toMatchObject({ ok: true, value: { hydraulicDomains: expect.arrayContaining([
    expect.objectContaining({ activity: 'inactive', flowConstraint: 'zero', nodeIds: ['spare:in', 'spare:out'] }),
  ]) } });
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'disabled_domain' }));
});

test('heat_exchanger_keeps_fluid_domains_separate, connected only by a thermal link', () => {
  const p = base();
  p.components = [
    component('source', 'training-heat-source', 0),
    component('hx', 'training-heat-exchanger', 1),
    component('circulator', 'training-circulator', 2),
  ];
  const hx = p.components[1]!;
  hx.parameters = { secondaryFluid: 'propylene-glycol', secondaryGlycolMassFraction: .3 };
  p.hydronicLinks = [
    pipe('primary-send', 'source', 'supply', 'hx', 'primary-in'),
    pipe('primary-return', 'hx', 'primary-out', 'source', 'return'),
    pipe('secondary-send', 'circulator', 'out', 'hx', 'secondary-in'),
    pipe('secondary-return', 'hx', 'secondary-out', 'circulator', 'in'),
  ];
  p.loopRoutes = [];
  const result = compileProject(p, trainingRegistry);
  expect(result, JSON.stringify(result.diagnostics)).toMatchObject({ ok: true });
  if (!result.ok) return;
  const { hydraulicDomains, thermalLinks, hydraulicChannels } = result.value;
  expect(hydraulicDomains).toHaveLength(2);
  const primary = hydraulicChannels.find((channel) => channel.id === 'component:hx:primary');
  const secondary = hydraulicChannels.find((channel) => channel.id === 'component:hx:secondary');
  expect(primary?.domainId).not.toBe(secondary?.domainId);
  expect(hydraulicDomains.find((domain) => domain.id === primary?.domainId)?.fluid.kind).toBe('water');
  expect(hydraulicDomains.find((domain) => domain.id === secondary?.domainId)?.fluid.kind).toBe('propylene-glycol');
  expect(thermalLinks).toEqual([expect.objectContaining({ kind: 'heat-exchanger', primaryChannelId: primary?.id, secondaryChannelId: secondary?.id })]);
});

test('unsupported or conflicting coolant does not silently become water', () => {
  expect(resolveFluid('propylene-glycol', .3)).toMatchObject({
    kind: 'propylene-glycol', massFraction: .3, referenceC: 20, densityKgM3: 1032.1,
    specificHeatJkgK: 3960, dynamicViscosityPaS: .003,
  });
  expect(resolveFluid('propylene-glycol', .4)).toBeNull();
  expect(resolveFluid('ethylene-glycol', .3)).toBeNull();
  const p = base();
  p.environment.fluid = 'ethylene-glycol';
  expect(compileProject(p, trainingRegistry)).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'unsupported_fluid' })]) });
});

test('an off pump attached to an operating loop does not count as a cap', () => {
  const p = base();
  p.components.push(component('off-pump', 'training-circulator', 2, false));
  p.hydronicLinks = [
    ...p.hydronicLinks.filter((link) => link.id !== 'return'),
    pipe('return-to-off-pump', 'manifold', 'return', 'off-pump', 'in'),
  ];
  const result = compileProject(p, trainingRegistry);
  expect(result).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([
    expect.objectContaining({ code: 'open_operating_port', componentId: 'off-pump', portId: 'out' }),
  ]) });
});

test('compiled component preserves compatible parameter provenance, rejects cross-model snapshots', () => {
  const p = base(), src = p.components[0]!;
  src.catalogSnapshotId = 'training-reference';
  p.appliedCatalogSnapshots.push({
    id: 'training-reference', productId: 'training-sku', typeId: src.typeId,
    catalogReleaseId: 'training-v1', basis: 'training', sourceUrls: [],
    parameters: { supplyC: 35, powerW: 2000 },
  });
  const r = compileProject(p, trainingRegistry);
  expect(r).toMatchObject({ ok: true, value: { components: expect.arrayContaining([
    expect.objectContaining({ id: 'source', catalogSnapshotId: 'training-reference', parameters: { supplyC: 40, powerW: 2000 } }),
  ]) } });
  p.appliedCatalogSnapshots[0]!.typeId = 'training-circulator';
  expect(compileProject(p, trainingRegistry)).toMatchObject({
    ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'catalog_model_mismatch', componentId: 'source' })]),
  });
});
