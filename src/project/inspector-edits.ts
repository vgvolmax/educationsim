import { equipmentRegistry, validateEquipmentSettings } from './registry';
import { validateRoute } from './routing';
import type { ProjectDocument, Result } from './types';

export type InspectorEdit =
  | { kind: 'set_component_parameters'; componentId: string; values: Record<string, string | number | boolean> }
  | { kind: 'set_room_start'; roomId: string; startC: number; targetC: number; limitC: number }
  | { kind: 'set_loop_route'; expectedRevision: number; route: ProjectDocument['loopRoutes'][number] };

const fail = (code: string, message: string): Result<ProjectDocument> =>
  ({ ok: false, diagnostics: [{ code, message, path: 'inspector', severity: 'error' }] });
export function editInspector(project: ProjectDocument, edit: InspectorEdit): Result<ProjectDocument> {
  const done = (value: ProjectDocument): Result<ProjectDocument> => ({ ok: true, diagnostics: [], value });
  switch (edit.kind) {
    case 'set_component_parameters': {
      const component = project.components.find((c) => c.id === edit.componentId);
      if (!component || !equipmentRegistry.has(component.typeId)) return fail('unknown_equipment', 'Учебный компонент не найден.');
      if (component.catalogSnapshotId && project.appliedCatalogSnapshots.find(({ id }) => id === component.catalogSnapshotId)?.basis !== 'training') return fail('catalog_parameter_locked', 'Паспортные значения нельзя изменить как учебные параметры.');
      const allowed = validateEquipmentSettings(component.typeId, edit.values);
      if (!allowed.ok) return allowed;
      return done({ ...project, components: project.components.map((c) => c.id === component.id
        ? { ...c, parameters: { ...c.parameters, ...allowed.value } } : c) });
    }
    case 'set_room_start': {
      if (!project.rooms.some((r) => r.id === edit.roomId)) return fail('room_missing', 'Комната не найдена.');
      const within = (n: number, low: number, high: number) => Number.isFinite(n) && n >= low && n <= high;
      if (!within(edit.startC, -10, 50) || !within(edit.targetC, 5, 40) || !within(edit.limitC, 15, 50)) {
        return fail('room_temperature_range', 'Проверьте диапазоны: старт −10…50 °C, уставка 5…40 °C, лимит пола 15…50 °C.');
      }
      return done({ ...project, rooms: project.rooms.map((r) => r.id === edit.roomId ? { ...r, airSetpointC: edit.targetC,
        surfaceLimitC: edit.limitC } : r), initialConditions: { ...project.initialConditions, airCByRoomId: {
        ...project.initialConditions.airCByRoomId, [edit.roomId]: edit.startC,
      } } });
    }
    case 'set_loop_route': {
      const route = edit.route;
      if (edit.expectedRevision !== project.revision) return fail('stale_route', 'Схема уже изменилась. Запросите новый предпросмотр.');
      const room = project.rooms.find((r) => r.id === route.roomId);
      const link = project.hydronicLinks.find((l) => l.id === route.linkId);
      if (!room || !link) return fail('route_target_missing', 'Комната или связь не найдены.');
      for (const endpoint of [link.from, link.to]) {
        const installed = project.components.find((c) => c.id === endpoint.componentId);
        const source = project.appliedCatalogSnapshots.find((snapshot) => snapshot.id === installed?.catalogSnapshotId);
        if (source?.catalogCard?.context === 'radiator') {
          return fail('catalog_context_mismatch', 'Радиаторная позиция не применяется как элемент петли тёплого пола.');
        }
      }

      if (!Number.isFinite(route.spacingM) || route.spacingM < .05 || route.spacingM > .4) {
        return fail('invalid_spacing', 'Шаг напольной петли должен быть от 50 до 400 мм.');
      }
      const retained = project.loopRoutes.filter((r) => r.linkId !== route.linkId);
      const diagnostics = validateRoute(route.points, { room, existingRoutes: retained.map((r) => r.points) });
      const [first, ...rest] = diagnostics;
      if (first) return { ok: false, diagnostics: [first, ...rest] };
      return done({ ...project, loopRoutes: [...retained, route] });
    }
  }
}
