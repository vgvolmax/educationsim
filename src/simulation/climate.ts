import { finiteTemperature } from './mixing';

export type Climate = { outdoorC: number; belowFloorC: number; airVolumetricCapacityJm3K: number };
export const nonnegative = (value: number): boolean => Number.isFinite(value) && value >= 0;
export const positive = (value: number): boolean => Number.isFinite(value) && value > 0;
export const checkedClimate = (climate: Climate): boolean =>
  finiteTemperature(climate.outdoorC) && finiteTemperature(climate.belowFloorC) && positive(climate.airVolumetricCapacityJm3K);

export function ventilationConductance(climate: Climate, volumeFlowM3s: number): number {
  return climate.airVolumetricCapacityJm3K * volumeFlowM3s;
}

export type HeatBody = { c: number; t: number };

/** Exact exchange of two finite, uniform temperature bodies with a constant conductance for one substep. */
export function exchangeHeat(a: HeatBody, b: HeatBody, ua: number, seconds: number): number {
  const inverseSum = 1 / a.c + 1 / b.c;
  const moved = (a.t - b.t) * -Math.expm1(-ua * seconds * inverseSum) / inverseSum;
  a.t -= moved / a.c;
  b.t += moved / b.c;
  return moved;
}

/** Atmosphere and ground are explicit fixed-temperature reservoirs during this step. */
export function exchangeReservoir(a: HeatBody, boundaryC: number, ua: number, seconds: number): number {
  const change = (boundaryC - a.t) * -Math.expm1(-(ua / a.c) * seconds);
  a.t += change;
  return -change * a.c;
}
