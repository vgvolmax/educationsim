import { useEffect, useState } from 'react';
import { Editor } from '../editor/Editor';
import { editorId, useProject } from '../editor/useProject';
import { createEmptyProject } from '../project/editor-geometry';
import { createTemplateProject, templateIds } from '../project/templates';
import type { TemplateId } from '../project/templates';
import './shell.css';

export function App() {
  const ctl = useProject();
  const [editing, setEditing] = useState(false);
  const [preset, setPreset] = useState<TemplateId | undefined>();
  const [runtime, setRuntime] = useState('Проверяем локальные ресурсы…');
  useEffect(() => {
    const signal = new AbortController();
    let worker: Worker;
    try {
      worker = new Worker(new URL('./readiness.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      setRuntime('Не удалось загрузить локальные ресурсы');
      return;
    }
    const timer = setTimeout(() => {
      signal.abort();
      worker.terminate();
      setRuntime('Не удалось загрузить локальные ресурсы');
    }, 8_000);
    const workerReady = new Promise<void>((resolve, reject) => {
      worker.addEventListener('message', (event) => {
        if (event.data === 'ready') resolve();
        else reject(new Error('Unexpected runtime handshake'));
      }, { once: true });
      worker.addEventListener('error', reject, { once: true });
    });
    const resources = fetch('./runtime.json', { signal: signal.signal }).then(async (response) => {
      if (!response.ok || (await response.json()).format !== 1) throw new Error('Invalid runtime asset');
    });
    void Promise.all([workerReady, resources]).then(() => {
      setRuntime('Автономная среда готова');
    }).catch(() => {
      if (!signal.signal.aborted) setRuntime('Не удалось загрузить локальные ресурсы');
    }).finally(() => {
      clearTimeout(timer);
      worker.terminate();
    });
    return () => { clearTimeout(timer); signal.abort(); worker.terminate(); };
  }, []);

  function launch(template?: TemplateId) {
    if (ctl.history && !window.confirm('Заменить текущий проект? Изменения этого сеанса не сохранены.')) return;
    if (!template) ctl.open(createEmptyProject(editorId('project')));
    else {
      const result = createTemplateProject(template, editorId('project'));
      if (!result.ok) { ctl.setError(result.diagnostics[0].message); return; }
      ctl.open(result.value);
    }
    setPreset(template);
    setEditing(true);
  }
  if (editing && ctl.history) return <Editor project={ctl.history.current} preset={preset} ctl={ctl} onHome={() => setEditing(false)} />;
  return (
    <main className="shell">
      <p className="eyebrow">Учебная лаборатория · Волмакс</p>
      <h1>Волмакс · Тёплый пол</h1>
      <p className="intro">Конструктор водяного напольного отопления.</p>
      <div className="actions">
        <button className="primary" onClick={() => launch()}>Новый проект</button>
        {ctl.history && <button onClick={() => setEditing(true)}>Вернуться к текущему проекту</button>}
      </div>
      {ctl.error && <p role="alert">{ctl.error}</p>}
      <section aria-label="Стартовые схемы" className="template-section">
        <h2>Стартовые схемы</h2><p>Откройте учебную схему как отдельный проект.</p>
        <div className="template-list">{templateIds.map((id) => {
          const result = createTemplateProject(id, 'preview');
          return result.ok && <button key={id} onClick={() => launch(id)}>{result.value.title}</button>;
        })}</div>
      </section>
      <footer>
        <p role="status">{runtime}</p>
        <a href="https://volmax.ru/catalog/" target="_blank" rel="noreferrer">Каталог ВОЛМАКС ↗</a>
      </footer>
    </main>
  );
}
