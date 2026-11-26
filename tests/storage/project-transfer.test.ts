import { expect, test } from 'vitest';
import { createTemplateProject } from '../../src/project/templates';
import { readWorkspace, writeWorkspace, cloneWorkspace } from '../../src/storage/project-transfer';
import { compileLiveScenario } from '../../src/project/live-scenario';
import { createSession } from '../../src/simulation/session';
import { captureFrame } from '../../src/simulation/comparison';
import { replay } from '../../src/simulation/replay';

const seed = createTemplateProject('direct', 'persistence-fixture');
if (!seed.ok) throw new Error('Fixture invalid');
const run = compileLiveScenario(seed.value, 'direct');
if (!run.ok) throw new Error('Scenario missing');

test('snapshot_and_replay_round_trip with two exact historical revisions', () => {
  const made = createSession(run.value);
  if (!made.ok) throw new Error('Session unavailable');
  made.value.stepOnce();
  const a = captureFrame(run.value, made.value.view)!;
  const archived = made.value.record()!;
  const draft = structuredClone(seed.value);
  draft.revision = 2;
  const exported = writeWorkspace({ project: draft, preset: 'direct', captures: { a, b: { ...a, revision: 1 } }, records: [archived] });
  if (!exported.ok) throw new Error(JSON.stringify(exported.diagnostics));
  const decoded = readWorkspace(exported.value);
  if (!decoded.ok) throw new Error(JSON.stringify(decoded.diagnostics));
  expect(decoded.value.project.revision).toBe(2);
  expect(decoded.value.captures).toMatchObject({ a: { revision: 0 }, b: { revision: 1 } });
  expect(replay(decoded.value.records[0]!)).toMatchObject({ ok: true, value: { snapshot: made.value.view.snapshot } });
  const copy = cloneWorkspace(decoded.value, 'fresh-copy');
  expect(copy.project.projectId).toBe('fresh-copy');
  expect(copy.records[0]?.scenario.system.projectId).toBe('persistence-fixture');
});
test('corrupt future and oversized imports are rejected before touching storage', () => {
  expect(readWorkspace('{')).toMatchObject({ ok: false });
  expect(readWorkspace('{"format":"educationsim-workspace","version":99}')).toMatchObject({ ok: false });
  expect(readWorkspace('x'.repeat(13 * 1024 * 1024))).toMatchObject({ ok: false, diagnostics: [{ code: 'workspace_size' }] });
  const bare = readWorkspace(JSON.stringify(seed.value));
  expect(bare).toMatchObject({ ok: true, value: { captures: {}, records: [] } });
});
