import { projectLimits } from './limits';
import { validateOutline } from './geometry';
import { roundCorners } from './route-curves';
import { layoutFloor } from './route-layout';
import { directionCosine, distance, inspectRoute, near } from './route-warnings';
import type { RouteBend } from './route-curves';
import type { FloorDirection } from './route-layout';
import type { RouteConstraints, RouteDiagnostic } from './route-warnings';
import type { Point3 } from './types';

export { validateRoute } from './route-warnings';

type Base = RouteConstraints & {
  spacingM: number; radiusM: number; start: Point3; end: Point3;
  supplyLead?: readonly Point3[]; returnLead?: readonly Point3[];
};
export type LoopRouteInput = Base & (
  | { kind: 'serpentine' | 'spiral'; direction: FloorDirection }
  | { kind: 'manual'; points: readonly Point3[] }
);
export type PlannedLoop = {
  kind: LoopRouteInput['kind'];
  points: Point3[];
  bends: RouteBend[];
  lengthM: number;
  sleeves: Point3[];
};
export type RouteResult =
  | { ok: true; value: PlannedLoop; diagnostics: RouteDiagnostic[] }
  | { ok: false; diagnostics: [RouteDiagnostic, ...RouteDiagnostic[]] };

const issue = (code: string, path: string, message: string, location?: Point3): RouteDiagnostic =>
  ({ code, path, message, severity: 'error', ...(location ? { location } : {}) });
const fail = (error: RouteDiagnostic): RouteResult => ({ ok: false, diagnostics: [error] });
const finite = (p: Point3): boolean => [p.x, p.y, p.z].every(Number.isFinite);
export function measureRoute(points: readonly Point3[]): number {
  return points.slice(1).reduce((sum, p, i) => sum + distance(points[i]!, p), 0);
}

const failures = {
  invalid_access: 'Для автопрокладки нужны два входа на одной стене с заданным шагом.',
  blocked_layout: 'Выбранное направление упирается в стену или запретную зону.',
  route_budget: 'Для этой геометрии и шага превышен бюджет автопрокладки.',
  unsupported_spiral: 'Автоматическая улитка доступна для прямоугольной комнаты без вырезов.',
};

export function planLoop(input: LoopRouteInput): RouteResult {
  const [outlineError] = validateOutline(input.room.outline);
  if (outlineError) return fail(outlineError);
  const { start, end, spacingM, radiusM } = input;
  if (!Number.isFinite(spacingM) || spacingM < .05 || spacingM > .4 || !Number.isFinite(radiusM) || radiusM <= 0) {
    return fail(issue('invalid_spacing', 'spacingM', 'Проверьте шаг 50–400 мм и допустимый радиус трубы.'));
  }
  if (!finite(start) || !finite(end)) return fail(issue('invalid_route', 'points', 'Проверяются только конечные координаты.'));
  if (input.room.exclusions.length > 128 || input.room.exclusions.some(({ origin, widthM, depthM }) =>
    ![origin.x, origin.z, widthM, depthM].every(Number.isFinite) || widthM <= 0 || depthM <= 0)) {
    return fail(issue('invalid_keepout', 'exclusions', 'У запретной зоны должны быть положительные размеры.'));
  }
  if (input.kind !== 'manual' && radiusM * 2 > spacingM + 1e-8) {
    return fail(issue('radius_too_short', 'radiusM', 'Шаг не позволяет соблюсти указанный радиус разворота.', start));
  }

  const leadIn = input.supplyLead ?? [], leadOut = input.returnLead ?? [];
  const priorPoints = (input.existingRoutes ?? []).reduce((sum, route) => sum + route.length, 0);
  const allowedPoints = Math.min(projectLimits.routePoints, projectLimits.totalRoutePoints - priorPoints);
  const leadPoints = Math.max(0, leadIn.length - 1) + Math.max(0, leadOut.length - 1);
  if (leadPoints + (input.kind === 'manual' ? input.points.length : 2) > allowedPoints) {
    return fail(issue('route_budget', 'points', failures.route_budget));
  }
  if ((leadIn.length && !near(leadIn.at(-1)!, start)) || (leadOut.length && !near(leadOut[0]!, end))) {
    return fail(issue('invalid_access', 'leads', 'Подводки должны стыковаться с входом и выходом петли.'));
  }

  let floor: readonly Point3[], partial = false;
  if (input.kind === 'manual') {
    if (input.points.length < 2 || !near(input.points[0]!, start) || !near(input.points.at(-1)!, end)) {
      return fail(issue('invalid_access', 'points', 'Ручная трасса должна соединять выбранные вход и выход.'));
    }
    floor = input.points;
  } else {
    const layout = layoutFloor(input.room, start, end, input.direction, input.kind, spacingM);
    if ('code' in layout) return fail(issue(layout.code, 'points', failures[layout.code], layout.location));
    floor = layout.vertices;
    partial = layout.partial;
  }

  const vertices = [...leadIn.slice(0, -1), ...floor, ...leadOut.slice(1)];
  if (vertices.length > allowedPoints) return fail(issue('route_budget', 'points', failures.route_budget));
  if (vertices.some((p) => !finite(p))) return fail(issue('invalid_route', 'points', 'Проверяются не более 1024 конечных координат.'));
  const first = Math.max(0, leadIn.length - 1), last = first + floor.length - 1;
  for (const entry of [first, last]) {
    if (entry > 0 && entry < vertices.length - 1 &&
        directionCosine(vertices[entry - 1]!, vertices[entry]!, vertices[entry + 1]!) < 1 - 1e-8) {
      return fail(issue('lead_angle', `points.${entry}`, 'Подводка должна входить в петлю по касательной. Вынесите изгиб с нужным радиусом внутрь одного участка.', vertices[entry]));
    }
  }
  const unrounded = inspectRoute(vertices, input, { first, last });
  if (unrounded.diagnostic) return fail(unrounded.diagnostic);
  const rounded = roundCorners(vertices, radiusM, new Set([first, last]));
  if ('failedAt' in rounded) return fail(issue('radius_too_short', `points.${rounded.failedAt}`, 'На этом участке не помещается допустимый радиус.', vertices[rounded.failedAt]));
  if (rounded.points.length > allowedPoints) return fail(issue('route_budget', 'points', failures.route_budget));

  const reviewed = inspectRoute(rounded.points, input, { first: rounded.indexMap.get(first)!, last: rounded.indexMap.get(last)! });
  if (reviewed.diagnostic) return fail(reviewed.diagnostic);
  const diagnostics: RouteDiagnostic[] = [];
  if (partial) diagnostics.push({ severity: 'warning', code: 'partial_coverage', path: 'points', message: 'За вырезом или препятствием может остаться непокрытая зона.' });
  if (reviewed.sleeves.length) diagnostics.push({ severity: 'warning', code: 'sleeve_required', path: 'seams', message: 'В местах пересечения шва требуется защитная гильза.', location: reviewed.sleeves[0] });
  return { ok: true, value: { kind: input.kind, points: rounded.points, bends: rounded.bends, lengthM: rounded.lengthM, sleeves: reviewed.sleeves }, diagnostics };
}
