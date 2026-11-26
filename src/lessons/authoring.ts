import { z } from 'zod';
import { createTemplateProject, templateIds } from '../project/templates';
import { compileLiveScenario } from '../project/live-scenario';
import { simulationCommandSchema } from '../storage/project-transfer';
import type { ProjectDocument, Result } from '../project/types';
import type { SimulationCommand, SimulationScenario } from '../simulation/engine-types';

const id = z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/i);
const name = z.string().min(1).max(230);
const prose = z.string().min(1).max(2600);
const address = z.string().min(1).max(230);
const fields = z.enum(['clarification', 'choice', 'explanation', 'limit']);
const metrics = z.enum(['flow', 'waterTemperature', 'surfaceTemperature', 'roomTemperature', 'power', 'pressure', 'opening']);
const range = { min: z.number(), max: z.number() };
const scene = z.strictObject({ id, title: name, template: z.enum(templateIds),
  waterC: z.number().min(5).max(90).optional(),
  outdoorC: z.number().min(-45).max(35).optional(),
  diameter: z.record(id, z.number().min(.006).max(.045)).optional(),
});
const commonAction = { id, label: name, forCase: id.optional() };
const actions = z.discriminatedUnion('type', [
  z.strictObject({ ...commonAction, type: z.literal('step'), ticks: z.int().min(1).max(120).optional() }),
  z.strictObject({ ...commonAction, type: z.literal('command'), command: simulationCommandSchema }),
  z.strictObject({ ...commonAction, type: z.literal('case'), caseId: id }),
  z.strictObject({ ...commonAction, type: z.literal('inspect'), target: address }),
  z.strictObject({ ...commonAction, type: z.literal('answer'), field: fields, value: id }),
  z.strictObject({ ...commonAction, type: z.literal('quantity'), item: id, delta: z.union([z.literal(1), z.literal(-1)]) }),
]);
const commonRule = { id, label: name, caseId: id.optional() };
const rules = z.discriminatedUnion('type', [
  z.strictObject({ ...commonRule, type: z.literal('range'), metric: metrics, target: address, ...range }),
  z.strictObject({ ...commonRule, type: z.literal('difference'), metric: metrics, target: address, otherCase: id, otherTarget: address.optional(), ...range }),
  z.strictObject({ ...commonRule, type: z.literal('did'), actionId: id }),
  z.strictObject({ ...commonRule, type: z.literal('answer'), field: fields, value: id }),
  z.strictObject({ ...commonRule, type: z.literal('basket'), quantities: z.record(id, z.int().min(1).max(100)) }),
  z.strictObject({ ...commonRule, type: z.literal('event'), componentId: address, event: z.enum(['limiter-tripped', 'limiter-reset']) }),
]);
const schema = z.strictObject({
  version: z.literal(1), id: z.string().regex(/^L(0[1-9]|1[0-5])$/), title: name, goal: prose, explanation: prose,
  minutes: z.int().min(1).max(45), hints: z.array(prose).max(10),
  cases: z.array(scene).min(1).max(6), actions: z.array(actions).min(1).max(80), criteria: z.array(rules).min(1).max(30),
});
export type Lesson = z.infer<typeof schema>;
export type LessonAction = z.infer<typeof actions>;
export type LessonCriterion = z.infer<typeof rules>;
export type LessonMetric = z.infer<typeof metrics>;
export type LessonCase = { definition: Lesson['cases'][number]; project: ProjectDocument; scenario: SimulationScenario };
export type PreparedLesson = { definition: Lesson; cases: LessonCase[] };
const failure = (code: string, path: string, message: string): Result<PreparedLesson> =>
  ({ ok: false, diagnostics: [{ code, path, message, severity: 'error' }] });
function unique(values: readonly { id: string }[]) { return new Set(values.map(({ id }) => id)).size === values.length; }
function boundMetric(s: SimulationScenario, metric: LessonMetric, id: string) {
  if (metric === 'flow') return s.system.hydraulicChannels.some((c) => c.id === id);
  if (metric === 'waterTemperature') return Object.hasOwn(s.fluid.cells, id);
  if (metric === 'surfaceTemperature') return s.building?.floors.some((f) => f.id === id) ?? false;
  if (metric === 'roomTemperature') return s.building?.rooms.some((r) => r.id === id) ?? false;
  if (metric === 'power') return s.sources.some((r) => r.componentId === id);
  if (metric === 'pressure') return s.system.nodes.some((r) => r.id === id);
  return Object.hasOwn(s.hydraulic.valves ?? {}, id) || s.control.devices.some((d) => d.id === id && d.kind === 'actuator');
}
function validCommand(s: SimulationScenario, command: SimulationCommand) {
  switch (command.kind) {
    case 'set-valve': {
      const target = s.hydraulic.valves?.[command.channelId];
      return !!target && ['balance', 'shutoff', 'two-way'].includes(target.kind);
    }
    case 'manual': return s.control.devices.some((d) => d.id === command.actuatorId && d.kind === 'actuator');
    case 'power': return true;
    case 'reset-limit': return s.control.devices.some((d) => d.id === command.limiterId && ['high-limit','rtl','surface-limit'].includes(d.kind));
    case 'service': return Object.hasOwn(s.serviceCapacityM3ByCell ?? {}, command.cellId);
    case 'fault': {
      const { kind, id } = command.command;
      if (kind === 'sensor-failure' || kind === 'sensor-repair') return s.control.bindings.some((d) => d.sampleId === id);
      if (kind === 'jam' || kind === 'unjam') return s.control.devices.some((d) => d.id === id && d.kind === 'actuator');
      return s.system.hydraulicChannels.some((c) => c.id === id);
    }
  }
}
export function prepareLesson(raw: unknown): Result<PreparedLesson> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return failure('lesson_schema', parsed.error.issues[0]?.path.map(String).join('.') ?? '', 'Проверьте формат задания и значения полей.');
  const lesson = parsed.data;
  if (![lesson.cases, lesson.actions, lesson.criteria].every(unique)) return failure('lesson_duplicates', 'lesson', 'В уроке повторяются идентификаторы.');
  const cases: LessonCase[] = [];
  for (const definition of lesson.cases) {
    const seed = createTemplateProject(definition.template, 'lesson-' + lesson.id.toLowerCase() + '-' + definition.id);
    if (!seed.ok) return seed;
    const project = seed.value;
    if (definition.waterC !== undefined) project.initialConditions.waterC = definition.waterC;
    if (definition.outdoorC !== undefined) project.environment.outdoorC = definition.outdoorC;
    for (const [linkId, diameter] of Object.entries(definition.diameter ?? {})) {
      const link = project.hydronicLinks.find((l) => l.id === linkId);
      if (!link) return failure('lesson_reference', 'cases.' + definition.id, 'Не удалось сопоставить трубу.');
      link.innerDiameterM = diameter;
    }
    const run = compileLiveScenario(project, definition.template);
    if (!run.ok) return run;
    cases.push({ definition, project, scenario: run.value });
  }
  const known = new Map(cases.map((c) => [c.definition.id, c]));
  for (const action of lesson.actions) {
    const active = action.forCase ? cases.filter((c) => c.definition.id === action.forCase) : cases;
    const referenceOk = active.length > 0 && (action.type === 'case' ? known.has(action.caseId) :
      action.type === 'command' ? active.every((c) => validCommand(c.scenario, action.command)) :
      action.type === 'inspect' ? active.every((c) => c.project.hydronicLinks.some((l) => l.id === action.target) ||
        c.project.components.some((i) => i.id === action.target)) : true);
    if (!referenceOk) return failure('lesson_reference', 'actions.' + action.id, 'Действие не связано с объектом указанной схемы.');
  }
  for (const criterion of lesson.criteria) {
    const target = criterion.caseId ? known.get(criterion.caseId) : cases[0];
    let valid = !!target;
    if (valid && target) {
      if (criterion.type === 'range' || criterion.type === 'difference') {
        valid = criterion.min <= criterion.max && boundMetric(target.scenario, criterion.metric, criterion.target);
        if (criterion.type === 'difference') {
          const other = known.get(criterion.otherCase);
          valid = valid && !!other && boundMetric(other.scenario, criterion.metric, criterion.otherTarget ?? criterion.target);
        }
      } else if (criterion.type === 'did') valid = lesson.actions.some((a) => a.id === criterion.actionId);
      else if (criterion.type === 'answer') valid = lesson.actions.some((a) => a.type === 'answer' && a.field === criterion.field && a.value === criterion.value);
      else if (criterion.type === 'basket') valid = Object.keys(criterion.quantities).every((key) => lesson.actions.some((a) => a.type === 'quantity' && a.item === key && a.delta === 1));
      else valid = target.scenario.control.devices.some((d) => d.id === criterion.componentId);
    }
    if (!valid) return failure('lesson_reference', 'criteria.' + criterion.id, 'Критерий не связан с доступным измерением или действием.');
  }
  return { ok: true, value: { definition: lesson, cases }, diagnostics: [] };
}
