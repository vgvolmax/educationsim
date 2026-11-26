import { useEffect, useRef, useState } from 'react';
import { Schematic } from '../views/schematic/Schematic';
import { editorId } from '../editor/useProject';
import { createSimulationClient } from '../worker/client';
import type { PreparedLesson } from './authoring';
import { admittedAction, applyLessonAction, freeCopy, gradeLesson, startLessonState } from './lesson';
import type { LessonState } from './lesson';
import type { SessionView } from '../simulation/session';
import type { SimulationRecord } from '../simulation/replay';
import type { WorkspaceDesktop } from '../storage/desktop-api';
import './lesson.css';

type Client = ReturnType<typeof createSimulationClient>;
type Props = { lesson: PreparedLesson; onBack(): void; onEditor(seed: NonNullable<ReturnType<typeof freeCopy>>): void };

export function LessonPanel({ lesson, onBack, onEditor }: Props) {
  const [state, setState] = useState<LessonState>(() => startLessonState(lesson));
  const [sessionKey, setSessionKey] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [hint, setHint] = useState<number>(0);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [, redraw] = useState(0);
  const clients = useRef(new Map<string, Client>());
  const bound = lesson.cases.find(({ definition }) => definition.id === state.caseId)!;
  const views: Record<string, SessionView | undefined> = Object.fromEntries([...clients.current].map(([id, client]) =>
    [id, client.state.view ?? undefined]));
  const view = views[state.caseId];
  const grade = gradeLesson(lesson, state, views);

  useEffect(() => {
    const running = clients.current, stamps = new Map<string, Client['state']>();
    const timer = setInterval(() => {
      let dirty = false;
      for (const [id, client] of running) {
        if (client.state !== stamps.get(id)) { stamps.set(id, client.state); dirty = true; }
      }
      if (dirty) redraw((n) => n + 1);
    }, 60);
    return () => {
      clearInterval(timer);
      for (const client of running.values()) client.dispose();
      running.clear();
    };
  }, [lesson, sessionKey]);

  useEffect(() => {
    const key = bound.definition.id;
    if (clients.current.has(key)) return;
    const client = createSimulationClient();
    clients.current.set(key, client);
    client.load(editorId('lesson'), bound.scenario);
  }, [bound, sessionKey]);

  function perform(actionId: string) {
    const action = admittedAction(lesson, state, actionId);
    if (!action) { setError('Это действие недоступно в текущем задании.'); return; }
    const client = clients.current.get(state.caseId);
    if (action.type === 'step' || action.type === 'command') {
      if (!client || client.state.mode !== 'paused') { setError('Сначала дождитесь готовности модели.'); return; }
      const sent = action.type === 'step' ? client.send({ kind: 'advance', ticks: action.ticks ?? 1 })
        : client.send({ kind: 'command', command: action.command }) && client.send({ kind: 'step' });
      if (!sent) { setError('Расчёт не принял действие.'); return; }
    }
    if (action.type === 'inspect') setHighlight(action.target);
    if (action.type === 'case') setHighlight(null);
    setState(applyLessonAction(state, action)); setError('');
  }
  function inspect(target: string) {
    const option = lesson.definition.actions.find((action) => action.type === 'inspect' && action.target === target &&
      (!action.forCase || action.forCase === state.caseId));
    if (option) perform(option.id);
  }
  async function report() {
    setExporting(true);
    setError('');
    try {
      const entries = [...clients.current];
      const receipts = await Promise.all(entries.map(async ([id, client]): Promise<[string, SimulationRecord | null]> => {
        const original = client.state.record;
        if (!client.send({ kind: 'record' })) return [id, null];
        const end = performance.now() + 1500;
        while (client.state.record === original && performance.now() < end) await new Promise((r) => setTimeout(r, 35));
        return [id, client.state.record !== original ? client.state.record : null];
      }));
      const report = JSON.stringify({ format: 'educationsim-lesson-result', version: 1, lesson: lesson.definition.id,
        lessonVersion: lesson.definition.version, state, grade, records: Object.fromEntries(receipts) });
      const bridge: WorkspaceDesktop | undefined = window.educationWorkspace;
      if (bridge) {
        if (await bridge.exportJson(report) === 'failed') throw new Error('Не удалось сохранить отчёт.');
      } else {
        const href = URL.createObjectURL(new Blob([report], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = href; a.download = lesson.definition.id + '-результат.json'; document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось подготовить отчёт.'); }
    finally { setExporting(false); }
  }

  return <main className="lesson-bench">
    <header>
      <button onClick={onBack}>← Старт</button>
      <div><p className="eyebrow">Урок {lesson.definition.id} · {lesson.definition.minutes} мин</p><h1>{lesson.definition.title}</h1></div>
    </header>
    <p className="lesson-goal">{lesson.definition.goal}</p>
    <div className="lesson-grid">
      <section aria-label="Схема урока">
        <div className="lesson-case"><strong>{bound.definition.title}</strong><span>{view ? 'Модельный тик: ' + view.snapshot.tick : 'Готовим учебную схему…'}</span></div>
        <Schematic project={bound.project} level={bound.project.viewPreferences.level} selected={highlight} selectedLink={highlight}
          onSelect={inspect} onLinkSelect={inspect} water control />
        <section className="lesson-actions" aria-label="Разрешённые действия">
          {lesson.definition.actions.filter((a) => !a.forCase || a.forCase === state.caseId).map((a) => <button key={a.id} onClick={() => perform(a.id)}
            disabled={(a.type === 'step' || a.type === 'command') && clients.current.get(state.caseId)?.state.mode !== 'paused'}
            aria-pressed={a.type === 'answer' ? state.answers[a.field] === a.value : undefined}>{a.label}</button>)}
        </section>
      </section>
      <aside className="lesson-rubric">
        <h2>Проверка задания</h2>
        <p role="status">{grade.passed ? 'Урок пройден.' : grade.status === 'partial' ? 'Частичный результат.' : 'Задание ещё не выполнено.'} {grade.count} из {grade.total}.</p>
        {grade.passed && <p className="lesson-passed">Урок пройден.</p>}
        <ul>{grade.rows.map((row) => {
          const rule = lesson.definition.criteria.find((entry) => entry.id === row.id);
          const metric = rule && 'metric' in rule ? rule.metric : null;
          const scale = metric === 'flow' ? 60000 : metric === 'opening' ? 100 : metric === 'pressure' ? .001 : 1;
          const unit = metric === 'flow' ? ' л/мин' : metric === 'opening' ? ' %' : metric === 'pressure' ? ' кПа' :
            metric === 'power' ? ' Вт' : ' °C';
          return <li key={row.id}><strong>{row.passed ? 'Да' : 'Ещё нет'}</strong> · {row.label}
            {row.actual === null ? ' · Нет данных' : row.actual === undefined ? '' :
              ' · ' + (row.actual * scale).toFixed(2).replace('.', ',') + unit}</li>;
        })}</ul>
        {Object.entries(state.basket).some(([, n]) => n > 0) && <p>Набор: {Object.entries(state.basket).filter(([, n]) => n > 0).map(([id, n]) => id + ' ×' + n).join(', ')}.</p>}
        {!grade.passed && hint < lesson.definition.hints.length && <button onClick={() => setHint((n) => n + 1)}>Показать подсказку</button>}
        {lesson.definition.hints.slice(0, hint).map((text) => <p key={text} className="lesson-hint">{text}</p>)}
        {grade.passed && <p className="lesson-hint">{lesson.definition.explanation}</p>}
      </aside>
    </div>
    {(error || view?.stale || view?.mode === 'stopped') && <p role="alert" className="lesson-warning">{error ||
      view?.diagnostics.map((d) => d.message).join(' ') || 'Прогон остановлен. Сбросьте попытку.'}</p>}
    <div className="lesson-actions">
      <button onClick={() => { setState(startLessonState(lesson)); setSessionKey((n) => n + 1); setError(''); setHint(0); setHighlight(null); }}>Начать попытку заново</button>
      <button onClick={() => { const seed = freeCopy(lesson, state.caseId, editorId('project')); if (seed) onEditor(seed); }}>Открыть свободную копию</button>
      <button disabled={exporting || state.actions.length === 0} onClick={() => { void report(); }}>Сохранить отчёт наставнику</button>
    </div>
  </main>;
}
