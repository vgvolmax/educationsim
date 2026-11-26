import type { Result } from '../project/types';
import { transferLiquid } from './liquid-inventory';
import type { LiquidTransfer } from './liquid-inventory';

type ServiceState = { capacityM3: number; liquidKg: number; temperatureC: number | null };
type ServiceFluid = { densityKgM3: number; cpJkgK: number };
type ServiceResult = {
  state: ServiceState; unfilledM3: number;
  ledger: { inKg: number; outKg: number; inJ: number; outJ: number; residualKg: number; residualJ: number; netVolumeM3: number };
};
const fail = (code: string, message: string): Result<ServiceResult> =>
  ({ ok: false, diagnostics: [{ code, path: 'service', message, severity: 'error' }] });

/** Well-mixed teaching inventory. Empty circuit has no numerical liquid temperature. */
export function advanceService(state: ServiceState, fluid: ServiceFluid, transfer: LiquidTransfer): Result<ServiceResult> {
  const { cpJkgK: cp, densityKgM3: density } = fluid;
  const { liquidKg: startKg, temperatureC: startC, capacityM3 } = state;
  const { drainKg, fillKg } = transfer;
  if (![density, capacityM3].every((x) => Number.isFinite(x) && x > 0) || startKg / density > capacityM3) {
    return fail('invalid_service_state', 'Некорректная вместимость системы или профиль жидкости.');
  }
  const result = transferLiquid({ massKg: startKg, temperatureC: startC }, cp, transfer);
  if (!result) return fail('invalid_service_state', 'Некорректное состояние жидкости, заполнение или слив.');
  const { massKg: liquidKg, temperatureC } = result.next;
  if (liquidKg / density > capacityM3) return fail('service_overflow', 'Заполнение превышает вместимость учебной системы.');
  return { ok: true, value: {
    state: { capacityM3, liquidKg, temperatureC }, unfilledM3: Math.max(0, capacityM3 - liquidKg / density),
    ledger: { inKg: fillKg, outKg: drainKg, inJ: result.makeupJ, outJ: result.drainJ, residualKg: liquidKg - startKg - fillKg + drainKg,
      residualJ: result.residualJ, netVolumeM3: (fillKg - drainKg) / density },
  }, diagnostics: [] };
}
