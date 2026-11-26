import { createSession } from '../simulation/session';
import type { SessionView } from '../simulation/session';
import type { SimulationRecord } from '../simulation/replay';
import type { LessonAction, LessonMetric, PreparedLesson } from './authoring';

export type LessonLog = { caseId: string; actionId: string };
type Answer = Extract<LessonAction, { type: 'answer' }>['field'];
export type LessonState = { caseId: string; actions: LessonLog[];
  answers: Partial<Record<Answer, string>>; basket: Record<string, number> };
export const startLessonState = (lesson: PreparedLesson): LessonState => ({
  caseId: lesson.cases[0]!.definition.id, actions: [], answers: {}, basket: {},
});
export function admittedAction(lesson: PreparedLesson, state: LessonState, actionId: string): LessonAction | undefined {
  if (state.actions.length >= 2000) return undefined;
  return lesson.definition.actions.find((a) => a.id === actionId && (!a.forCase || a.forCase === state.caseId));
}
export function applyLessonAction(state: LessonState, action: LessonAction): LessonState {
  const next = { ...state, actions: [...state.actions, { caseId: state.caseId, actionId: action.id }] };
  if (action.type === 'case') return { ...next, caseId: action.caseId };
  if (action.type === 'answer') return { ...next, answers: { ...state.answers, [action.field]: action.value } };
  if (action.type === 'quantity') return { ...next, basket: { ...state.basket,
    [action.item]: Math.max(0, Math.min(100, (state.basket[action.item] ?? 0) + action.delta)) } };
  return next;
}
export function observe(view: SessionView | undefined, metric: LessonMetric, target: string): number | null {
  if (!view || view.stale || view.snapshot.health === 'stopped' || view.mode === 'stopped' || view.snapshot.tick < 1) return null;
  const s = view.snapshot;
  let n: number | null | undefined;
  if (metric === 'flow') n = s.hydraulics?.channels[target]?.flowM3s;
  else if (metric === 'pressure') n = s.hydraulics?.pressurePa[target];
  else if (metric === 'waterTemperature') n = s.fluid.cells[target]?.temperatureC;
  else if (metric === 'surfaceTemperature') n = s.building?.floors[target]?.surfaceC;
  else if (metric === 'roomTemperature') n = s.building?.roomsC[target];
  else if (metric === 'power') n = s.sources[target]?.powerW;
  else n = s.valveOpenings[target] ?? s.control?.actuators[target]?.opening;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export function gradeLesson(lesson: PreparedLesson, state: LessonState, views: Readonly<Record<string, SessionView | undefined>>) {
  const fallback = lesson.cases[0]!.definition.id;
  const rows = lesson.definition.criteria.map((rule) => {
    const current = views[rule.caseId ?? fallback];
    let passed = false, actual: number | null | undefined;
    if (rule.type === 'range' || rule.type === 'difference') {
      const observed = observe(current, rule.metric, rule.target);
      if (rule.type === 'difference') {
        const comparison = views[rule.otherCase];
        const other = observe(comparison, rule.metric, rule.otherTarget ?? rule.target);
        actual = observed === null || other === null ||
          (rule.matchTick !== false && comparison?.snapshot.tick !== current?.snapshot.tick) ? null : observed - other;
      } else actual = observed;
      passed = actual !== null && actual >= rule.min && actual <= rule.max;
    } else if (rule.type === 'did') passed = state.actions.some((a) => a.actionId === rule.actionId && (!rule.caseId || a.caseId === rule.caseId));
    else if (rule.type === 'answer') passed = state.answers[rule.field] === rule.value;
    else if (rule.type === 'diagnostic') passed = !!current?.diagnostics.some((d) => d.code === rule.code);
    else if (rule.type === 'sourceReason') passed = !!current && !current.stale && current.snapshot.sources[rule.componentId]?.reason === rule.reason;
    else if (rule.type === 'event') passed = !!current?.events.some((e) => e.kind === rule.event && e.componentId === rule.componentId);
    else {
      passed = Object.entries(rule.quantities).every(([key, qty]) => state.basket[key] === qty) &&
        Object.entries(state.basket).every(([key, qty]) => !qty || rule.quantities[key] === qty);
    }
    return { id: rule.id, label: rule.label, passed, ...(actual !== undefined && { actual }) };
  });
  const count = rows.filter((r) => r.passed).length;
  return { rows, count, total: rows.length, passed: count === rows.length,
    status: count === rows.length ? 'passed' as const : count ? 'partial' as const : 'not-yet' as const };
}
export function freeCopy(lesson: PreparedLesson, caseId: string, projectId: string) {
  const seed = lesson.cases.find((c) => c.definition.id === caseId);
  if (!seed) return null;
  return { project: { ...structuredClone(seed.project), projectId }, preset: seed.definition.template };
}

/** Deterministic author/replay harness; the graphical runner delegates the same actions to a Web Worker. */
export function createLessonAttempt(lesson: PreparedLesson) {
  type Session = Extract<ReturnType<typeof createSession>, { ok: true }>['value'];
  let state = startLessonState(lesson);
  const sessions = new Map<string, Session>();
  function focus(id: string) {
    if (sessions.has(id)) return;
    const resolved = lesson.cases.find((c) => c.definition.id === id);
    if (!resolved) return;
    const made = createSession(resolved.scenario);
    if (!made.ok) throw new Error(made.diagnostics[0].message);
    sessions.set(id, made.value);
  }
  focus(state.caseId);
  return {
    perform(actionId: string) {
      const action = admittedAction(lesson, state, actionId);
      const session = sessions.get(state.caseId);
      if (!action || !session) return false;
      if (action.type === 'step') for (let tick = 0; tick < (action.ticks ?? 1); tick++) session.stepOnce();
      if (action.type === 'command') {
        if (!session.command(action.command)) return false;
        session.stepOnce();
      }
      state = applyLessonAction(state, action); focus(state.caseId);
      return true;
    },
    frame: () => sessions.get(state.caseId)?.view,
    frameFor: (id: string) => sessions.get(id)?.view,
    score: () => gradeLesson(lesson, state, Object.fromEntries([...sessions].map(([id, s]) => [id, s.view]))),
    record: (): Record<string, SimulationRecord | null> => Object.fromEntries([...sessions].map(([id, s]) => [id, s.record()])),
    retry() { sessions.clear(); state = startLessonState(lesson); focus(state.caseId); },
  };
}
