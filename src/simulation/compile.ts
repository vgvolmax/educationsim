import type { ComponentRegistry } from '../project/registry';
import { validateTopology } from '../project/topology';
import type { ProjectDocument, Result } from '../project/types';
import { buildNetwork, diagnostic } from './network-build';
import { assignDomains } from './network-domains';
import type { CompiledSystem } from './types';

export function compileProject(project: ProjectDocument, registry: ComponentRegistry): Result<CompiledSystem> {
  const diagnostics = validateTopology(project, registry);
  const [topologyError] = diagnostics;
  if (topologyError) return { ok: false, diagnostics: [topologyError, ...diagnostics.slice(1)] };
  const draft = buildNetwork(project, registry, diagnostics);
  if (!draft.nodes.size && !diagnostics.length) {
    diagnostics.push(diagnostic('empty_hydraulic_network', 'components', 'Нет контура для расчёта расхода.'));
  }
  const domains = assignDomains(draft, project, diagnostics);
  const firstError = diagnostics.find((d) => d.severity === 'error');
  if (firstError) return { ok: false, diagnostics: [firstError, ...diagnostics.filter((d) => d !== firstError)] };
  return { ok: true, value: {
    projectId: project.projectId, projectRevision: project.revision, initialWaterC: project.initialConditions.waterC,
    components: draft.components, nodes: [...draft.nodes.values()], ...domains,
    thermalLinks: draft.thermalLinks,
    thermalRooms: structuredClone(project.rooms),
    controlLinks: structuredClone(project.controlLinks),
  }, diagnostics };
}
