import { z } from 'zod';
import { parseProject } from '../project/document';
import { checkJsonValue } from '../project/json-input';
import { templateIds } from '../project/templates';
import type { TemplateId } from '../project/templates';
import type { ProjectDocument, Result } from '../project/types';
import type { SimulationCapture } from '../simulation/comparison';
import type { SimulationScenario } from '../simulation/engine-types';
import { maxCommands, maxReplayTicks, recordingVersion } from '../simulation/replay';
import type { SimulationRecord } from '../simulation/replay';

export type ProjectArtifacts = { captures: { a?: SimulationCapture; b?: SimulationCapture }; records: SimulationRecord[] };
export type Workspace = ProjectArtifacts & { project: ProjectDocument; preset?: TemplateId };
export const emptyArtifacts = (): ProjectArtifacts => ({ captures: {}, records: [] });
export const workspaceLimit = 12 * 1024 * 1024;
const format = 'educationsim-workspace';
const s = z.string().min(1).max(240);
const nonnegative = z.int().nonnegative();
const point = z.number();
const e = z.object({ id: s, tick: nonnegative, componentId: s, kind: z.enum(['limiter-tripped', 'limiter-reset']), reason: z.enum(['sensor', 'temperature']) });
const capture = z.strictObject({ projectId: s, revision: nonnegative, tick: nonnegative, start: z.unknown(),
  components: z.array(z.object({ id: s, typeId: s, catalogSnapshotId: s.nullable() })).max(500),
  readings: z.array(z.object({ id: s, unit: z.string().max(20), value: point.nullable() })).max(10000), events: z.array(e).max(2048) });
export const simulationCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('set-valve'), channelId: s, opening: z.number().min(0).max(1) }),
  z.strictObject({ kind: z.literal('manual'), actuatorId: s, demand: z.boolean() }),
  z.strictObject({ kind: z.literal('power'), powered: z.boolean() }),
  z.strictObject({ kind: z.literal('reset-limit'), limiterId: s }),
  z.strictObject({ kind: z.literal('fault'), command: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.enum(['air', 'filter']), id: s, extent: z.number().min(0).max(1) }),
    z.strictObject({ kind: z.enum(['vent', 'clean', 'sensor-failure', 'sensor-repair', 'unjam']), id: s }),
    z.strictObject({ kind: z.literal('jam'), id: s, opening: z.number().min(0).max(1) }),
  ]) }),
  z.strictObject({ kind: z.literal('service'), cellId: s, fillKg: z.number().nonnegative(), fillC: z.number(), drainKg: z.number().nonnegative() }),
]);

function object(v: unknown): Record<string, unknown> | null { return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null; }
const scenario = z.custom<SimulationScenario>((raw: unknown) => {
  const v = object(raw), sys = object(v?.system), fluid = object(v?.fluid), ctl = object(v?.control);
  if (!v || !sys || !fluid || !ctl || !object(v.hydraulic) || !object(fluid.cells)) return false;
  return typeof sys.projectId === 'string' && Number.isSafeInteger(sys.projectRevision) &&
    Array.isArray(sys.components) && Array.isArray(sys.nodes) && Array.isArray(sys.hydraulicChannels) &&
    Array.isArray(sys.hydraulicDomains) && Array.isArray(sys.thermalLinks) &&
    Array.isArray(ctl.devices) && Array.isArray(ctl.wires) && Array.isArray(ctl.bindings) &&
    Array.isArray(v.sources) && typeof v.outdoorC === 'number';
});
const record = z.strictObject({ version: z.literal(recordingVersion), scenario, untilTick: nonnegative.max(maxReplayTicks),
  commands: z.array(z.strictObject({ tick: z.int().positive(), seq: nonnegative, command: simulationCommandSchema })).max(maxCommands),
}).refine((r) => r.commands.every((cmd, i) => cmd.tick <= r.untilTick &&
  (!i || cmd.tick >= r.commands[i-1]!.tick && cmd.seq > r.commands[i-1]!.seq)));
const envelope = z.strictObject({
  format: z.literal(format), version: z.literal(2), project: z.unknown(),
  preset: z.enum(templateIds).optional(), captures: z.strictObject({ a: capture.optional(), b: capture.optional() }),
  records: z.array(record).max(4),
});
const fail = (code: string, message: string): Result<never> => ({ ok: false, diagnostics: [{ code, path: 'workspace', severity: 'error', message }] });

export function readWorkspace(text: string): Result<Workspace> {
  if (text.length > workspaceLimit || new TextEncoder().encode(text).length > workspaceLimit) return fail('workspace_size', 'Файл проекта превышает 12 МиБ.');
  try {
    const raw: unknown = JSON.parse(text);
    const data = object(raw);
    if (data?.format === format) {
      if (data.version !== 2) return fail('workspace_version', 'Эта версия архива проекта не поддерживается.');
      if (checkJsonValue(raw) !== 'ok') return fail('workspace_data', 'Неподдерживаемые или слишком сложные данные архива.');
      const parsed = envelope.safeParse(raw);
      if (!parsed.success) return fail('workspace_archive', 'Проверьте формат сохранённых измерений и прогонов.');
      const p = parseProject(parsed.data.project);
      if (!p.ok) return p;
      return { ok: true, diagnostics: [], value: {
        project: p.value, preset: parsed.data.preset, captures: parsed.data.captures, records: parsed.data.records,
      } };
    }
    const project = parseProject(raw);
    return project.ok ? { ok: true, diagnostics: [], value: { project: project.value, ...emptyArtifacts() } } : project;
  } catch { return fail('workspace_json', 'Файл не читается как архив проекта JSON.'); }
}

export function writeWorkspace(workspace: Workspace): Result<string> {
  try {
    const encoded = JSON.stringify({ format, version: 2, ...workspace });
    const checked = readWorkspace(encoded);
    return checked.ok ? { ok: true, diagnostics: [], value: encoded } : checked;
  } catch { return fail('workspace_data', 'Текущий проект не удалось преобразовать в JSON.'); }
}
export function cloneWorkspace(input: Workspace, projectId: string): Workspace {
  const copy = structuredClone(input);
  return { ...copy, project: { ...copy.project, projectId, title: copy.project.title.slice(0, 140) + ' · копия' } };
}
