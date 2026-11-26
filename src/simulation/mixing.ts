import type { Result } from '../project/types';

export type InflowStream = {
  massFlowKgS: number;
  heatCapacityJkgK: number;
  temperatureC: number;
};
export type JunctionMixture = {
  temperatureC: number | null;
  massFlowKgS: number;
  heatCapacityFlowWK: number;
  enthalpyFlowW: number;
};

export const finiteTemperature = (value: number): boolean => Number.isFinite(value) && value >= -273.15;
const compatibleStream = (stream: InflowStream): boolean =>
  Number.isFinite(stream.massFlowKgS) && stream.massFlowKgS >= 0 &&
  Number.isFinite(stream.heatCapacityJkgK) && stream.heatCapacityJkgK > 0 && finiteTemperature(stream.temperatureC);
const invalid = (): Result<JunctionMixture> => ({
  ok: false,
  diagnostics: [{ code: 'invalid_thermal_stream', path: 'streams', severity: 'error', message: 'Неверные температура, расход или теплоёмкость потока.' }],
});

/** Mix only streams that the caller proved belong to the same hydraulic domain. */
export function mixStreams(streams: readonly InflowStream[], lastTemperatureC?: number): Result<JunctionMixture> {
  if (lastTemperatureC !== undefined && !finiteTemperature(lastTemperatureC)) return invalid();
  let massFlowKgS = 0, heatCapacityFlowWK = 0, enthalpyFlowW = 0;
  for (const stream of streams) {
    if (!compatibleStream(stream)) return invalid();
    massFlowKgS += stream.massFlowKgS;
    const flowCapacity = stream.massFlowKgS * stream.heatCapacityJkgK;
    heatCapacityFlowWK += flowCapacity;
    enthalpyFlowW += flowCapacity * stream.temperatureC;
  }
  if (![massFlowKgS, heatCapacityFlowWK, enthalpyFlowW].every(Number.isFinite) ||
      (massFlowKgS > 0 && heatCapacityFlowWK === 0)) return invalid();
  const temperatureC = heatCapacityFlowWK > 0 ? enthalpyFlowW / heatCapacityFlowWK : lastTemperatureC ?? null;
  if (temperatureC !== null && (!Number.isFinite(temperatureC) || temperatureC < -273.15 - 1e-10)) return invalid();
  return { ok: true, value: { massFlowKgS, heatCapacityFlowWK, enthalpyFlowW,
    temperatureC: temperatureC === null ? null : Math.max(temperatureC, -273.15) }, diagnostics: [] };
}

export function transportedHeatW(massFlowKgS: number, heatCapacityJkgK: number, inletC: number, outletC: number): number | null {
  if (!compatibleStream({ massFlowKgS, heatCapacityJkgK, temperatureC: inletC }) || !finiteTemperature(outletC)) return null;
  const power = massFlowKgS * heatCapacityJkgK * (inletC - outletC);
  return Number.isFinite(power) ? power === 0 ? 0 : power : null;
}
