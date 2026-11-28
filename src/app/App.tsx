import { useCallback, useEffect, useMemo, useState } from 'react';
import { HomeHero } from './HomeHero';
import { Editor } from '../editor/Editor';
import { editorId, useProject } from '../editor/useProject';
import { createEmptyProject } from '../project/editor-geometry';
import { createTemplateProject, templateIds } from '../project/templates';
import type { TemplateId } from '../project/templates';
import { WorkspaceSaveStatus, WorkspaceTools } from '../storage/WorkspaceTools';
import { useAutosave } from '../storage/useAutosave';
import { cloneWorkspace, emptyArtifacts } from '../storage/project-transfer';
import type { Workspace } from '../storage/project-transfer';
import type { SavedProject } from '../storage/projects';
import { LessonLauncher } from '../lessons/LessonLauncher';
import { LessonPanel } from '../lessons/LessonPanel';
import { prepareLesson } from '../lessons/authoring';
import { firstLesson } from '../lessons/first-lesson';
import type { Lesson, PreparedLesson } from '../lessons/authoring';
import { lessonLibrary } from '../lessons/lesson-library';
import { lessonKey, listPassedLessons, saveLessonPass } from '../lessons/progress';
import './shell.css';

export function App() {
  const ctl = useProject();
  const [lesson, setLesson] = useState<{ prepared: PreparedLesson; bundled: boolean } | null>(null);
  const [passed, setPassed] = useState<ReadonlySet<string>>(() => new Set());
  const [learningError, setLearningError] = useState('');
  const [returnToLessons, setReturnToLessons] = useState(false);
  const [editing, setEditing] = useState(false);
  const [preset, setPreset] = useState<TemplateId | undefined>();
  const [artifacts, setArtifacts] = useState(emptyArtifacts);
  const workspace = useMemo<Workspace | null>(() => ctl.history ? { project: ctl.history.current, preset, ...artifacts } : null,
    [ctl.history, preset, artifacts]);
  const save = useAutosave(workspace);
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

  useEffect(() => {
    let current = true;
    void listPassedLessons().then((saved) => {
      if (current) setPassed((previous) => new Set([...previous, ...saved]));
    }).catch(() => {
      if (current) setLearningError('Не удалось прочитать локальный прогресс.');
    });
    return () => { current = false; };
  }, []);
  useEffect(() => {
    if (!returnToLessons || lesson || editing) return;
    document.getElementById('lessons')?.focus();
    setReturnToLessons(false);
  }, [returnToLessons, lesson, editing]);
  const onPassed = useCallback((definition: Lesson) => {
    const key = lessonKey(definition);
    setPassed((previous) => previous.has(key) ? previous : new Set([...previous, key]));
    void saveLessonPass(definition).catch(() => setLearningError('Не удалось сохранить отметку о прохождении.'));
  }, []);

  function pick(next: Workspace, saved: SavedProject | null) {
    setLesson(null); save.select(saved); ctl.open(next.project); setPreset(next.preset);
    setArtifacts({ captures: next.captures, records: next.records }); setEditing(true);
  }
  function openLesson(prepared: PreparedLesson, bundled = false) {
    setEditing(false);
    setLesson({ prepared, bundled });
  }
  function openBundledLesson(definition: Lesson) {
    const result = prepareLesson(definition);
    if (result.ok) openLesson(result.value, true);
    else ctl.setError(result.diagnostics[0].message);
  }
  async function launch(template?: TemplateId) {
    if (!await save.flush()) return;
    if (!template) pick({ project: createEmptyProject(editorId('project')), ...emptyArtifacts() }, null);
    else {
      const result = createTemplateProject(template, editorId('project'));
      if (!result.ok) { ctl.setError(result.diagnostics[0].message); return; }
      pick({ project: result.value, preset: template, ...emptyArtifacts() }, null);
    }
  }
  async function restore(id: string) {
    if (!await save.flush()) return;
    if (id === workspace?.project.projectId) { setEditing(true); return; }
    try {
      const known = await save.repo.get(id);
      if (known) pick(known.workspace, known);
    } catch (e) { ctl.setError(e instanceof Error ? e.message : 'Проект не удалось открыть.'); }
  }
  const tools = (showSaveStatus = true) => <WorkspaceTools workspace={workspace} save={save} showSaveStatus={showSaveStatus}
    onImport={async (next) => {
      if (!await save.flush()) return false;
      pick(cloneWorkspace(next, editorId('project')), null); return true;
    }}
    onDuplicate={() => {
      if (!workspace || save.state.saving) return;
      pick(cloneWorkspace(workspace, editorId('project')), null);
    }} />;
  if (lesson) {
    const definition = lesson.prepared.definition;
    const index = lessonLibrary.findIndex((candidate) => candidate.id === definition.id);
    const next = lesson.bundled && index >= 0 ? lessonLibrary[index + 1] : undefined;
    return <>{save.closeToken && tools()}<LessonPanel key={(lesson.bundled ? 'bundled:' : 'preview:') + definition.id}
      lesson={lesson.prepared} bundled={lesson.bundled} introductory={lesson.bundled && definition.id === firstLesson.id}
      onBack={() => { setLesson(null); setReturnToLessons(true); }} onNext={next && (() => openBundledLesson(next))}
      onPassed={onPassed} onEditor={(seed) => {
        void save.flush().then((committed) => { if (committed) pick({ ...seed, ...emptyArtifacts() }, null); });
      }} /></>;
  }
  if (editing && ctl.history) return <Editor files={tools(false)} fileStatus={<WorkspaceSaveStatus state={save.state} />}
    fileAttention={Boolean(save.closeToken || save.state.error)} project={ctl.history.current} preset={preset} ctl={ctl}
    artifacts={artifacts} onArtifacts={setArtifacts} onHome={() => setEditing(false)} />;
  return (
    <main className="shell">
      <div className="home-brand"><span className="brand-mark" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 4v5a3 3 0 0 0 3 3h7m-4-4 4 4-4 4"
          stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span><strong>EducationSim</strong><span>Тренажёр для менеджеров</span></div>
      <HomeHero lessonMinutes={firstLesson.minutes} actions={<>
        <button className="primary" onClick={() => openBundledLesson(firstLesson)}>Начать первый урок</button>
        <button onClick={() => { void launch(); }}>Новый проект</button>
        {ctl.history && <button onClick={() => setEditing(true)}>Вернуться к текущему проекту</button>}
      </>} />
      {tools()}
      {save.error && <p role="alert">{save.error}</p>}
      {save.recent.length > 0 && <section className="recent-projects" aria-label="Локальные проекты">
        <h2>Локальные проекты</h2>
        {save.last && <button onClick={() => { void restore(save.last); }}>Открыть последний сохранённый проект</button>}
        <ul>{save.recent.slice(0, 50).map((p) => <li key={p.projectId}><button onClick={() => { void restore(p.projectId); }}>
          {p.title} · редакция {p.revision}</button></li>)}</ul>
      </section>}
      {ctl.error && <p role="alert">{ctl.error}</p>}
      <section aria-label="Стартовые схемы" className="template-section">
        <div className="home-section-heading"><div><p className="eyebrow">Конструктор</p><h2>Стартовые схемы</h2></div>
          <p>Откройте учебную схему как отдельный проект.</p></div>
        <div className="template-list">{templateIds.map((id, index) => {
          const result = createTemplateProject(id, 'preview');
          return result.ok && <button key={id} onClick={() => { void launch(id); }}><span className="card-index" aria-hidden="true">
            {String(index + 1).padStart(2, '0')}</span>{result.value.title}</button>;
        })}</div>
      </section>
      <LessonLauncher launch={openLesson} passed={passed} progressError={learningError} />
      <footer>
        <p role="status">{runtime}</p>
        <a href="https://volmax.ru/catalog/" target="_blank" rel="noreferrer">Каталог ВОЛМАКС</a>
      </footer>
    </main>
  );
}
