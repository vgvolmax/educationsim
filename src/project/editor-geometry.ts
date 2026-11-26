import { pointInOutline, validateOutline } from './geometry';
import type { Point2, ProjectDocument, Result, Room } from './types';

export type RoomRectangle = Point2 & { widthM: number; depthM: number };
export type RoomEdit = { kind: 'add_rectangular_room'; roomId: string; level: number } & RoomRectangle |
  { kind: 'resize_rectangular_room'; roomId: string; widthM: number; depthM: number };
const fail = (code: string, message: string): Result<ProjectDocument> =>
  ({ ok: false, diagnostics: [{ code, message, path: 'rooms', severity: 'error' }] });

export function createEmptyProject(projectId: string): ProjectDocument {
  return { schemaVersion: 1, projectId, title: 'Новый проект', revision: 0, catalogReleaseId: 'training-v1', modelVersion: 'training-v1',
    environment: { outdoorC: 0, belowFloorC: 18, fluid: 'water' }, rooms: [], components: [], hydronicLinks: [], controlLinks: [],
    loopRoutes: [], appliedCatalogSnapshots: [], initialConditions: { airCByRoomId: {}, waterC: 20, gaugePressurePa: 100000 },
    viewPreferences: { mode: '2d', level: 0 } };
}

function bounds(outline: readonly Point2[]): RoomRectangle {
  const xs = outline.map(({ x }) => x), zs = outline.map(({ z }) => z);
  const x = Math.min(...xs), z = Math.min(...zs);
  return { x, z, widthM: Math.max(...xs) - x, depthM: Math.max(...zs) - z };
}

export function rectangleOf(room: Room): RoomRectangle | null {
  if (room.outline.length !== 4 || validateOutline(room.outline).length) return null;
  return bounds(room.outline);
}

function overlaps(a: RoomRectangle, b: RoomRectangle): boolean {
  return a.x < b.x + b.widthM && b.x < a.x + a.widthM && a.z < b.z + b.depthM && b.z < a.z + a.depthM;
}

export function editRectangularRoom(project: ProjectDocument, command: RoomEdit): Result<ProjectDocument> {
  const add = command.kind === 'add_rectangular_room';
  const existing = project.rooms.find(({ id }) => id === command.roomId);
  if (add && (existing || project.rooms.length >= 12)) return fail('room_limit_or_duplicate', 'Не удалось добавить комнату: проверьте лимит 12 комнат.');
  const from = add ? command : existing && rectangleOf(existing);
  if (!from) return fail('unsupported_room_outline', 'Этот контур нельзя редактировать как прямоугольник.');
  const { x, z } = from, { widthM, depthM } = command;
  const level = add ? command.level : existing!.level;
  if (![x, z, widthM, depthM].every(Number.isFinite) || widthM < .2 || widthM > 100 || depthM < .2 || depthM > 100 ||
      !Number.isInteger(level) || level < 0 || level > 2 || Math.max(Math.abs(x), Math.abs(z), Math.abs(x + widthM), Math.abs(z + depthM)) > 10000) {
    return fail('invalid_room_dimensions', 'Размеры комнаты должны быть от 0,2 до 100 м; доступны три этажа.');
  }
  const outline = [{ x, z }, { x: x + widthM, z }, { x: x + widthM, z: z + depthM }, { x, z: z + depthM }];
  if (project.rooms.some((r) => r.id !== command.roomId && r.level === level && overlaps({ x, z, widthM, depthM }, bounds(r.outline)))) {
    return fail('room_overlaps', 'Комната пересекает область другой комнаты на этом этаже.');
  }
  if (existing) {
    const points = [
      ...project.components.filter((c) => c.roomId === existing.id).map((c) => c.position),
      ...project.loopRoutes.filter((r) => r.roomId === existing.id).flatMap((r) => r.points),
      ...existing.openings.flatMap(({ from, to }) => [from, to]),
      ...existing.exclusions.flatMap(({ origin, widthM, depthM }) => [origin, { x: origin.x + widthM, z: origin.z + depthM }]),
    ];
    if (points.some((p) => !pointInOutline(p, outline))) {
      return fail('room_contains_geometry', 'Размеры оставляют трубы, отверстия или оборудование за стеной.');
    }
  }
  const room: Room = existing ? { ...existing, outline } : { id: command.roomId, name: 'Комната ' + (project.rooms.length + 1),
    level, heightM: 2.7, outline, wallLossWPerK: 45, floorLossWPerK: 11, airCapacityJPerK: 90000, airSetpointC: 21,
    surfaceLimitC: 29, floorFinishId: 'tile', exclusions: [], openings: [] };
  return { ok: true, diagnostics: [], value: { ...project, rooms: add ? [...project.rooms, room] : project.rooms.map((r) => r.id === room.id ? room : r),
    initialConditions: add ? { ...project.initialConditions, airCByRoomId: { ...project.initialConditions.airCByRoomId, [room.id]: 20 } } : project.initialConditions } };
}
