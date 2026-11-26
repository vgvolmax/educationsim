import { parseProject } from './document';
import { editRectangularRoom } from './editor-geometry';
import type { ComponentRegistry } from './registry';
import { checkConnection, connectionDiagnostic } from './topology';
import type { ComponentInstance, ControlLink, Diagnostic, ProjectCommand, ProjectDocument, ProjectEdit, ReplaceComponentCommand, Result } from './types';

type Domain = 'hydronic' | 'control';
const success = <T>(value: T): Result<T> => ({ ok: true, value, diagnostics: [] });
const failure = <T>(code: string, message: string): Result<T> =>
  ({ ok: false, diagnostics: [{ code, path: '', message, severity: 'error' }] });

type LinkChange = { linkId: string; domain: Domain } & (
  | { action: 'keep' }
  | { action: 'detach'; diagnostic: Diagnostic }
);
type ReplacementPlan = {
  revision: number;
  component: ComponentInstance;
  links: LinkChange[];
  removedLoopRoutes: string[];
};

function detach(project: ProjectDocument, removedHydronic: Set<string>, removedControl: Set<string>): ProjectDocument {
  return {
    ...project,
    hydronicLinks: project.hydronicLinks.filter((link) => !removedHydronic.has(link.id)),
    controlLinks: project.controlLinks.filter((link) => !removedControl.has(link.id)),
    loopRoutes: project.loopRoutes.filter((route) => !removedHydronic.has(route.linkId)),
  };
}

function touches(link: { from: { componentId: string }; to: { componentId: string } }, componentId: string): boolean {
  return link.from.componentId === componentId || link.to.componentId === componentId;
}

export function previewReplacement(
  project: ProjectDocument, command: ReplaceComponentCommand, registry: ComponentRegistry,
): Result<ReplacementPlan> {
  if (command.expectedRevision !== project.revision) {
    return failure('stale_revision', 'Схема изменилась. Проверьте новый план замены.');
  }
  const original = project.components.find((component) => component.id === command.componentId);
  if (!original) return failure('missing_component', 'Компонент не найден.');
  const type = registry.get(command.typeId);
  if (!type) return failure('missing_type', 'Тип компонента не найден.');
  if (type.id === original.typeId) return failure('same_component_type', 'Выбран тот же тип компонента.');

  const component = { ...original, typeId: type.id, catalogSnapshotId: null, parameters: { ...type.defaultParameters } };
  const before = project.components.map((item) => item.id === component.id ? component : item);
  const draft: ProjectDocument = {
    ...project, components: before,
    hydronicLinks: project.hydronicLinks.filter((link) => !touches(link, component.id)),
    controlLinks: project.controlLinks.filter((link) => !touches(link, component.id)),
  };
  const changes: LinkChange[] = [];
  function consider<T extends ControlLink>(
    source: T[], accepted: T[], collection: 'hydronicLinks' | 'controlLinks', domain: Domain,
  ): void {
    source.forEach((link, i) => {
      if (!touches(link, component.id)) return;
      const decision = checkConnection(draft, { domain, ...link }, registry);
      if (!decision.ok) {
        changes.push({ domain, linkId: link.id, action: 'detach', diagnostic: connectionDiagnostic(decision, `${collection}.${i}`) });
        return;
      }
      changes.push({ domain, linkId: link.id, action: 'keep' });
      accepted.push(link);
    });
  }
  consider(project.hydronicLinks, draft.hydronicLinks, 'hydronicLinks', 'hydronic');
  consider(project.controlLinks, draft.controlLinks, 'controlLinks', 'control');

  const removed = new Set(changes.filter((change) => change.domain === 'hydronic' && change.action === 'detach').map(({ linkId }) => linkId));
  return success({
    revision: project.revision, component, links: changes,
    removedLoopRoutes: project.loopRoutes.filter((route) => removed.has(route.linkId)).map(({ id }) => id),
  });
}

function applyEdit(project: ProjectDocument, command: ProjectEdit, registry: ComponentRegistry): Result<ProjectDocument> {
  switch (command.kind) {
    case 'add_rectangular_room':
    case 'resize_rectangular_room':
      return editRectangularRoom(project, command);
    case 'rename_project':
      return success({ ...project, title: command.title });
    case 'add_component':
      if (project.components.some(({ id }) => id === command.component.id)) return failure('duplicate_id', 'Этот идентификатор компонента уже используется.');
      if (!registry.has(command.component.typeId)) return failure('missing_type', 'Тип компонента не найден.');
      return success({ ...project, components: [...project.components, command.component] });
    case 'remove_component': {
      if (!project.components.some(({ id }) => id === command.componentId)) return failure('missing_component', 'Компонент не найден.');
      const related = (link: ProjectDocument['hydronicLinks'][number] | ProjectDocument['controlLinks'][number]) => touches(link, command.componentId);
      const hydronic = new Set(project.hydronicLinks.filter(related).map(({ id }) => id));
      const control = new Set(project.controlLinks.filter(related).map(({ id }) => id));
      return success(detach({ ...project, components: project.components.filter(({ id }) => id !== command.componentId) }, hydronic, control));
    }
    case 'connect_hydronic':
    case 'connect_control': {
      const domain = command.kind === 'connect_hydronic' ? 'hydronic' : 'control';
      const existing = domain === 'hydronic' ? project.hydronicLinks : project.controlLinks;
      if (existing.some(({ id }) => id === command.link.id)) return failure('duplicate_id', 'Этот идентификатор связи уже используется.');
      const decision = checkConnection(project, { domain, ...command.link }, registry);
      if (!decision.ok) return { ok: false, diagnostics: [connectionDiagnostic(decision, 'link')] };
      return command.kind === 'connect_hydronic'
        ? success({ ...project, hydronicLinks: [...project.hydronicLinks, command.link] })
        : success({ ...project, controlLinks: [...project.controlLinks, command.link] });
    }
    case 'disconnect': {
      const links = command.domain === 'hydronic' ? project.hydronicLinks : project.controlLinks;
      if (!links.some(({ id }) => id === command.linkId)) return failure('missing_link', 'Связь не найдена.');
      const selected = new Set([command.linkId]);
      return success(detach(project, command.domain === 'hydronic' ? selected : new Set(), command.domain === 'control' ? selected : new Set()));
    }
  }
}

function hasValidId(raw: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,95}$/i.test(raw);
}

export function applyProjectCommand(
  project: ProjectDocument, command: ProjectCommand, registry: ComponentRegistry,
): Result<ProjectDocument> {
  if (!hasValidId(command.commandId)) return failure('invalid_command_id', 'Некорректный идентификатор команды.');
  if (!Number.isSafeInteger(project.revision + 1)) return failure('revision_limit', 'Достигнут предел версии проекта.');
  let draft: ProjectDocument = project;

  if (command.kind === 'replace_component') {
    const plan = previewReplacement(project, command, registry);
    if (!plan.ok) return plan;
    const hydronic = new Set<string>();
    const control = new Set<string>();
    for (const change of plan.value.links) {
      if (change.action === 'detach') (change.domain === 'hydronic' ? hydronic : control).add(change.linkId);
    }
    const component = plan.value.component;
    draft = detach({ ...project, components: project.components.map((item) => item.id === component.id ? component : item) }, hydronic, control);
  } else {
    const edits = command.kind === 'batch' ? command.edits : [command];
    if (edits.length === 0 || edits.length > 128) return failure('invalid_batch', 'В группе должно быть от 1 до 128 действий.');
    const ids = new Set(command.kind === 'batch' ? [command.commandId] : []);
    for (const edit of edits) {
      if (!hasValidId(edit.commandId) || ids.has(edit.commandId)) {
        return failure('invalid_command_id', 'Некорректный или повторный идентификатор команды.');
      }
      ids.add(edit.commandId);
      const applied = applyEdit(draft, edit, registry);
      if (!applied.ok) return applied;
      draft = applied.value;
    }
  }

  return parseProject({ ...draft, revision: project.revision + 1 });
}
