import { expect, test } from 'vitest';
import { advanceBuilding } from '../../src/simulation/room';
import type { BuildingInput } from '../../src/simulation/room';
import { trainingFloorProfiles } from '../../src/simulation/floor';
import { resolveFluid } from '../../src/simulation/fluids';

const water = resolveFluid('water')!;
function base(): BuildingInput {
  return {
    seconds: 600,
    climate: { outdoorC: 0, belowFloorC: 10, airVolumetricCapacityJm3K: 1200 },
    rooms: [{ id: 'room', airCapacityJK: 1e6, envelopeWPerK: 100, ventilationM3s: 0, airTargetC: 22 }],
    floors: [], fluidProfiles: [water],
    state: { roomsC: { room: 20 }, floors: {}, fluid: { cells: {}, fluidProfileByCell: {} } },
  };
}
function value(input: BuildingInput) {
  const r = advanceBuilding(input);
  if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
  return r.value;
}
test('unheated_room_matches_exponential_v05, independent of wall clock', () => {
  const r = value(base());
  expect(r.roomsC.room).toBeCloseTo(20 * Math.exp(-.06), 10);
  expect(r.energy.envelopeLossJ).toBeCloseTo((20 - 20 * Math.exp(-.06)) * 1e6, 5);
  expect(r.energy.residualJ).toBeCloseTo(0, 5);
});
test('higher_outdoor_loss_changes_room_temperature; ventilation and climate are independent', () => {
  const p = base();
  const normal = value(p);
  p.rooms[0]!.ventilationM3s = .07;
  const ventilated = value(p);
  expect(ventilated.roomsC.room!).toBeLessThan(normal.roomsC.room!);
  expect(ventilated.energy.ventilationLossJ).toBeGreaterThan(0);
  p.climate.outdoorC = 24;
  const warm = value(p);
  expect(warm.roomsC.room!).toBeGreaterThan(20);
  expect(warm.energy.envelopeLossJ).toBeLessThan(0);
  expect(warm.energy.ventilationLossJ).toBeLessThan(0);
});
function withFloor(kind: 'dry' | 'wet'): BuildingInput {
  const p = base();
  p.floors.push({ id: 'fl', roomId: 'room', waterCellId: 'supply', areaM2: 10, surfaceLimitC: 29, profile: trainingFloorProfiles[kind] });
  p.state.floors.fl = { coreC: 20, surfaceC: 20 };
  p.state.fluid.cells.supply = { massKg: 200, temperatureC: 50 };
  p.state.fluid.fluidProfileByCell.supply = water.id;
  return p;
}
test('dry_and_wet_floor_have_different_inertia and exchange equal/opposite heat with finite water', () => {
  const dry = value(withFloor('dry')), wet = value(withFloor('wet'));
  expect(dry.floors.fl!.coreC).toBeGreaterThan(wet.floors.fl!.coreC);
  expect(dry.floors.fl!.surfaceC).toBeGreaterThan(wet.floors.fl!.surfaceC);
  expect(dry.fluid.cells.supply!.temperatureC).toBeLessThan(50);
  expect(dry.energy.residualJ).toBeCloseTo(0, 5);
  expect(wet.energy.residualJ).toBeCloseTo(0, 5);
});
test('surface_limit_is_distinct_from_water_temperature and reports only surface exceedance', () => {
  const p = withFloor('wet');
  p.seconds = 1;
  const cool = value(p);
  expect(cool.floors.fl!.waterC).toBeGreaterThan(29);
  expect(cool.floors.fl!.aboveSurfaceLimit).toBe(false);
  p.state.floors.fl!.surfaceC = 35;
  const warm = value(p);
  expect(warm.floors.fl!.aboveSurfaceLimit).toBe(true);
  expect(warm.roomsC.room).not.toBe(warm.floors.fl!.surfaceC);
});
test('radiator raises room temperature without adding unaccounted energy', () => {
  const p = withFloor('wet');
  const baseline = value(p);
  p.radiators = [{ roomId: 'room', waterCellId: 'supply', uaWPerK: 200 }];
  const heated = value(p);
  expect(heated.roomsC.room!).toBeGreaterThan(baseline.roomsC.room!);
  expect(heated.energy.radiatorToRoomJ).toBeGreaterThan(0);
  expect(heated.energy.residualJ).toBeCloseTo(0, 5);
});
test('invalid and excessive models leave the previous state untouched', () => {
  const p = withFloor('wet');
  p.state.fluid.fluidProfileByCell.supply = 'unknown';
  expect(advanceBuilding(p)).toMatchObject({ ok: false, diagnostics: [{ code: 'invalid_building_water' }] });
  expect(p.state.floors.fl!.coreC).toBe(20);
  const extreme = base();
  extreme.rooms[0]!.envelopeWPerK = 1e30;
  expect(advanceBuilding(extreme)).toMatchObject({ ok: false, diagnostics: [{ code: 'building_step_budget' }] });
});

test('finite fluid and core agree with independent two-body exchange', () => {
  const p = withFloor('dry');
  p.seconds = 1;
  p.rooms[0]!.envelopeWPerK = 0;
  p.state.fluid.cells.supply = { massKg: 1, temperatureC: 40 };
  p.floors[0] = { ...p.floors[0]!, areaM2: 1, profile: {
    kind: 'custom', coreCapacityJm2K: 1000, surfaceCapacityJm2K: 2000,
    waterToCoreWm2K: 10, coreToSurfaceWm2K: 0, surfaceToAirWm2K: 0, coreToGroundWm2K: 0,
  } };
  const r = value(p);
  const combinedMean = (4180 * 40 + 1000 * 20) / 5180;
  const difference = 20 * Math.exp(-10 * (1 / 4180 + 1 / 1000));
  expect(r.floors.fl!.coreC).toBeCloseTo(combinedMean - difference * 4180 / 5180, 10);
  expect(r.floors.fl!.waterC).toBeCloseTo(combinedMean + difference * 1000 / 5180, 10);
  expect(r.energy.storedDeltaJ).toBeCloseTo(0, 8);
});
