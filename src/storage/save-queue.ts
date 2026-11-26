import type { Workspace } from './project-transfer';
import type { SavedProject } from './projects';

type State = { dirty: boolean; saving: boolean; error: string; conflict: boolean; hasSaved: boolean };
type Writer = (workspace: Workspace, expected: number | null) => Promise<SavedProject>;
const delay = 500;
export function createSaveQueue(write: Writer, changed: (state: State) => void = () => {}) {
  let pending: Workspace | null = null, generation: number | null = null;
  let sequence = 0, committed = 0, saving = false, error = '', conflict = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let task: Promise<boolean> | null = null;
  const state = () => ({ dirty: sequence !== committed, saving, error, conflict, hasSaved: generation !== null });
  const notify = () => changed(state());
  const clear = () => { clearTimeout(timer); timer = undefined; };
  function select(loaded: SavedProject | null) {
    if (saving) throw new Error('Нельзя переключать проект во время записи.');
    clear();
    generation = loaded?.generation ?? null; pending = loaded?.workspace ?? null;
    sequence = 0; committed = 0; error = ''; conflict = false;
    notify();
  }
  function change(workspace: Workspace) {
    pending = workspace; sequence++; notify(); clear();
    timer = setTimeout(() => { void flush(); }, delay);
  }
  function flush(): Promise<boolean> {
    clear();
    if (task) return task;
    if (!pending || sequence === committed) return Promise.resolve(true);
    saving = true; error = ''; conflict = false; notify();
    task = flushLoop().finally(() => { task = null; saving = false; notify(); });
    return task;
  }
  async function flushLoop(): Promise<boolean> {
    try {
      while (pending && sequence !== committed) {
        const latest = sequence;
        const receipt = await write(pending, generation);
        generation = receipt.generation; committed = latest;
      }
      return true;
    } catch (e) {
      conflict = !!e && typeof e === 'object' && 'code' in e && e.code === 'conflict';
      error = e instanceof DOMException && e.name === 'QuotaExceededError'
        ? 'Недостаточно места для сохранения. Освободите место или экспортируйте проект.'
        : e instanceof Error ? e.message : 'Автосохранение не завершилось.';
      return false;
    }
  }
  return { state, select, change, flush, current: () => pending, cancelTimer: clear };
}
