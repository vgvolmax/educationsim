import { expect, test } from 'vitest';
import { mixStreams, transportedHeatW } from '../../src/simulation/mixing';

test('mixture_is_35c_in_v03 and conserves incoming mass and enthalpy', () => {
  const result = mixStreams([
    { massFlowKgS: 1, heatCapacityJkgK: 4180, temperatureC: 60 },
    { massFlowKgS: 5, heatCapacityJkgK: 4180, temperatureC: 30 },
  ]);
  expect(result).toMatchObject({ ok: true, value: { temperatureC: 35, massFlowKgS: 6, heatCapacityFlowWK: 25080, enthalpyFlowW: 877800 } });
});

test('zero incoming mass needs prior temperature and never fabricates an average', () => {
  const stagnant = [{ massFlowKgS: 0, heatCapacityJkgK: 4180, temperatureC: 60 }];
  expect(mixStreams(stagnant, 23)).toMatchObject({ ok: true, value: { temperatureC: 23, massFlowKgS: 0, enthalpyFlowW: 0 } });
  expect(mixStreams(stagnant)).toMatchObject({ ok: true, value: { temperatureC: null } });
  expect(mixStreams([{ ...stagnant[0]!, massFlowKgS: -1 }])).toMatchObject({ ok: false });
});
test('enthalpy weighting respects different heat capacities for generic streams', () => {
  const result = mixStreams([
    { massFlowKgS: 1, heatCapacityJkgK: 4000, temperatureC: 10 },
    { massFlowKgS: 1, heatCapacityJkgK: 2000, temperatureC: 40 },
  ]);
  expect(result).toMatchObject({ ok: true, value: { temperatureC: 20, massFlowKgS: 2, heatCapacityFlowWK: 6000 } });
});
test('loop_emits_348w_in_v04 from advective enthalpy and zero mass transports zero', () => {
  expect(transportedHeatW(1000 / 60000, 4180, 35, 30)).toBeCloseTo(348.333333, 5);
  expect(transportedHeatW(0, 4180, 80, 20)).toBe(0);
  expect(transportedHeatW(1, 4000, 20, 25)).toBe(-20_000);
  expect(transportedHeatW(1, 4000, Infinity, 25)).toBeNull();
});
