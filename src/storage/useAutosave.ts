import { useEffect, useLayoutEffect, useState } from 'react';
import { createSaveQueue } from './save-queue';
import { projectRepository } from './projects';
import type { SavedProject } from './projects';
import type { Workspace } from './project-transfer';
import type { WorkspaceDesktop } from './desktop-api';

const initial = { dirty: false, saving: false, error: '', conflict: false, hasSaved: false };

export function useAutosave(workspace: Workspace | null) {
  const [state, setState] = useState(initial);
  const [closeToken, setCloseToken] = useState('');
  const [recent, setRecent] = useState<Awaited<ReturnType<ReturnType<typeof projectRepository>['list']>>>([]);
  const [last, setLast] = useState('');
  const [error, setError] = useState('');
  const [repository] = useState(() => projectRepository(indexedDB));
  const refresh = () => repository.list().then(setRecent).catch(() => setError('Список локальных проектов недоступен.'));
  const [queue] = useState(() => createSaveQueue(async (current, expected) => {
    const saved = await repository.save(current, expected);
    setLast(current.project.projectId);
    void refresh();
    return saved;
  }, setState));

  useEffect(() => {
    let disposed = false;
    void repository.last().then((saved) => {
      if (!disposed && saved) setLast(saved.workspace.project.projectId);
    }).catch(() => { if (!disposed) setError('Последний локальный проект не удалось восстановить.'); })
      .finally(() => { if (!disposed) void refresh(); });
    return () => { disposed = true; queue.cancelTimer(); };
  }, [repository, queue]);

  useLayoutEffect(() => {
    if (!workspace) return;
    const known = queue.current();
    if (known && known.project === workspace.project && known.captures === workspace.captures && known.records === workspace.records) return;
    queue.change(workspace);
  }, [queue, workspace]);

  useEffect(() => {
    const bridge: WorkspaceDesktop | undefined = window.educationWorkspace;
    const stop = bridge?.onPrepareClose((token) => {
      void queue.flush().then((ready) => {
        setCloseToken(ready ? '' : token);
        bridge.finishClose(token, ready);
      });
    });
    function before(event: BeforeUnloadEvent) {
      if (!bridge && queue.state().dirty) { event.preventDefault(); event.returnValue = ''; }
    }
    window.addEventListener('beforeunload', before);
    return () => { stop?.(); window.removeEventListener('beforeunload', before); };
  }, [queue]);

  async function finishClose(force: boolean) {
    if (!closeToken) return;
    if (force || await queue.flush()) { window.educationWorkspace?.finishClose(closeToken, true); setCloseToken(''); }
  }
  function select(saved: SavedProject | null) { queue.select(saved); }
  return { state, closeToken, finishClose, recent, last, error, select, flush: queue.flush, repo: repository };
}
