import { finiteTemperature } from './mixing';

type Inventory = { massKg: number; temperatureC: number | null };
export type LiquidTransfer = { fillKg: number; fillC: number; drainKg: number };

export function transferLiquid(current: Inventory, cp: number, exchange: LiquidTransfer): null | {
  next: Inventory; makeupJ: number; drainJ: number; residualJ: number;
} {
  const { massKg, temperatureC } = current;
  const { fillKg, fillC, drainKg } = exchange;
  if (!Number.isFinite(cp) || cp <= 0 || ![massKg, fillKg, drainKg].every((x) => Number.isFinite(x) && x >= 0) ||
      drainKg > massKg || !finiteTemperature(fillC) ||
      (massKg > 0 ? temperatureC === null || !finiteTemperature(temperatureC) : temperatureC !== null)) return null;
  const temp = temperatureC ?? 0, remaining = massKg - drainKg, afterMass = remaining + fillKg;
  const makeupJ = fillKg * cp * fillC, drainJ = drainKg * cp * temp;
  const startJ = massKg * cp * temp;
  const afterTemp = afterMass > 0 ? (remaining * temp + fillKg * fillC) / afterMass : null;
  const endJ = afterMass * cp * (afterTemp ?? 0);
  const residualJ = endJ - startJ - makeupJ + drainJ;
  const scale = Math.abs(startJ) + Math.abs(endJ) + Math.abs(makeupJ) + Math.abs(drainJ);
  if (![afterMass, scale, residualJ].every(Number.isFinite) || (afterTemp !== null && !finiteTemperature(afterTemp)) ||
      Math.abs(residualJ) > Math.max(1e-7, scale * 1e-10)) return null;
  return { next: { massKg: afterMass, temperatureC: afterTemp }, makeupJ, drainJ, residualJ };
}
