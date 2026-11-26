import direct from '../../content/templates/direct.json';
import mixed from '../../content/templates/floor-and-radiators.json';
import rtl from '../../content/templates/rtl-loop.json';
import separator from '../../content/templates/two-floors-separator.json';
import buffer from '../../content/templates/heat-pump-buffer.json';
import exchanger from '../../content/templates/water-glycol-exchanger.json';
import { compileProject } from '../simulation/compile';
import { solveHydraulics } from '../simulation/hydraulics';
import { parseProject } from './document';
import { trainingRegistry } from './registry';
import { assembleTemplateScenario } from './template-scenario';
import type { SimulationScenario } from '../simulation/engine-types';
import type { ProjectDocument, Result } from './types';

const documents = {
  direct, 'floor-and-radiators': mixed, 'rtl-loop': rtl, 'two-floors-separator': separator,
  'heat-pump-buffer': buffer, 'water-glycol-exchanger': exchanger,
} as const;
export type TemplateId = keyof typeof documents;
export const templateIds = Object.freeze(Object.keys(documents) as TemplateId[]);

export function createTemplateProject(id: TemplateId, projectId: string): Result<ProjectDocument> {
  if (!Object.hasOwn(documents, id)) return { ok: false, diagnostics: [{
    code: 'unknown_template', severity: 'error', path: 'templateId', message: 'Неизвестная стартовая схема.',
  }] };
  return parseProject({ ...structuredClone(documents[id]), projectId, revision: 0 });
}

export function openTemplateScenario(id: TemplateId, projectId: string): Result<SimulationScenario> {
  const project = createTemplateProject(id, projectId);
  if (!project.ok) return project;
  const compiled = compileProject(project.value, trainingRegistry);
  if (!compiled.ok) return compiled;
  const run = assembleTemplateScenario(id, project.value, compiled.value);
  if (!run.ok) return run;
  return { ok: true, value: run.value, diagnostics: [...project.diagnostics, ...compiled.diagnostics, ...run.diagnostics] };
}

type Interference = { primarySlow: number; primaryFast: number; crossoverSlow: number; crossoverFast: number };
/** Matched teaching experiment: closing the common cross path puts both pump paths in series.
 * It is not a universal or manufacturer-specific sizing rule. Positive crossover is top to bottom. */
export function compareSeparatorInterference(): Result<{ withSeparator: Interference; directSeries: Interference }> {
  const result = openTemplateScenario('two-floors-separator', 'v11-separator');
  if (!result.ok) return result;
  const { system, hydraulic } = result.value;
  const crossover = 'component:storage:internal-mixing', primary = 'component:source:source';
  const secondary = 'component:secondary-pump:pump';
  const resistance = { ...hydraulic.resistance, ...Object.fromEntries(system.hydraulicChannels
    .filter((channel) => channel.kind === 'pipe').map(({ id }) => [id, { linearPaPerM3s: 6e7 }])) };
  function experiment(speed: number, separated: boolean): Result<{ primary: number; crossover: number }> {
    const flow = solveHydraulics(system, { ...hydraulic, resistance, closedChannels: separated ? [] : [crossover],
      pumps: { ...hydraulic.pumps, [secondary]: { mode: 'fixed-speed', speedFraction: speed,
        points: [{ flowM3s: 0, headPa: 45_000 }, { flowM3s: .00024, headPa: 0 }] } } });
    if (!flow.ok) return { ok: false, diagnostics: [{ ...flow.diagnostics[0], path: `V11:${speed}:${separated}:` + flow.diagnostics[0].path }, ...flow.diagnostics.slice(1)] };
    return { ok: true, diagnostics: flow.diagnostics, value: {
      primary: flow.value.channels[primary]!.flowM3s, crossover: flow.value.channels[crossover]!.flowM3s,
    } };
  }
  function pair(separated: boolean): Result<Interference> {
    const slow = experiment(.25, separated), fast = experiment(1, separated);
    if (!slow.ok) return slow;
    if (!fast.ok) return fast;
    return { ok: true, diagnostics: [...slow.diagnostics, ...fast.diagnostics], value: {
      primarySlow: slow.value.primary, primaryFast: fast.value.primary,
      crossoverSlow: slow.value.crossover, crossoverFast: fast.value.crossover,
    } };
  }
  const withSeparator = pair(true), directSeries = pair(false);
  if (!withSeparator.ok) return withSeparator;
  if (!directSeries.ok) return directSeries;
  return { ok: true, diagnostics: [...withSeparator.diagnostics, ...directSeries.diagnostics],
    value: { withSeparator: withSeparator.value, directSeries: directSeries.value } };
}
