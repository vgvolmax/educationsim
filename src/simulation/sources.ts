import type { Result } from '../project/types';
import { finiteTemperature } from './mixing';

export type SourceProfile = {
  kind: 'boiler' | 'heat-pump' | 'external'; ratedPowerW: number; maximumSupplyC: number; minimumFlowM3s?: number;
  weather: { coldOutdoorC: number; coldSupplyC: number; warmOutdoorC: number; warmSupplyC: number };
};
export type SourceRequest = {
  demand: boolean; manual: boolean; powered: boolean; available: boolean; permitted: boolean;
  outdoorC: number; requestedPowerW: number; supplyC: number; flowM3s: number;
};
type SourceOutput = {
  requested: boolean; powered: boolean; available: boolean; permitted: boolean; targetC: number; powerW: number;
  reason: 'no-demand' | 'unavailable' | 'blocked' | 'minimum-flow' | 'at-target' | 'heating';
};
const positive = (x: number) => Number.isFinite(x) && x > 0;
const nonnegative = (x: number) => Number.isFinite(x) && x >= 0;

export function regulateSource(profile: SourceProfile, input: SourceRequest): Result<SourceOutput> {
  const { weather } = profile;
  const minFlow = profile.minimumFlowM3s ?? 0;
  if (!['boiler', 'heat-pump', 'external'].includes(profile.kind) || !positive(profile.ratedPowerW) ||
      !nonnegative(minFlow) || (profile.kind === 'heat-pump' && minFlow <= 0) || !nonnegative(input.requestedPowerW) ||
      !Number.isFinite(input.flowM3s) || ![profile.maximumSupplyC, weather.coldOutdoorC, weather.coldSupplyC, weather.warmOutdoorC,
        weather.warmSupplyC, input.outdoorC, input.supplyC].every(finiteTemperature) ||
      weather.coldOutdoorC >= weather.warmOutdoorC || weather.coldSupplyC < weather.warmSupplyC ||
      ![input.demand, input.manual, input.powered, input.available, input.permitted].every((value) => typeof value === 'boolean')) {
    return { ok: false, diagnostics: [{ code: 'invalid_source_profile', path: 'source', severity: 'error', message: 'Некорректный профиль источника или данные подачи.' }] };
  }
  const factor = Math.max(0, Math.min(1, (input.outdoorC - weather.coldOutdoorC) / (weather.warmOutdoorC - weather.coldOutdoorC)));
  const targetC = Math.min(profile.maximumSupplyC, (1 - factor) * weather.coldSupplyC + factor * weather.warmSupplyC);
  const requested = input.manual || input.demand;
  const reason: SourceOutput['reason'] = !requested ? 'no-demand' : !input.permitted ? 'blocked' :
    !input.powered || !input.available ? 'unavailable' :
      input.flowM3s < minFlow || input.flowM3s <= 0 ? 'minimum-flow' : input.supplyC >= targetC ? 'at-target' : 'heating';
  return { ok: true, value: {
    requested, powered: input.powered, available: input.available, permitted: input.permitted, targetC,
    powerW: reason === 'heating' ? Math.min(profile.ratedPowerW, input.requestedPowerW) : 0, reason,
  }, diagnostics: [] };
}
