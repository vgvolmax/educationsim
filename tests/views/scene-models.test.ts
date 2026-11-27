import { expect, test } from 'vitest';
import { Box3, Mesh, Vector3 } from 'three';
import { equipmentRegistry } from '../../src/project/registry';
import { createEquipment } from '../../src/views/scene/createEquipment';
import { sceneInput } from '../../src/views/scene/buildScene';
import { createEmptyProject } from '../../src/project/editor-geometry';

function build(id: string) {
  const entry = equipmentRegistry.get(id)!;
  return createEquipment({ id, family: entry.family, variant: entry.variant,
    outlets: Number(entry.component.defaultParameters.outlets ?? 0), position: { x: 2, y: 3, z: 4 } });
}
function shape(id: string) {
  return build(id).children.map((mesh) => [mesh.type, mesh.position.toArray(), new Box3().setFromObject(mesh).getSize(new Vector3()).toArray()]);
}
test('every catalog training profile produces finite, selectable 3D geometry', () => {
  const entries = [...equipmentRegistry.values()];
  expect(new Set(entries.map((x) => x.family)).size).toBe(20);
  for (const { id } of entries) {
    const model = build(id);
    const size = new Box3().setFromObject(model).getSize(new Vector3());
    expect(size.toArray().every((v) => Number.isFinite(v) && v > 0), id).toBe(true);
    expect(model.position.toArray()).toEqual([2, 3, 4]);
    model.traverse((mesh) => {
      if (mesh instanceof Mesh) expect(mesh.userData.componentId, id).toBe(id);
    });
  }
});
test('visual signatures distinguish the variants of every teaching family', () => {
  const all = [...equipmentRegistry.values()];
  for (const family of new Set(all.map((x) => x.family))) {
    const entries = all.filter((x) => x.family === family);
    expect(new Set(entries.map(({ id }) => JSON.stringify(shape(id)))).size, family).toBe(entries.length);
  }
});
test('pipe without an authored route has separate feed/return and a nonzero collector loop in 3D', () => {
  const p = createEmptyProject('paths');
  const components = [
    { id: 'boiler', typeId: 'training-heat-source', position: { x: 1, y: 0, z: 1 } },
    { id: 'manifold', typeId: 'training-manifold-two-way', position: { x: 2, y: 0, z: 1 } },
  ].map((c) => ({ ...c, level: 0, roomId: null, catalogSnapshotId: null, parameters: {} }));
  const build = (id: string, from: [string, string], to: [string, string]) => ({ id,
    from: { componentId: from[0], portId: from[1] }, to: { componentId: to[0], portId: to[1] },
    materialId: 'training-pipe', points: [], innerDiameterM: .012 });
  const pipes = sceneInput({ ...p, components, hydronicLinks: [
    build('feed', ['boiler', 'supply'], ['manifold', 'feed']),
    build('return', ['manifold', 'return'], ['boiler', 'return']),
    build('loop', ['manifold', 'supply-1'], ['manifold', 'return-1']),
  ] }, 0).pipes;
  const [feed, ret, loop] = pipes;
  expect(new Set(loop!.points.map((pt) => JSON.stringify(pt))).size).toBeGreaterThan(2);
  const side = (points: readonly { z: number }[]) => points.find((pt) => pt.z !== 1)?.z ?? 1;
  expect((side(feed!.points) - 1) * (side(ret!.points) - 1)).toBeLessThan(0);
});
