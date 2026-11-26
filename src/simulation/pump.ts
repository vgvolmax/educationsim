import { drop, dropDerivative, flowScale, pressureScale } from './resistance';
import type { ResistanceLaw } from './resistance';

type CurvePoint = { flowM3s: number; headPa: number };
export type PumpInput =
  | { mode: 'off'; blockReverse?: boolean }
  | { mode: 'fixed-speed'; points: readonly CurvePoint[]; speedFraction?: number; blockReverse?: boolean }
  | { mode: 'constant-pressure'; points: readonly CurvePoint[]; targetPa: number; blockReverse?: boolean };
type Point = { q: number; p: number };
export type PumpLaw = {
  points: Point[];
  target: number | undefined;
  blockReverse: boolean;
  mode: 'fixed-speed' | 'constant-pressure';
  resistance: ResistanceLaw;
};

const droop = .001; // kPa per L/min for a finite controller slope, not a passport coefficient
const residualTolerance = 1e-4; // kPa
export const flowTolerance = 1e-7; // L/min (numeric convergence, not training accuracy)

export function makePump(input: Exclude<PumpInput, { mode: 'off' }>, resistance: ResistanceLaw): PumpLaw | null {
  if (input.points.length < 2 || input.points.length > 100 || input.points[0]?.flowM3s !== 0) return null;
  const speed = input.mode === 'fixed-speed' ? input.speedFraction ?? 1 : 1;
  if (!Number.isFinite(speed) || speed < .05 || speed > 1) return null;
  let priorQ = -1, priorHead = Infinity;
  const points: Point[] = [];
  for (const p of input.points) {
    if (![p.flowM3s, p.headPa].every(Number.isFinite) || p.flowM3s <= priorQ || p.headPa < 0 || p.headPa >= priorHead) return null;
    const q = p.flowM3s * flowScale * speed, h = p.headPa / pressureScale * speed ** 2;
    if (!Number.isFinite(q) || !Number.isFinite(h)) return null;
    points.push({ q, p: h }); priorQ = p.flowM3s; priorHead = p.headPa;
  }
  const target = input.mode === 'constant-pressure' ? input.targetPa / pressureScale : undefined;
  if (target !== undefined && (!Number.isFinite(target) || target <= 0)) return null;
  return { points, target, resistance, blockReverse: input.blockReverse === true, mode: input.mode };
}

function curve(pump: PumpLaw, q: number): { p: number; slope: number } {
  const at = Math.max(1, pump.points.findIndex((point) => point.q >= q));
  const a = pump.points[at - 1]!, b = pump.points[at]!;
  const slope = (b.p - a.p) / (b.q - a.q);
  return { p: a.p + (q - a.q) * slope, slope };
}

function controller(pump: PumpLaw, q: number): { p: number; slope: number; saturated: boolean } {
  const full = curve(pump, q);
  if (pump.target === undefined) return { ...full, saturated: false };
  const controlSlope = Math.min(droop, pump.target * .01 / pump.points.at(-1)!.q);
  const requested = pump.target - q * controlSlope;
  if (requested > full.p + 1e-9) return { ...full, saturated: true };
  return { p: requested, slope: -controlSlope, saturated: false };
}

export function pumpAtRest(pump: PumpLaw): number {
  return controller(pump, 0).p;
}

function requiredDelta(pump: PumpLaw, q: number): number {
  return drop(pump.resistance, q) - controller(pump, q).p;
}

export function pumpFlow(pump: PumpLaw, delta: number): { q: number; dq: number } {
  const max = pump.points.at(-1)!.q;
  if (delta < requiredDelta(pump, 0)) return { q: 0, dq: 1e-8 };
  if (delta > requiredDelta(pump, max)) return { q: max, dq: 1e-8 };
  let low = 0, high = max;
  for (let i = 0; i < 44; i++) {
    const mid = (low + high) / 2;
    if (requiredDelta(pump, mid) < delta) low = mid;
    else high = mid;
  }
  const q = (low + high) / 2;
  return { q, dq: 1 / Math.max(1e-4, dropDerivative(pump.resistance, q) - controller(pump, q).slope) };
}

export type PumpOperatingPoint = { headPa: number; status: 'fixed-speed' | 'regulated' | 'saturated' | 'shutoff' | 'off' | 'check-closed' };
export function pumpOperatingPoint(pump: PumpLaw, delta: number, q: number): PumpOperatingPoint | 'curve_limit' | 'unsupported_reverse' {
  const max = pump.points.at(-1)!.q;
  if (delta > requiredDelta(pump, max) + residualTolerance) return 'curve_limit';
  if (delta < requiredDelta(pump, 0) - residualTolerance && !pump.blockReverse) return 'unsupported_reverse';
  const point = controller(pump, q);
  if (q <= flowTolerance) {
    return { headPa: point.p * pressureScale, status: delta < requiredDelta(pump, 0) - residualTolerance ? 'check-closed' : 'shutoff' };
  }
  return {
    headPa: point.p * pressureScale,
    status: point.saturated ? 'saturated' : pump.mode === 'constant-pressure' ? 'regulated' : 'fixed-speed',
  };
}
