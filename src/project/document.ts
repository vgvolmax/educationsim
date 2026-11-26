import { checkJsonValue, fitsJsonBudget } from './json-input';
import { projectLimits, projectSchema } from './schema';
import type { Diagnostic, ProjectDocument, Result } from './types';

const issue = (code: string, path: string, message: string): Diagnostic =>
  ({ code, severity: 'error', path, message });

function failure(error: Diagnostic): Result<ProjectDocument> {
  return { ok: false, diagnostics: [error] };
}

function validateGraph(project: ProjectDocument): Diagnostic[] {
  const errors: Diagnostic[] = [];
  function index(items: readonly { id: string }[], collection: string): Set<string> {
    const ids = new Set<string>();
    items.forEach(({ id }, i) => {
      if (ids.has(id)) errors.push(issue('duplicate_id', `${collection}.${i}.id`, `Повторяется идентификатор ${id}.`));
      ids.add(id);
    });
    return ids;
  }
  function reference(ids: Set<string>, id: string | null, path: string): void {
    if (id !== null && !ids.has(id)) errors.push(issue('missing_reference', path, `В проекте нет объекта с идентификатором ${id}.`));
  }

  const rooms = index(project.rooms, 'rooms');
  const components = index(project.components, 'components');
  const hydronics = index(project.hydronicLinks, 'hydronicLinks');
  const catalog = index(project.appliedCatalogSnapshots, 'appliedCatalogSnapshots');
  index(project.controlLinks, 'controlLinks');
  index(project.loopRoutes, 'loopRoutes');

  project.components.forEach((component, i) => {
    reference(rooms, component.roomId, `components.${i}.roomId`);
    reference(catalog, component.catalogSnapshotId, `components.${i}.catalogSnapshotId`);
  });
  for (const key of ['hydronicLinks', 'controlLinks'] as const) {
    project[key].forEach((link, i) => {
      reference(components, link.from.componentId, `${key}.${i}.from.componentId`);
      reference(components, link.to.componentId, `${key}.${i}.to.componentId`);
    });
  }
  let totalPoints = project.hydronicLinks.reduce((count, link) => count + link.points.length, 0);
  project.loopRoutes.forEach((route, i) => {
    reference(rooms, route.roomId, `loopRoutes.${i}.roomId`);
    reference(hydronics, route.linkId, `loopRoutes.${i}.linkId`);
    totalPoints += route.points.length;
  });
  if (totalPoints > projectLimits.totalRoutePoints) {
    errors.push(issue('route_point_budget', 'loopRoutes', 'Превышен общий лимит точек трасс проекта.'));
  }
  for (const id of Object.keys(project.initialConditions.airCByRoomId)) {
    reference(rooms, id, `initialConditions.airCByRoomId.${id}`);
  }
  return errors;
}

export function parseProject(input: unknown): Result<ProjectDocument> {
  const status = checkJsonValue(input);
  if (status === 'invalid_json_value') return failure(issue(status, '', 'Проект должен состоять из обычных JSON-данных.'));
  if (status === 'input_too_large') return failure(issue(status, '', 'Проект превышает лимит размера или сложности.'));

  const version = input && typeof input === 'object' && Object.hasOwn(input, 'schemaVersion')
    ? (input as { schemaVersion: unknown }).schemaVersion
    : undefined;
  if (typeof version !== 'number' || !Number.isSafeInteger(version)) {
    return failure(issue('invalid_schema', 'schemaVersion', 'Нет корректного номера версии проекта.'));
  }
  if (version > 1) return failure(issue('future_schema', 'schemaVersion', 'Откройте проект в более новой версии EducationSim.'));
  if (version < 1) return failure(issue('unsupported_schema', 'schemaVersion', 'Эта версия формата проекта не поддерживается.'));

  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.issues.slice(0, 100).map((i) =>
      issue('invalid_field', i.path.map(String).join('.'), 'Недопустимое поле, значение или размер.'));
    if (parsed.error.issues.length > errors.length) {
      errors.push(issue('additional_invalid_fields', '', 'Остальные ошибки формата не показаны.'));
    }
    const [first, ...rest] = errors;
    return { ok: false, diagnostics: [first ?? issue('invalid_field', '', 'Некорректный формат проекта.'), ...rest] };
  }
  const [first, ...rest] = validateGraph(parsed.data);
  return first ? { ok: false, diagnostics: [first, ...rest] } : { ok: true, value: parsed.data, diagnostics: [] };
}

export function migrateProject(input: unknown): Result<ProjectDocument> {
  // v1 is the first persisted format. Future migrations must be explicit and non-destructive.
  return parseProject(input);
}

export function parseProjectJson(text: string): Result<ProjectDocument> {
  if (!fitsJsonBudget(text)) return failure(issue('input_too_large', '', 'Файл проекта превышает 10 МиБ.'));
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return failure(issue('invalid_json', '', 'Файл не удалось прочитать как JSON.'));
  }
  return migrateProject(input);
}
