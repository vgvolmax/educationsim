import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Schematic } from '../views/schematic/Schematic';
import { editorId } from '../editor/useProject';
import { createSimulationClient } from '../worker/client';
import type { Lesson, LessonAction, LessonCase, LessonCriterion, LessonMetric, PreparedLesson } from './authoring';
import { admittedAction, applyLessonAction, freeCopy, gradeLesson, observe, startLessonState, stepTicks } from './lesson';
import type { LessonState } from './lesson';
import { FirstLessonGuide, FirstLessonProgress } from './FirstLessonGuide';
import { answerGroups, LessonBasket, LessonQuestions, LessonResponses } from './LessonAssessment';
import { listAttempts, saveAttempt } from './progress';
import type { LessonAttempt } from './progress';
import type { SessionView } from '../simulation/session';
import type { SimulationRecord } from '../simulation/replay';
import { equipmentRegistry } from '../project/registry';
import './lesson.css';

const LessonSource = lazy(() => import('./LessonSource').then((module) => ({ default: module.LessonSource })));
type Client = ReturnType<typeof createSimulationClient>;
type Grade = ReturnType<typeof gradeLesson>;
type Views = Record<string, SessionView | undefined>;
type Props = {
  lesson: PreparedLesson; introductory?: boolean; bundled: boolean;
  onBack(): void; onNext?: () => void; onPassed(lesson: Lesson): void;
  onEditor(seed: NonNullable<ReturnType<typeof freeCopy>>): void;
};

const measurementNames: Record<LessonMetric, string> = {
  flow: 'Расход', pressure: 'Давление', opening: 'Открытие', power: 'Мощность',
  roomTemperature: 'Температура воздуха', waterTemperature: 'Температура воды', surfaceTemperature: 'Температура поверхности',
};

function measurementLabel(rule: Extract<LessonCriterion, { type: 'range' }>, selectedCase: LessonCase) {
  const project = selectedCase.project;
  const link = project.hydronicLinks.find(({ id }) => rule.target === 'link:' + id);
  const branch = link && project.loopRoutes.find(({ linkId }) => linkId === link.id);
  const loop = branch && /^(?:supply|return)-(\d+)$/.exec(link.from.portId);
  if (loop) return measurementNames[rule.metric] + ' · Петля ' + loop[1];
  const component = project.components.find(({ id }) => rule.target === id);
  const room = project.rooms.find(({ id }) => rule.target === id);
  const destination = link && project.components.find(({ id }) => id === link.to.componentId);
  const equipment = component ?? destination;
  return measurementNames[rule.metric] + ' · ' + (room?.name ?? (equipment && equipmentRegistry.get(equipment.typeId)?.titleRu) ?? rule.target);
}

function reading(metric: LessonMetric, value: number) {
  const scale = metric === 'flow' ? 60000 : metric === 'opening' ? 100 : metric === 'pressure' ? .001 : 1;
  const unit = metric === 'flow' ? 'л/мин' : metric === 'opening' ? '%' : metric === 'pressure' ? 'кПа' :
    metric === 'power' ? 'Вт' : '°C';
  return (value * scale).toFixed(2).replace('.', ',') + ' ' + unit;
}

function Criteria({ lesson, grade, showTargets }: { lesson: Lesson; grade: Grade; showTargets?: boolean }) {
  return <>
    <p className="lesson-score" role="status">
      <strong>{grade.passed ? 'Урок пройден.' : grade.status === 'partial' ? 'Частичный результат.' : 'Задание ещё не выполнено.'}</strong>
      {' '}{grade.count} из {grade.total}
    </p>
    <ul className="criteria-list">{grade.rows.map((row, i) => {
      const rule = lesson.criteria[i]!;
      const actual = 'metric' in rule && row.actual !== undefined ?
        ' · ' + (row.actual === null ? 'Нет данных' : reading(rule.metric, row.actual)) : '';
      return <li key={row.id} data-passed={row.passed}><strong>{row.passed ? 'Да' : 'Ещё нет'}</strong> · {row.label}{actual}
        {showTargets && rule.type === 'range' && !row.passed && <small>Цель {reading(rule.metric, rule.min)} — {reading(rule.metric, rule.max)}</small>}
      </li>;
    })}</ul>
  </>;
}

function StandReadings({ lesson, views }: { lesson: PreparedLesson; views: Views }) {
  const difference = lesson.definition.criteria.find((rule) => rule.type === 'difference');
  if (!difference) return null;
  const current = difference.caseId ?? lesson.cases[0]!.definition.id;
  const left = views[difference.otherCase], right = views[current];
  const rows = [
    { id: difference.otherCase, view: left, target: difference.otherTarget ?? difference.target },
    { id: current, view: right, target: difference.target },
  ];
  return <section className="stand-readings" aria-label="Сравнение стендов">
    <h2>Сравнение стендов</h2>
    <table><thead><tr><th scope="col">Режим</th><th scope="col">Тик</th><th scope="col">{measurementNames[difference.metric]}</th></tr></thead>
      <tbody>{rows.map(({ id, view, target }) => {
        const value = observe(view, difference.metric, target);
        return <tr key={id}><th scope="row">{lesson.cases.find(({ definition }) => definition.id === id)?.definition.title ?? id}</th>
          <td>{view?.snapshot.tick || '—'}</td><td>{value === null ? 'Нет замера' : reading(difference.metric, value)}</td></tr>;
      })}</tbody>
    </table>
    {difference.matchTick !== false && left?.snapshot.tick !== right?.snapshot.tick &&
      <p>Для сравнения снимите показания обоих стендов на одном модельном тике.</p>}
  </section>;
}

async function captureRecords(clients: ReadonlyMap<string, Client>) {
  const receipts = await Promise.all([...clients].map(async ([id, client]): Promise<[string, SimulationRecord | null]> => {
    if (!client.state.view?.snapshot.tick || client.state.mode === 'stalled') return [id, null];
    const original = client.state.record;
    if (!client.send({ kind: 'record' })) return [id, null];
    const end = performance.now() + 1500;
    while (client.state.record === original && performance.now() < end) await new Promise((resolve) => setTimeout(resolve, 35));
    return [id, client.state.record !== original ? client.state.record : null];
  }));
  return Object.fromEntries(receipts);
}

export function LessonPanel({ lesson, introductory, bundled, onBack, onNext, onEditor, onPassed }: Props) {
  const definition = lesson.definition;
  const assessed = definition.feedback === 'on-submit';
  const [state, setState] = useState<LessonState>(() => startLessonState(lesson));
  const [sessionKey, setSessionKey] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [hint, setHint] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempts, setAttempts] = useState<LessonAttempt[]>([]);
  const [selectedAttempt, setSelectedAttempt] = useState<LessonAttempt | null>(null);
  const [historyLoading, setHistoryLoading] = useState(bundled && assessed);
  const [unsavedAttempt, setUnsavedAttempt] = useState<string | null>(null);
  const [draftStarted, setDraftStarted] = useState(false);
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const [, redraw] = useState(0);
  const clients = useRef(new Map<string, Client>());
  const heading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const bound = lesson.cases.find(({ definition }) => definition.id === state.caseId)!;
  const views: Views = Object.fromEntries([...clients.current].map(([id, client]) => [id, client.state.view ?? undefined]));
  const view = views[state.caseId];
  const client = clients.current.get(state.caseId);
  const grade = gradeLesson(lesson, state, views);
  const completed = grade.passed && !assessed;
  const flow = introductory ? observe(view, 'flow', 'link:pipe-a') : null;
  const visited = new Set(state.actions.map(({ actionId }) => actionId));
  const actions = definition.actions.filter((action) => !action.forCase || action.forCase === state.caseId);
  const primaryAction = actions.find((action) => action.type === 'step');
  const groups = answerGroups(actions);
  const allQuestions = answerGroups(definition.actions);
  const answered = [...allQuestions.keys()].filter((field) => state.answers[field] !== undefined).length;
  const measurementCases = new Set(definition.criteria.flatMap((rule) => {
    if (rule.type === 'range') return [rule.caseId ?? lesson.cases[0]!.definition.id];
    if (rule.type === 'difference') return [rule.caseId ?? lesson.cases[0]!.definition.id, rule.otherCase];
    return [];
  }));
  const measured = [...measurementCases].filter((id) => (views[id]?.snapshot.tick ?? 0) > 0).length;
  const hasBasket = definition.actions.some((action) => action.type === 'quantity');
  const basketFilled = Object.values(state.basket).some((quantity) => quantity > 0);
  const requirementsMet = answered === allQuestions.size && measured === measurementCases.size && (!hasBasket || basketFilled);
  const readyToSubmit = state.actions.length > 0 && (!bundled || requirementsMet) &&
    ![...clients.current.values()].some((client) => client.pending);
  const ready = client?.state.mode === 'paused' && !client.pending;
  const workerIssue = view?.stale || client?.state.mode === 'stalled' || client?.state.mode === 'stopped';
  const expectedStop = view?.mode === 'stopped' && view.diagnostics.some(({ code }) => code === 'lesson_temperature_boundary');
  const nextAction = onNext && <button className="action-primary" disabled={working} onClick={onNext}>Следующее задание</button>;
  const freeCopyAction = <button disabled={working} onClick={() => {
    const seed = freeCopy(lesson, selectedAttempt?.state.caseId ?? state.caseId, editorId('project'));
    if (seed) onEditor(seed);
  }}>Открыть свободную копию</button>;

  useEffect(() => { heading.current?.focus(); }, [lesson, sessionKey]);
  useEffect(() => { if (selectedAttempt) resultHeading.current?.focus(); }, [selectedAttempt]);
  useEffect(() => {
    if (!bundled || !assessed) return;
    let current = true;
    void listAttempts(definition).then((saved) => {
      if (!current) return;
      setAttempts(saved);
      setSelectedAttempt(saved[0] ?? null);
    }).catch(() => {
      if (current) setError('Не удалось открыть историю попыток.');
    }).finally(() => { if (current) setHistoryLoading(false); });
    return () => { current = false; };
  }, [assessed, bundled, definition]);
  useEffect(() => {
    if (bundled && (completed || selectedAttempt?.grade.passed)) onPassed(definition);
  }, [bundled, completed, definition, onPassed, selectedAttempt]);

  useEffect(() => {
    const running = clients.current;
    const stamps = new Map<string, { state: Client['state']; pending: boolean }>();
    const timer = setInterval(() => {
      let dirty = false;
      for (const [id, client] of running) {
        const earlier = stamps.get(id);
        if (client.state === earlier?.state && client.pending === earlier.pending) continue;
        stamps.set(id, { state: client.state, pending: client.pending });
        dirty = true;
      }
      if (dirty) redraw((n) => n + 1);
    }, 45);
    return () => {
      clearInterval(timer);
      for (const client of running.values()) client.dispose();
      running.clear();
    };
  }, [lesson, sessionKey]);

  const drafting = !historyLoading && (!selectedAttempt || draftStarted);
  useEffect(() => {
    if (!drafting || clients.current.has(bound.definition.id)) return;
    const client = createSimulationClient();
    clients.current.set(bound.definition.id, client);
    client.load(editorId('lesson'), bound.scenario);
  }, [bound, drafting, sessionKey]);

  function perform(actionId: string) {
    if (busy.current || selectedAttempt || historyLoading) return;
    const action = admittedAction(lesson, state, actionId);
    if (!action) { setError('Это действие недоступно в текущем задании.'); return; }
    if (action.type === 'step' || action.type === 'command') {
      if (!client || client.state.mode !== 'paused' || client.pending) return;
      const ticks = action.type === 'step' ? stepTicks(action, client.state.view?.snapshot.tick ?? 0) : 0;
      const sent = action.type === 'step' ? ticks > 0 && client.send({ kind: 'advance', ticks })
        : client.send({ kind: 'command', command: action.command }) && client.send({ kind: 'step' });
      if (!sent) return;
    }
    if (action.type === 'inspect') {
      if (introductory && flow === null) return;
      setHighlight(action.target);
    }
    if (action.type === 'case') { setHighlight(null); setHint(0); }
    setDraftStarted(true);
    setState((previous) => applyLessonAction(previous, action));
    setError('');
  }

  function inspect(target: string) {
    const option = actions.find((action) => action.type === 'inspect' && action.target === target);
    if (option) perform(option.id);
  }

  function renderAction(action: LessonAction) {
    const motor = action.type === 'step' || action.type === 'command';
    const atTarget = action.type === 'step' && stepTicks(action, view?.snapshot.tick ?? 0) === 0;
    const isSelected = action.type === 'answer' ? state.answers[action.field] === action.value :
      action.type === 'inspect' ? highlight === action.target : action.type === 'case' ? state.caseId === action.caseId : undefined;
    return <button key={action.id} className={action === primaryAction ? 'action-primary' : undefined}
      onClick={() => perform(action.id)} aria-pressed={isSelected}
      disabled={working || motor && (!ready || atTarget)}>
      {atTarget ? 'Замер на тике ' + view?.snapshot.tick + ' готов' : action.label}
    </button>;
  }

  function reset() {
    for (const client of clients.current.values()) client.dispose();
    clients.current.clear();
    setState(startLessonState(lesson)); setSessionKey((n) => n + 1);
    setSelectedAttempt(null); setDraftStarted(false); setError(''); setNotice(''); setHint(0); setHighlight(null);
  }

  async function persist(attempt: LessonAttempt) {
    if (!bundled) return;
    try { await saveAttempt(attempt); setUnsavedAttempt(null); }
    catch { setUnsavedAttempt(attempt.id); setError('Не удалось сохранить попытку в истории. Повторите сохранение или выгрузите отчёт.'); }
  }

  async function submit() {
    if (busy.current || !readyToSubmit || [...clients.current.values()].some((client) => client.pending)) return;
    busy.current = true;
    setWorking(true);
    setError('');
    try {
      const attempt: LessonAttempt = { id: editorId('attempt'), lesson: definition.id, lessonVersion: definition.version,
        submittedAt: Date.now(), state, grade, records: await captureRecords(clients.current) };
      await persist(attempt);
      setAttempts((previous) => [attempt, ...previous]);
      setSelectedAttempt(attempt);
      setDraftStarted(false);
    } finally { busy.current = false; setWorking(false); }
  }

  async function report(attempt?: LessonAttempt) {
    if (busy.current) return;
    busy.current = true;
    setWorking(true); setError(''); setNotice('');
    try {
      const result = attempt ?? { lesson: definition.id, lessonVersion: definition.version,
        state, grade, records: await captureRecords(clients.current) };
      const json = JSON.stringify({ format: 'educationsim-lesson-result', version: 1, ...result });
      const bridge = window.educationWorkspace;
      if (bridge) {
        const completion = await bridge.exportJson(json);
        if (completion === 'failed') throw new Error('Не удалось сохранить отчёт.');
        if (completion === 'cancelled') return;
      } else {
        const href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = href; link.download = definition.id + '-результат.json'; document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
      }
      setNotice('Отчёт выгружен.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось подготовить отчёт.'); }
    finally { busy.current = false; setWorking(false); }
  }

  const warning = error && <p role="alert" className="lesson-warning">{error}</p>;
  const exportNotice = notice && <p role="status" className="lesson-notice">{notice}</p>;
  const assessmentActions = actions.filter((action) => action !== primaryAction &&
    (!assessed || (action.type !== 'quantity' && action.type !== 'answer')));
  const assessmentSummary = <section className="lesson-submit" aria-label="Готовность к сдаче">
    <h2>Готовность к сдаче</h2>
    <ul>
      {measurementCases.size > 0 && <li>Стенды с замером <strong>{measured} из {measurementCases.size}</strong></li>}
      {allQuestions.size > 0 && <li>Ответы <strong>{answered} из {allQuestions.size}</strong></li>}
      {hasBasket && <li>Состав заказа <strong>{basketFilled ? 'заполнен' : 'пуст'}</strong></li>}
    </ul>
    <p>После сдачи откроются оценка и разбор.</p>
    <button className="action-primary" disabled={working || !readyToSubmit} onClick={() => { void submit(); }}>
      {working ? 'Сохраняем результат…' : 'Завершить попытку'}
    </button>
  </section>;

  return <main className="lesson-bench">
    <header className="lesson-header">
      <button disabled={working} onClick={onBack}>← К заданиям</button>
      <div><p className="eyebrow">{assessed ? 'Оценочный кейс' : 'Практика'} · {definition.id} · {definition.minutes} мин</p>
        <h1 ref={heading} tabIndex={-1}>{definition.title}</h1></div>
    </header>
    {historyLoading ? <p role="status">Загружаем историю попыток…</p> : selectedAttempt ? <section className="lesson-result">
      <h2 ref={resultHeading} tabIndex={-1}>Результат попытки</h2>
      <Criteria lesson={definition} grade={selectedAttempt.grade} />
      <LessonResponses lesson={definition} state={selectedAttempt.state} />
      <section className="lesson-explanation"><h3>Разбор</h3><p>{definition.explanation}</p>
        {definition.hints.map((item) => <p key={item}>{item}</p>)}</section>
      {warning}{exportNotice}
      <div className="lesson-actions">
        {selectedAttempt.grade.passed && (nextAction ??
          <button className="action-primary" disabled={working} onClick={onBack}>Вернуться к заданиям</button>)}
        <button className={!selectedAttempt.grade.passed ? 'action-primary' : undefined} disabled={working}
          onClick={() => draftStarted ? setSelectedAttempt(null) : reset()}>{draftStarted ? 'Вернуться к текущей попытке' : 'Новая попытка'}</button>
        <button disabled={working} onClick={() => { void report(selectedAttempt); }}>Сохранить отчёт наставнику</button>
        {freeCopyAction}
        {unsavedAttempt === selectedAttempt.id && <button disabled={working} onClick={() => { void persist(selectedAttempt); }}>Повторить сохранение</button>}
      </div>
      {attempts.length > 1 && <label className="attempt-history">История попыток <select value={selectedAttempt.id} disabled={working}
        onChange={(event) => { setNotice(''); setSelectedAttempt(attempts.find(({ id }) => id === event.target.value) ?? null); }}>
        {attempts.map((attempt, index) => <option key={attempt.id} value={attempt.id}>
          {'Попытка ' + (attempts.length - index) + ' · ' + attempt.grade.count + ' из ' + attempt.grade.total +
            ' · ' + new Date(attempt.submittedAt).toLocaleString('ru-RU')}
        </option>)}
      </select></label>}
    </section> : <>
      <p className="lesson-goal">{definition.goal}</p>
      <div className={'lesson-grid' + (assessed ? ' assessed' : '')}>
        <div className="lesson-main">
          <section className="lesson-work" aria-label="Схема урока">
            {!introductory && <div className="lesson-case"><h2>{bound.definition.title}</h2><div className="lesson-primary">
              {view && <span title="Тик — один шаг модели">Модельный тик: {view.snapshot.tick}</span>}
              {!view && !workerIssue && <span>Готовим учебную схему…</span>}
              {primaryAction && renderAction(primaryAction)}
            </div></div>}
            {definition.sourceCard && assessed && <p className="lesson-measurement-note">Стенд нужен для замера расхода в контрольном контуре.</p>}
            <div className="lesson-status">
              {warning}
              {expectedStop ? <p className="lesson-notice" role="status"><strong>Ожидаемая остановка без защиты.</strong>{' '}
                {view.diagnostics.find(({ code }) => code === 'lesson_temperature_boundary')?.message}</p> :
                workerIssue && <p className="lesson-warning" role="alert">{client?.state.diagnostics.map(({ message }) => message).join(' ') ||
                  'Расчёт остановлен. Сбросьте попытку или выберите другой стенд.'}</p>}
            </div>
            {introductory ? <FirstLessonGuide flow={flow} visited={visited} selected={highlight} passed={completed}
              canStart={Boolean(primaryAction && ready)} pending={Boolean(client?.pending && view)}
              blocked={working} onStart={() => { if (primaryAction) perform(primaryAction.id); }}
              onInspect={inspect} nextAction={<>{nextAction}{freeCopyAction}</>} /> : <>
              {assessmentActions.length > 0 && <div className="lesson-actions" aria-label="Разрешённые действия">{assessmentActions.map(renderAction)}</div>}
              {assessed ? <details className="lesson-diagram"><summary>Схема контрольного стенда</summary>
                <Schematic project={bound.project} level={bound.project.viewPreferences.level} selected={highlight}
                  selectedLink={highlight} onSelect={inspect} onLinkSelect={inspect} water control />
              </details> : <Schematic project={bound.project} level={bound.project.viewPreferences.level} selected={highlight}
                selectedLink={highlight} onSelect={inspect} onLinkSelect={inspect} water control />}
            </>}
          </section>
          {assessed && <>
            {definition.sourceCard && <Suspense fallback={<p>Загружаем снимок карточки…</p>}><LessonSource card={definition.sourceCard} /></Suspense>}
            <LessonBasket actions={actions} basket={state.basket} onAction={perform} disabled={working} />
            <LessonQuestions lesson={definition} groups={groups} state={state} onAction={perform} disabled={working} />
          </>}
        </div>
        {introductory ? <aside className="lesson-rubric first-lesson-rubric" aria-label="Прогресс первого урока">
          <FirstLessonProgress flow={flow} visited={visited} />
        </aside> : <aside className="lesson-rubric" aria-label={assessed ? 'Измерения и готовность' : 'Проверка задания'}>
          <h2>{assessed ? 'Измерения' : 'Проверка задания'}</h2>
          {assessed ? <>
            <ul className="criteria-list">{grade.rows.flatMap((row, i) => {
              const rule = definition.criteria[i]!;
              if (rule.type !== 'range') return [];
              const measured = lesson.cases.find(({ definition }) => definition.id === rule.caseId) ?? bound;
              return [<li key={row.id}>{rule.caseId ? measured.definition.title + ' · ' : ''}
                {measurementLabel(rule, measured)}<strong>{row.actual == null ? 'Нет данных' : reading(rule.metric, row.actual)}</strong></li>];
            })}</ul>
            {assessmentSummary}
          </> : <>
            <StandReadings lesson={lesson} views={views} />
            <Criteria lesson={definition} grade={grade} showTargets={definition.id === 'L02'} />
            {!completed && definition.hints.length > 0 && <div className="lesson-hint">
              {hint > 0 && <><strong>Подсказка</strong>
                {definition.hints.slice(0, hint).map((text) => <p key={text}>{text}</p>)}</>}
              {hint < definition.hints.length && <button onClick={() => setHint((n) => n + 1)}>{hint ? 'Ещё подсказка' : 'Показать подсказку'}</button>}
            </div>}
            {completed && <section className="lesson-explanation"><h3>Что показал опыт</h3><p>{definition.explanation}</p></section>}
          </>}
        </aside>}
      </div>
      {exportNotice}
      <div className="lesson-actions lesson-footer">
        {completed && !introductory && nextAction}
        <button disabled={working} onClick={reset}>Начать попытку заново</button>
        {!assessed && (!introductory || !completed) && freeCopyAction}
        {assessed && attempts.length > 0 && <button disabled={working} onClick={() => setSelectedAttempt(attempts[0]!)}>История попыток</button>}
        {!assessed && <button disabled={working || state.actions.length === 0 || Boolean(client?.pending)}
          onClick={() => { void report(); }}>Сохранить отчёт наставнику</button>}
      </div>
    </>}
  </main>;
}
