import { bindAuthoredControls } from './authored-controls';
import { compileProject } from '../simulation/compile';
import { assembleTemplateScenario } from './template-scenario';
import { trainingRegistry } from './registry';
import type { SimulationScenario } from '../simulation/engine-types';
import type { ProjectDocument, Result } from './types';
import type { TemplateId } from './templates';

export function compileLiveScenario(project: ProjectDocument, preset?: TemplateId): Result<SimulationScenario> {
  if (!project.hydronicLinks.length) return { ok: false, diagnostics: [{
    code: 'empty_run', path: 'hydronicLinks', severity: 'error', message: 'Для прогона соберите замкнутый водяной контур.',
  }] };
  if (project.components.some((component) => component.catalogSnapshotId)) return { ok: false, diagnostics: [{
    code: 'catalog_live_profile', severity: 'error', path: 'appliedCatalogSnapshots',
    message: 'Паспортные компоненты требуют отдельного подтверждённого расчётного профиля.',
  }] };
  const compiled = compileProject(project, trainingRegistry);
  if (!compiled.ok) return compiled;
  const run = assembleTemplateScenario(preset, project, compiled.value);
  if (!run.ok) return run;
  const wired = bindAuthoredControls(project, run.value);
  if (!wired.ok) return wired;
  return { ok: true, value: wired.value, diagnostics: [...compiled.diagnostics, ...run.diagnostics, ...wired.diagnostics] };
}
