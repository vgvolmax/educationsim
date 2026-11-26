import { expect, test } from 'vitest';
import { advancePressure } from '../../src/simulation/pressure';
import type { PressureInput } from '../../src/simulation/pressure';
import { advanceService } from '../../src/simulation/service';

const reference: PressureInput = {
  seconds: 4, priorNetVolumeM3: 0, admittedVolumeM3: .002, referenceLiquidM3: .05,
  referenceC: 20, meanC: 20, expansionPerK: .0003,
  atmosphericPa: 100000, referenceGaugePa: 100000, densityKgM3: 1000, cpJkgK: 4180,
  tank: { gasAtReferenceM3: .008, minimumGasM3: .001, maximumGasM3: .010 },
};
test('tank_matches_v06, uses absolute pressure and separates thermal expansion', () => {
  const r = advancePressure(reference);
  expect(r).toMatchObject({ ok: true, value: { status: 'normal', gasVolumeM3: .006 } });
  if (!r.ok) return;
  expect(r.value.absolutePa).toBeCloseTo(266666.6666667, 5);
  expect(r.value.gaugePa).toBeCloseTo(166666.6666667, 5);
  const thermal = advancePressure({ ...reference, admittedVolumeM3: 0, meanC: 30 });
  expect(thermal).toMatchObject({ ok: true, value: { thermalExpansionM3: .00015 } });
});
test('relief_event_tracks_lost_water and corresponding energy only for an explicit capacity', () => {
  const r = advancePressure({ ...reference, relief: { opensGaugePa: 150000, ratedMaxM3s: .0002 } });
  expect(r).toMatchObject({ ok: true, value: { status: 'restricted', relief: { triggered: true } } });
  if (!r.ok) return;
  expect(r.value.relief.dischargedM3).toBeCloseTo(.0004, 10);
  expect(r.value.relief.dischargedKg).toBeCloseTo(.4, 8);
  expect(r.value.relief.dischargedJ).toBeCloseTo(.4 * 4180 * 20, 6);
  expect(r.value.gaugePa).toBeCloseTo(150000, 5);
  const unknown = advancePressure({ ...reference, relief: { opensGaugePa: 150000 } });
  expect(unknown).toMatchObject({ ok: true, value: { status: 'restricted', relief: { triggered: true, dischargedM3: null } } });
});
test('missing_tank_reaches_model_boundary and no_numeric_pressure_after_model_boundary', () => {
  const a = advancePressure({ ...reference, tank: undefined });
  expect(a).toMatchObject({ ok: true, value: { status: 'stopped', gaugePa: null, absolutePa: null },
    diagnostics: [{ code: 'pressure_capacity_unknown' }] });
  const b = advancePressure({ ...reference, admittedVolumeM3: .02 });
  expect(b).toMatchObject({ ok: true, value: { status: 'stopped', gaugePa: null, absolutePa: null },
    diagnostics: [{ code: 'gas_volume_boundary' }] });
  const c = advancePressure({ ...reference, admittedVolumeM3: .02, relief: { opensGaugePa: 150000, ratedMaxM3s: .02 } });
  expect(c).toMatchObject({ ok: true, value: { status: 'stopped', gaugePa: null, absolutePa: null,
    relief: { triggered: true, dischargedM3: null } } });
});
test('service_energy_and_mass_ledger_closes including empty and overflow boundaries', () => {
  const initial = { capacityM3: .01, liquidKg: 8, temperatureC: 40 };
  const fluid = { densityKgM3: 1000, cpJkgK: 4180 };
  const r = advanceService(initial, fluid, { drainKg: 2, fillKg: 1, fillC: 10 });
  expect(r).toMatchObject({ ok: true, value: { state: { liquidKg: 7 }, ledger: {
    inKg: 1, outKg: 2, inJ: 41800, outJ: 334400,
  } } });
  if (r.ok) {
    expect(r.value.ledger.residualJ).toBeCloseTo(0, 7);
    expect(r.value.unfilledM3).toBeCloseTo(.003, 10);
  }
  expect(advanceService(initial, fluid, { drainKg: 8, fillKg: 0, fillC: 0 })).toMatchObject({
    ok: true, value: { state: { liquidKg: 0, temperatureC: null } },
  });
  expect(advanceService(initial, fluid, { drainKg: 0, fillKg: 8, fillC: 0 })).toMatchObject({
    ok: false, diagnostics: [{ code: 'service_overflow' }],
  });
  expect(initial).toEqual({ capacityM3: .01, liquidKg: 8, temperatureC: 40 });
});
