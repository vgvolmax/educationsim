import type { FluidProfile } from './fluids';
import type { PipeChannel } from './types';

export const flowScale = 60_000; // m³/s → L/min for numerical conditioning only
export const pressureScale = 1_000; // Pa → kPa
export type ResistanceProfile = {
  linearPaPerM3s?: number;
  quadraticPaPerM3s2?: number;
};
export type ResistanceLaw = {
  linear: number;
  quadratic: number;
  profile: ResistanceProfile;
};

export function makeResistance(profile: ResistanceProfile): ResistanceLaw | null {
  const a = profile.linearPaPerM3s ?? 0, b = profile.quadraticPaPerM3s2 ?? 0;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0 || a + b === 0) return null;
  const linear = a / flowScale / pressureScale, quadratic = b / flowScale ** 2 / pressureScale;
  return linear + quadratic > 0 ? { linear, quadratic, profile: { ...profile } } : null;
}

export function pipeResistance(pipe: PipeChannel, fluid: FluidProfile, coefficient: number): ResistanceProfile | null {
  const { diameterM, lengthM, localLossCoefficient } = pipe;
  if (![coefficient, diameterM, lengthM, localLossCoefficient, fluid.densityKgM3].every(Number.isFinite) ||
      coefficient <= 0 || diameterM <= 0 || lengthM <= 0 || localLossCoefficient < 0 || fluid.densityKgM3 <= 0) return null;
  const area = Math.PI * diameterM ** 2 / 4;
  // Darcy-Weisbach and explicit local losses, for a caller-declared fixed Darcy factor.
  const b = fluid.densityKgM3 * (coefficient * lengthM / diameterM + localLossCoefficient) / (2 * area ** 2);
  return Number.isFinite(b) && b > 0 ? { quadraticPaPerM3s2: b } : null;
}

export const drop = (law: ResistanceLaw, q: number): number => (law.linear + law.quadratic * Math.abs(q)) * q;
export const dropDerivative = (law: ResistanceLaw, q: number): number => law.linear + 2 * law.quadratic * Math.abs(q);

export function passiveFlow(law: ResistanceLaw, delta: number): { q: number; dq: number } {
  const value = Math.abs(delta);
  // This version avoids cancellation at low flow when a is large.
  const denominator = law.linear + Math.hypot(law.linear, 2 * Math.sqrt(law.quadratic) * Math.sqrt(value));
  const q = denominator > 0 ? Math.sign(delta) * 2 * (value / denominator) : 0;
  return { q, dq: 1 / Math.max(1e-4, dropDerivative(law, q)) };
}
