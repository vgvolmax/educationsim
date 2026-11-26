import type { Diagnostic, Result } from '../project/types';
import { finiteTemperature } from './mixing';

export type PressureInput = {
  seconds: number; priorNetVolumeM3: number; admittedVolumeM3: number;
  referenceLiquidM3: number; referenceC: number; meanC: number; expansionPerK: number;
  atmosphericPa: number; referenceGaugePa: number; densityKgM3: number; cpJkgK: number;
  tank?: { gasAtReferenceM3: number; minimumGasM3: number; maximumGasM3: number };
  relief?: { opensGaugePa: number; ratedMaxM3s?: number };
};
type Relief = { triggered: boolean; dischargedM3: number | null; dischargedKg: number | null; dischargedJ: number | null };
type PressureResult = {
  status: 'normal' | 'restricted' | 'stopped';
  absolutePa: number | null; gaugePa: number | null; gasVolumeM3: number | null;
  netServiceVolumeM3: number; thermalExpansionM3: number; relief: Relief;
};
const positive = (x: number): boolean => Number.isFinite(x) && x > 0;
const nonnegative = (x: number): boolean => Number.isFinite(x) && x >= 0;
const issue = (code: string, message: string, severity: Diagnostic['severity'] = 'warning'): Diagnostic =>
  ({ code, path: 'pressure', message, severity });
const invalid = (): Result<PressureResult> => ({ ok: false,
  diagnostics: [issue('invalid_pressure_profile', 'Некорректный профиль давления или теплоносителя.', 'error')] });

export function advancePressure(input: PressureInput): Result<PressureResult> {
  const { tank, relief, atmosphericPa } = input;
  const p0 = atmosphericPa + input.referenceGaugePa;
  if (!positive(input.seconds) || input.seconds > 120 || !positive(atmosphericPa) || !positive(p0) ||
      !positive(input.referenceLiquidM3) || !nonnegative(input.expansionPerK) ||
      !positive(input.densityKgM3) || !positive(input.cpJkgK) || !finiteTemperature(input.referenceC) || !finiteTemperature(input.meanC) ||
      ![input.priorNetVolumeM3, input.admittedVolumeM3].every(Number.isFinite)) return invalid();
  if (tank && (!positive(tank.minimumGasM3) || !positive(tank.maximumGasM3) || !positive(tank.gasAtReferenceM3) ||
      tank.minimumGasM3 > tank.gasAtReferenceM3 || tank.gasAtReferenceM3 > tank.maximumGasM3)) return invalid();
  if (relief && (!nonnegative(relief.opensGaugePa) ||
      (relief.ratedMaxM3s !== undefined && !positive(relief.ratedMaxM3s)))) return invalid();

  let netServiceVolumeM3 = input.priorNetVolumeM3 + input.admittedVolumeM3;
  const thermalExpansionM3 = input.referenceLiquidM3 * input.expansionPerK * (input.meanC - input.referenceC);
  let volumeDelta = netServiceVolumeM3 + thermalExpansionM3;
  if (![netServiceVolumeM3, thermalExpansionM3, volumeDelta].every(Number.isFinite)) return invalid();
  let discharge: Relief = { triggered: false, dischargedM3: 0, dischargedKg: 0, dischargedJ: 0 };
  const warnings: Diagnostic[] = [];
  const result = (status: PressureResult['status'], absolutePa: number | null, gasVolumeM3: number | null): Result<PressureResult> =>
    ({ ok: true, value: { status, absolutePa, gaugePa: absolutePa === null ? null : absolutePa - atmosphericPa,
      gasVolumeM3, netServiceVolumeM3, thermalExpansionM3, relief: discharge }, diagnostics: warnings });
  const stop = (code: string, message: string): Result<PressureResult> => {
    warnings.push(issue(code, message));
    return result('stopped', null, null);
  };

  if (input.referenceLiquidM3 + netServiceVolumeM3 <= 0) return stop('empty_pressure_domain', 'Контур опорожнён; расчёт давления недоступен.');
  if (!tank) {
    if (Math.abs(volumeDelta) > 1e-12) return stop('pressure_capacity_unknown', 'Изменение объёма без известной податливости: численного давления нет.');
    if (relief && input.referenceGaugePa > relief.opensGaugePa) {
      discharge = { triggered: true, dischargedM3: null, dischargedKg: null, dischargedJ: null };
      warnings.push(issue('relief_unquantified', 'Порог сброса достигнут, но объём жидкости без данных о податливости не рассчитывается.'));
      return result('restricted', p0, null);
    }
    return result('normal', p0, null);
  }
  let gas = tank.gasAtReferenceM3 - volumeDelta;
  const validGas = (volume: number): boolean =>
    Number.isFinite(volume) && volume >= tank.minimumGasM3 && volume <= tank.maximumGasM3;
  const threshold = relief ? atmosphericPa + relief.opensGaugePa : Infinity;
  const supported = validGas(gas);
  if (!supported) {
    if (relief && gas < tank.minimumGasM3 && p0 * (tank.gasAtReferenceM3 / tank.minimumGasM3) >= threshold) {
      discharge = { triggered: true, dischargedM3: null, dischargedKg: null, dischargedJ: null };
    }
    return stop('gas_volume_boundary', 'Газовая полость вышла за известные пределы; численное давление скрыто.');
  }

  const pressure = p0 * (tank.gasAtReferenceM3 / gas);
  if (!positive(pressure)) return invalid();
  if (!relief || pressure <= threshold + 1e-8) return result('normal', pressure, gas);

  if (relief.ratedMaxM3s === undefined) {
    discharge = { triggered: true, dischargedM3: null, dischargedKg: null, dischargedJ: null };
    warnings.push(issue('relief_unquantified', 'Порог сброса достигнут, но без характеристики клапана объём не определён.'));
    return result('restricted', pressure, gas);
  }
  const goalGas = tank.gasAtReferenceM3 * (p0 / threshold);
  const wanted = Math.max(0, goalGas - gas);
  const dischargedM3 = Math.min(input.seconds * relief.ratedMaxM3s, wanted,
    tank.maximumGasM3 - gas, input.referenceLiquidM3 + netServiceVolumeM3);
  const dischargedKg = dischargedM3 * input.densityKgM3, dischargedJ = dischargedKg * input.cpJkgK * input.meanC;
  if (![dischargedM3, dischargedKg, dischargedJ].every(Number.isFinite)) return invalid();
  discharge = { triggered: true, dischargedM3, dischargedKg, dischargedJ };
  netServiceVolumeM3 -= dischargedM3; volumeDelta -= dischargedM3;
  gas = tank.gasAtReferenceM3 - volumeDelta;
  if (input.referenceLiquidM3 + netServiceVolumeM3 <= 1e-12) return stop('empty_pressure_domain', 'После сброса в модели нет жидкости.');
  if (!validGas(gas)) return stop('gas_volume_boundary', 'После сброса газовая полость вышла за известные пределы.');
  const after = p0 * (tank.gasAtReferenceM3 / gas);
  if (!positive(after)) return invalid();
  warnings.push(issue(after > threshold + 1e-8 ? 'relief_flow_limited' : 'relief_active',
    after > threshold + 1e-8 ? 'Сброс ограничен заданным расходом; давление ещё выше порога.' : 'Сработал ограниченный учебный сброс жидкости.'));
  return result('restricted', after, gas);
}
