import { FilePicker } from '../ui/FilePicker';
import { useRef, useState } from 'react';
import { readWorkspace, workspaceLimit, writeWorkspace } from './project-transfer';
import type { Workspace } from './project-transfer';
import type { useAutosave } from './useAutosave';
import type { WorkspaceDesktop } from './desktop-api';
import './workspace.css';

async function exportWorkspace(workspace: Workspace) {
  const result = writeWorkspace(workspace);
  if (!result.ok) throw new Error(result.diagnostics[0].message);
  const bridge: WorkspaceDesktop | undefined = window.educationWorkspace;
  if (bridge) {
    if (await bridge.exportJson(result.value) === 'failed') throw new Error('Не удалось сохранить выбранный файл.');
    return;
  }
  const url = URL.createObjectURL(new Blob([result.value], { type: 'application/json;charset=utf-8' }));
  const button = document.createElement('a');
  button.href = url; button.download = 'EducationSim-проект.json';
  document.body.append(button); button.click(); button.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function WorkspaceTools({ workspace, save, onImport, onDuplicate }: {
  workspace: Workspace | null; save: ReturnType<typeof useAutosave>; onImport(next: Workspace): Promise<boolean>; onDuplicate(): void;
}) {
  const [candidate, setCandidate] = useState<Workspace | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const latest = useRef(0);
  async function preview(file: File | undefined) {
    const key = ++latest.current;
    setCandidate(null); setMessage(''); setError('');
    if (!file) return;
    if (file.size > workspaceLimit) { setError('Файл проекта превышает 12 МиБ.'); return; }
    setReading(true);
    try {
      const result = readWorkspace(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
      if (key !== latest.current) return;
      if (result.ok) setCandidate(result.value);
      else setError(result.diagnostics.map((d) => d.message).join(' '));
    } catch {
      if (key === latest.current) setError('Файл должен быть в читаемом формате UTF-8.');
    } finally { if (key === latest.current) setReading(false); }
  }
  async function download() {
    if (!workspace) return;
    try { await exportWorkspace(workspace); setMessage('Экспорт завершён или отменён в диалоге.'); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Экспорт не выполнен.'); }
  }

  return <section className="workspace-tools" aria-label="Файлы проекта">
    <div className="workspace-actions">
      <FilePicker label="Импорт проекта JSON" accept=".json,application/json" onChoose={(file) => { void preview(file); }} />
      {workspace && <button onClick={() => { void download(); }}>Экспорт проекта и прогонов</button>}
      {workspace && <button onClick={onDuplicate}>Создать копию проекта</button>}
      {workspace && <p className="save-state" data-save={save.state.error ? 'error' : save.state.saving || save.state.dirty || !save.state.hasSaved ? 'pending' : 'ready'}>{save.state.error ? 'Не удалось сохранить.' : save.state.saving ? 'Сохраняем локально…' : save.state.dirty || !save.state.hasSaved ? 'Есть несохранённые изменения.' : 'Проект сохранён локально.'}</p>}
    </div>
    {reading && <p>Проверяем файл…</p>}
    {error && <div className="workspace-warning" role="alert"><strong>Импорт не выполнен.</strong> {error}</div>}
    {message && <p>{message}</p>}
    {candidate && <div className="workspace-candidate">
      <p>Проверен проект «{candidate.project.title}», редакция {candidate.project.revision}. Записей расчёта: {candidate.records.length}.</p>
      <button onClick={() => { void onImport(candidate).then((opened) => { if (opened) setCandidate(null); }); }}>Открыть отдельную копию</button>
      <button onClick={() => setCandidate(null)}>Не импортировать</button>
    </div>}
    {save.state.error && <div className="workspace-warning" role="alert">
      <p>{save.state.error}</p><button onClick={() => { void save.flush(); }}>Повторить сохранение</button>
      <button onClick={() => { void download(); }}>Экспортировать текущие изменения</button>
      {save.state.conflict && <button onClick={onDuplicate}>Сохранить независимую копию</button>}
    </div>}
    {save.closeToken && <div className="workspace-warning" role="alertdialog" aria-label="Не удалось закрыть с сохранением">
      <p>Окно оставлено открытым. Сохранение при закрытии не удалось.</p>
      <button onClick={() => { void save.finishClose(false); }}>Повторить и закрыть</button>
      <button onClick={() => { void download(); }}>Экспортировать и оставить окно</button>
      <button onClick={() => { void save.finishClose(true); }}>Закрыть без сохранения</button>
    </div>}
  </section>;
}
