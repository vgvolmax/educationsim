import { parseProject } from '../project/document';
import { emptyArtifacts, readWorkspace, writeWorkspace } from './project-transfer';
import type { Workspace } from './project-transfer';

type IndexEntry = { projectId: string; title: string; revision: number; updatedAt: number };
export type SavedProject = { generation: number; workspace: Workspace };
type Stored = IndexEntry & { version: 2; generation: number; json: string };
export class ProjectStoreError extends Error {
  constructor(readonly code: 'conflict' | 'corrupt' | 'unavailable', message: string) { super(message); }
}

const database = 'educationsim-workspaces', projects = 'projects', meta = 'meta', index = 'index', backups = 'backups';
function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(database, 2);
    request.onupgradeneeded = () => {
      for (const name of [projects, meta, index, backups]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new ProjectStoreError('unavailable', 'Закройте другое окно приложения и повторите.'));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}
function transact<T>(db: IDBDatabase, names: string[], mode: IDBTransactionMode,
  work: (tx: IDBTransaction, set: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    let value: T, cause: Error | undefined;
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(cause ?? tx.error ?? new ProjectStoreError('unavailable', 'Запись проекта прервана.'));
    tx.onerror = () => { /* report at transaction abort, after rollback */ };
    const fail = (error: Error) => { cause = error; tx.abort(); };
    try { work(tx, (next) => { value = next; }, fail); }
    catch (e) { fail(e instanceof Error ? e : new Error('Ошибка хранилища.')); }
  });
}
const damaged = (message = 'Сохранённый проект не прошёл проверку. Исходная запись оставлена.') =>
  new ProjectStoreError('corrupt', message);
function serialize(workspace: Workspace, generation: number): Stored {
  const result = writeWorkspace(workspace);
  if (!result.ok) throw damaged(result.diagnostics[0].message);
  const { projectId, title, revision } = workspace.project;
  return { projectId, title, revision, updatedAt: Date.now(), version: 2, generation, json: result.value };
}

export function projectRepository(factory: IDBFactory) {
  async function using<T>(fn: (db: IDBDatabase) => Promise<T>) {
    const db = await open(factory);
    try { return await fn(db); } finally { db.close(); }
  }
  function get(id: string): Promise<SavedProject | null> {
    return using((db) => transact<SavedProject | null>(db, [projects, index, backups], 'readwrite', (tx, set, fail) => {
      const store = tx.objectStore(projects), req = store.get(id);
      req.onsuccess = () => {
        const old = req.result;
        if (!old) { set(null); return; }
        if (old.version === 1) {
          const parsed = parseProject(old.project);
          if (!parsed.ok || parsed.value.projectId !== id) { fail(damaged()); return; }
          const workspace = { project: parsed.value, ...emptyArtifacts() };
          let saved: Stored;
          try { saved = serialize(workspace, 1); }
          catch (e) { fail(e instanceof Error ? e : damaged()); return; }
          tx.objectStore(backups).add(old, 'v1:' + id);
          store.put(saved, id);
          putIndex(tx, saved);
          set({ workspace, generation: 1 });
          return;
        }
        if (old.version !== 2 || !Number.isSafeInteger(old.generation) || old.generation < 1 || typeof old.json !== 'string') { fail(damaged()); return; }
        const parsed = readWorkspace(old.json);
        if (!parsed.ok || parsed.value.project.projectId !== id) { fail(damaged()); return; }
        set({ workspace: parsed.value, generation: old.generation });
      };
    }));
  }
  function putIndex(tx: IDBTransaction, entry: IndexEntry) {
    const { projectId, title, revision, updatedAt } = entry;
    tx.objectStore(index).put({ projectId, title, revision, updatedAt }, projectId);
  }
  return {
    get,
    async last(): Promise<SavedProject | null> {
      const name = await using((db) => transact<unknown>(db, [meta], 'readonly', (tx, set) => {
        const req = tx.objectStore(meta).get('last'); req.onsuccess = () => set(req.result);
      }));
      return typeof name === 'string' ? get(name) : null;
    },
    list(): Promise<IndexEntry[]> {
      return using((db) => transact<IndexEntry[]>(db, [index], 'readonly', (tx, set) => {
        const req = tx.objectStore(index).getAll();
        req.onsuccess = () => set((req.result as IndexEntry[]).sort((a, b) => b.updatedAt - a.updatedAt));
      }));
    },
    originalBackup(id: string): Promise<unknown> {
      return using((db) => transact<unknown>(db, [backups], 'readonly', (tx, set) => {
        const req = tx.objectStore(backups).get('v1:' + id); req.onsuccess = () => set(req.result);
      }));
    },
    save(workspace: Workspace, expected: number | null): Promise<SavedProject> {
      const saved = serialize(workspace, (expected ?? 0) + 1);
      return using((db) => transact<SavedProject>(db, [projects, meta, index], 'readwrite', (tx, set, fail) => {
        const store = tx.objectStore(projects), id = saved.projectId;
        const req = store.get(id);
        req.onsuccess = () => {
          const current = req.result;
          const actual = !current ? null : current.version === 2 ? current.generation : -1;
          if (actual !== expected || current && current.revision > saved.revision || !Number.isSafeInteger(saved.generation)) {
            fail(new ProjectStoreError('conflict', 'Проект изменён в другом окне. Сохраните независимую копию.')); return;
          }
          store.put(saved, id);
          putIndex(tx, saved);
          tx.objectStore(meta).put(id, 'last');
          set({ generation: saved.generation, workspace });
        };
      }));
    },
  };
}
