import { expect, test } from 'vitest';
import { createTemplateProject } from '../../src/project/templates';
import { createEmptyProject } from '../../src/project/editor-geometry';
import { applyProjectCommand } from '../../src/project/reducer';
import { trainingRegistry } from '../../src/project/registry';

test('new rooms and resizing are transactional; invalid geometry never replaces the prior project', () => {
  const p = createEmptyProject('new-project');
  const added = applyProjectCommand(p, { kind: 'add_rectangular_room', commandId: 'add', roomId: 'room-one',
    level: 0, x: 0, z: 0, widthM: 6, depthM: 4 }, trainingRegistry);
  if (!added.ok) throw new Error(JSON.stringify(added.diagnostics));
  expect(added.value.revision).toBe(1);
  expect(added.value.rooms[0]?.outline[2]).toEqual({ x: 6, z: 4 });
  expect(p.rooms).toHaveLength(0);
  const resize = (widthM: number) => applyProjectCommand(added.value, { kind: 'resize_rectangular_room',
    commandId: 'resize', roomId: 'room-one', widthM, depthM: 4 }, trainingRegistry);
  expect(resize(0)).toMatchObject({ ok: false, diagnostics: [{ code: 'invalid_room_dimensions' }] });
  expect(added.value.rooms[0]?.outline[2]).toEqual({ x: 6, z: 4 });
  expect(resize(7.5)).toMatchObject({ ok: true, value: { revision: 2, rooms: [{ outline: expect.arrayContaining([{ x: 7.5, z: 4 }]) }] } });
});

test('shrinking across a template route is rejected rather than silently breaking the graph', () => {
  const parsed = createTemplateProject('direct', 'test-project');
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  expect(applyProjectCommand(parsed.value, { kind: 'resize_rectangular_room',
    commandId: 'resize', roomId: 'room-a', widthM: 2, depthM: 1 }, trainingRegistry))
    .toMatchObject({ ok: false, diagnostics: [{ code: 'room_contains_geometry' }] });
});
