import { IDBFactory } from 'fake-indexeddb';
import { expect, test } from 'vitest';
import { createEmptyProject } from '../../src/project/editor-geometry';
import { emptyArtifacts } from '../../src/storage/project-transfer';
import { projectRepository } from '../../src/storage/projects';
import { createSaveQueue } from '../../src/storage/save-queue';

const doc = (id: string, revision = 0) => ({ project: { ...createEmptyProject(id), revision }, ...emptyArtifacts() });

test('restart_reopens_last_committed_revision', async () => {
  const db = new IDBFactory();
  const one = projectRepository(db), saved = await one.save(doc('first', 4), null);
  expect(saved.generation).toBe(1);
  const two = projectRepository(db);
  expect((await two.last())?.workspace.project.revision).toBe(4);
  expect(await two.list()).toMatchObject([{ projectId: 'first', revision: 4 }]);
});

test('concurrent_revisions_do_not_overwrite even with identical authored revision', async () => {
  const db = new IDBFactory(), repo = projectRepository(db);
  await repo.save(doc('same', 1), null);
  const p = await repo.get('same');
  const one = { ...doc('same', 2), project: { ...doc('same', 2).project, title: 'Первое изменение' } };
  const second = { ...doc('same', 2), project: { ...doc('same', 2).project, title: 'Второе изменение' } };
  await repo.save(one, 1);
  await expect(repo.save(second, p!.generation)).rejects.toMatchObject({ code: 'conflict' });
  expect((await repo.get('same'))?.workspace.project.title).toBe('Первое изменение');
});

test('project_n_minus_one_migrates_with_backup', async () => {
  const f = new IDBFactory();
  await new Promise<void>((resolve, reject) => {
    const old = f.open('educationsim-workspaces', 1);
    old.onerror = () => reject(old.error);
    old.onupgradeneeded = () => {
      const db = old.result;
      db.createObjectStore('projects').put({ version: 1, project: doc('old', 3).project }, 'old');
      db.createObjectStore('meta').put('old', 'last');
    };
    old.onsuccess = () => { old.result.close(); resolve(); };
  });
  const repo = projectRepository(f);
  const open = await repo.last();
  expect(open?.workspace.project.revision).toBe(3);
  expect(open?.workspace.captures).toEqual({});
  expect(await repo.originalBackup('old')).toMatchObject({ version: 1, project: { revision: 3 } });
});

test('quota_failure_offers_export and failed_close_save_offers_retry_or_export', async () => {
  let failed = true;
  const queue = createSaveQueue(async (w) => {
    if (failed) throw new DOMException('Quota', 'QuotaExceededError');
    return { generation: 1, workspace: w };
  });
  queue.select(null);
  queue.change(doc('pending', 1));
  expect(await queue.flush()).toBe(false);
  expect(queue.state().error).toMatch(/места/i);
  expect(queue.state().dirty).toBe(true);
  expect(queue.current()?.project.revision).toBe(1);
  failed = false;
  expect(await queue.flush()).toBe(true);
  expect(queue.state().dirty).toBe(false);
});
