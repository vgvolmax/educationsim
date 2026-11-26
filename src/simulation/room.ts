import type { Result } from '../project/types';
import { checkedClimate, exchangeHeat, exchangeReservoir, nonnegative, positive, ventilationConductance } from './climate';
import type { Climate, HeatBody } from './climate';
import type { FluidProfile } from './fluids';
import { prepareFloor } from './floor';
import type { FloorSection, FloorTemperatures } from './floor';
import type { FluidThermalState } from './heat-transfer';
import { finiteTemperature } from './mixing';

type Room = { id: string; airCapacityJK: number; envelopeWPerK: number; ventilationM3s: number; airTargetC: number };
type Radiator = { roomId: string; waterCellId: string; uaWPerK: number };
type Fluid = Pick<FluidThermalState, 'cells' | 'fluidProfileByCell'>;
type ObservedFloor = FloorTemperatures & { waterC: number; aboveSurfaceLimit: boolean };
export type BuildingInput = {
  seconds: number; climate: Climate; rooms: Room[]; floors: FloorSection[]; fluidProfiles: readonly FluidProfile[];
  state: { roomsC: Record<string, number>; floors: Record<string, FloorTemperatures>; fluid: Fluid };
  radiators?: readonly Radiator[];
};
type Energy = { envelopeLossJ: number; ventilationLossJ: number; groundLossJ: number; radiatorToRoomJ: number; storedDeltaJ: number; residualJ: number };
export type BuildingState = {
  roomsC: Record<string, number>; airTargetCByRoom: Record<string, number>; floors: Record<string, ObservedFloor>;
  fluid: Fluid; energy: Energy; substeps: number;
};
type Body = HeatBody & { first: number; load: number };
type Pair = { a: Body; b: Body; ua: number; radiator: boolean };
type Boundary = { body: Body; ua: number; t: number; sink: 'envelopeLossJ' | 'ventilationLossJ' | 'groundLossJ' };
const fail = (code: string, path: string, message: string): Result<BuildingState> =>
  ({ ok: false, diagnostics: [{ code, path, message, severity: 'error' }] });
const body = (t: number, c: number): Body => ({ t, c, first: t, load: 0 });

export function advanceBuilding(input: BuildingInput): Result<BuildingState> {
  const { seconds, climate, state } = input;
  if (!positive(seconds) || seconds > 3600 || !checkedClimate(climate) || input.floors.length > 10_000) {
    return fail('invalid_climate', 'climate', 'Некорректные значения климата, шага или количества секций.');
  }
  const rooms = new Map<string, Body>(), water = new Map<string, Body>(), pairs: Pair[] = [], boundaries: Boundary[] = [];
  const profiles = new Map(input.fluidProfiles.map((profile) => [profile.id, profile]));
  const floors = new Map<string, { core: Body; surface: Body; water: Body; limit: number }>();
  function pair(a: Body, b: Body, ua: number, radiator = false): void {
    if (!ua) return;
    a.load += ua; b.load += ua;
    pairs.push({ a, b, ua, radiator });
  }
  function boundary(a: Body, t: number, ua: number, sink: Boundary['sink']): void {
    if (!ua) return;
    a.load += ua;
    boundaries.push({ body: a, t, ua, sink });
  }

  for (const room of input.rooms) {
    const airC = state.roomsC[room.id];
    const vent = ventilationConductance(climate, room.ventilationM3s);
    if (!room.id || rooms.has(room.id) || airC === undefined || !finiteTemperature(airC) || !finiteTemperature(room.airTargetC) ||
        !positive(room.airCapacityJK) || !nonnegative(room.envelopeWPerK) || !nonnegative(vent)) {
      return fail('invalid_building_room', room.id, 'Не заданы допустимые параметры воздуха или ограждений комнаты.');
    }
    const b = body(airC, room.airCapacityJK);
    rooms.set(room.id, b);
    boundary(b, climate.outdoorC, room.envelopeWPerK, 'envelopeLossJ');
    boundary(b, climate.outdoorC, vent, 'ventilationLossJ');
  }
  for (const [id, cell] of Object.entries(state.fluid.cells)) {
    const fluid = profiles.get(state.fluid.fluidProfileByCell[id] ?? '');
    const c = cell.massKg * (fluid?.specificHeatJkgK ?? NaN);
    if (!positive(cell.massKg) || !positive(c) || !finiteTemperature(cell.temperatureC)) {
      return fail('invalid_building_water', id, 'Нет подтверждённой теплоёмкости или состояния воды.');
    }
    water.set(id, body(cell.temperatureC, c));
  }
  for (const floor of input.floors) {
    const prepared = prepareFloor(floor, state.floors[floor.id]);
    const air = rooms.get(floor.roomId), supply = water.get(floor.waterCellId);
    if (!floor.id || !prepared || !air || !supply || floors.has(floor.id)) {
      return fail('invalid_building_floor', floor.id, 'Секция пола не связана с допустимым водяным контуром и комнатой.');
    }
    const core = body(prepared.core.t, prepared.core.c), surface = body(prepared.surface.t, prepared.surface.c);
    floors.set(floor.id, { core, surface, water: supply, limit: floor.surfaceLimitC });
    pair(supply, core, prepared.waterUA);
    pair(core, surface, prepared.surfaceUA);
    pair(surface, air, prepared.roomUA);
    boundary(core, climate.belowFloorC, prepared.groundUA, 'groundLossJ');
  }
  for (const radiator of input.radiators ?? []) {
    const air = rooms.get(radiator.roomId), supply = water.get(radiator.waterCellId);
    if (!air || !supply || !nonnegative(radiator.uaWPerK)) {
      return fail('invalid_building_radiator', radiator.roomId, 'У радиатора нет допустимого гидравлического и комнатного подключения.');
    }
    pair(supply, air, radiator.uaWPerK, true);
  }

  const bodies = [...rooms.values(), ...water.values(), ...[...floors.values()].flatMap(({ core, surface }) => [core, surface])];
  let substeps = 1;
  for (const b of bodies) substeps = Math.max(substeps, Math.ceil(seconds * (b.load / b.c) * 16));
  if (!Number.isFinite(substeps) || substeps > 2048 || (pairs.length + boundaries.length) * substeps > 3_000_000) {
    return fail('building_step_budget', 'seconds', 'Для тепловых параметров нужен меньший шаг или упрощение модели.');
  }
  const energy: Energy = { envelopeLossJ: 0, ventilationLossJ: 0, groundLossJ: 0, radiatorToRoomJ: 0, storedDeltaJ: 0, residualJ: 0 };
  const dt = seconds / substeps;
  for (let i = 0; i < substeps; i++) {
    for (const link of pairs) {
      const moved = exchangeHeat(link.a, link.b, link.ua, dt);
      if (link.radiator) energy.radiatorToRoomJ += moved;
    }
    for (const link of boundaries) energy[link.sink] += exchangeReservoir(link.body, link.t, link.ua, dt);
  }
  energy.storedDeltaJ = bodies.reduce((sum, b) => sum + (b.t - b.first) * b.c, 0);
  energy.residualJ = energy.storedDeltaJ + energy.envelopeLossJ + energy.ventilationLossJ + energy.groundLossJ;
  const energyScale = bodies.reduce((sum, b) => sum + Math.abs(b.t * b.c) + Math.abs(b.first * b.c), 0);
  if (bodies.some((b) => !finiteTemperature(b.t)) || !Number.isFinite(energyScale) ||
      !Object.values(energy).every(Number.isFinite) || Math.abs(energy.residualJ) > Math.max(1e-6, energyScale * 1e-10)) {
    return fail('building_energy_balance', 'energy', 'Температуры или остаток энергии вышли за допустимые границы.');
  }
  return { ok: true, value: {
    roomsC: Object.fromEntries([...rooms].map(([id, air]) => [id, air.t])),
    airTargetCByRoom: Object.fromEntries(input.rooms.map(({ id, airTargetC }) => [id, airTargetC])),
    floors: Object.fromEntries([...floors].map(([id, floor]) => [id, {
      coreC: floor.core.t, surfaceC: floor.surface.t, waterC: floor.water.t, aboveSurfaceLimit: floor.surface.t > floor.limit,
    }])),
    fluid: { fluidProfileByCell: { ...state.fluid.fluidProfileByCell },
      cells: Object.fromEntries([...water].map(([id, b]) => [id, { massKg: state.fluid.cells[id]!.massKg, temperatureC: b.t }])) },
    energy, substeps,
  }, diagnostics: [] };
}
