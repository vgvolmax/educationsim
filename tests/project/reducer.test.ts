import { expect, test } from 'vitest';
import source from '../fixtures/projects/direct-small.json';
import { parseProject } from '../../src/project/document';
import { createProjectHistory, editProject, redoProject, undoProject } from '../../src/project/history';
import { applyProjectCommand, previewReplacement } from '../../src/project/reducer';
import { trainingRegistry } from '../../src/project/registry';

function project() {
  const parsed = parseProject(source);
  if (!parsed.ok) throw new Error('Invalid test fixture');
  return parsed.value;
}

test('delete_disconnects_owned_links', () => {
  const before = project();
  const result = applyProjectCommand(before, { kind: 'remove_component', commandId: 'remove', componentId: 'manifold' }, trainingRegistry);
  expect(result).toMatchObject({ ok: true, value: { revision: 1, hydronicLinks: [], loopRoutes: [] } });
  if (result.ok) expect(result.value.components.map((c) => c.id)).toEqual(['source']);
  expect(before.hydronicLinks).toHaveLength(4);
  expect(before.loopRoutes).toHaveLength(2);
});

test('replacement_preserves_only_compatible_links and requires the current preview revision', () => {
  const before = project();
  const replace = { kind: 'replace_component', commandId: 'replace', componentId: 'manifold', typeId: 'training-manifold-one-way', expectedRevision: 0 } as const;
  const preview = previewReplacement(before, replace, trainingRegistry);
  expect(preview).toMatchObject({ ok: true, value: { removedLoopRoutes: ['loop-b'] } });
  if (!preview.ok) throw new Error('No replacement preview');
  expect(preview.value.links.filter((link) => link.action === 'keep').map((link) => link.linkId)).toEqual(['supply', 'return', 'pipe-a']);
  expect(preview.value.links.filter((link) => link.action === 'detach')).toMatchObject([
    { domain: 'hydronic', linkId: 'pipe-b', diagnostic: { code: 'missing_port', portId: 'supply-2' } },
  ]);
  expect(before.hydronicLinks).toHaveLength(4);
  const result = applyProjectCommand(before, replace, trainingRegistry);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.value.components.find((c) => c.id === 'manifold')?.typeId).toBe(replace.typeId);
  expect(result.value.hydronicLinks.map((link) => link.id)).toEqual(['supply', 'return', 'pipe-a']);
  expect(result.value.loopRoutes.map((route) => route.id)).toEqual(['loop-a']);
  expect(applyProjectCommand(result.value, replace, trainingRegistry)).toMatchObject({ ok: false, diagnostics: [{ code: 'stale_revision' }] });
});

test('a failed batch leaves the original untouched; a successful batch advances once', () => {
  const before = project();
  const remove = { kind: 'remove_component', commandId: 'remove', componentId: 'manifold' } as const;
  const rename = { kind: 'rename_project', commandId: 'rename', title: 'Учебный стенд' } as const;
  const invalid = applyProjectCommand(before, { kind: 'batch', commandId: 'batch-fail', edits: [rename, remove, { ...remove, commandId: 'remove-again' }] }, trainingRegistry);
  expect(invalid).toMatchObject({ ok: false, diagnostics: [{ code: 'missing_component' }] });
  expect(before.title).toBe('Две петли');
  expect(before.revision).toBe(0);
  const valid = applyProjectCommand(before, { kind: 'batch', commandId: 'batch-good', edits: [rename, remove] }, trainingRegistry);
  expect(valid).toMatchObject({ ok: true, value: { title: 'Учебный стенд', revision: 1, hydronicLinks: [] } });
});

test('undo_restores_graph_snapshot without reusing revision, redo clears after a new edit', () => {
  const before = project();
  const history = createProjectHistory(before);
  const updated = editProject(history, { kind: 'remove_component', commandId: 'remove', componentId: 'manifold' }, trainingRegistry);
  if (!updated.ok) throw new Error(JSON.stringify(updated.diagnostics));
  const undo = undoProject(updated.value);
  expect(undo?.current).toEqual({ ...before, revision: 2 });
  if (!undo) throw new Error('No undo state');
  const redo = redoProject(undo);
  expect(redo?.current).toEqual({ ...updated.value.current, revision: 3 });
  const newEdit = editProject(undo, { kind: 'rename_project', commandId: 'rename', title: 'Другая схема' }, trainingRegistry);
  expect(newEdit.ok && redoProject(newEdit.value)).toBeNull();
});

test('a batch cannot create a duplicate identity even if a later edit removes it', () => {
  const before = project();
  const bad = applyProjectCommand(before, { kind: 'batch', commandId: 'batch', edits: [
    { kind: 'add_component', commandId: 'duplicate', component: before.components[0]! },
    { kind: 'remove_component', commandId: 'remove', componentId: before.components[0]!.id },
  ] }, trainingRegistry);
  expect(bad).toMatchObject({ ok: false, diagnostics: [{ code: 'duplicate_id' }] });
  expect(before.components).toHaveLength(2);
});
