import { flowScale, passiveFlow, pressureScale } from './resistance';
import type { ResistanceLaw } from './resistance';
import type { HydraulicChannel } from './types';

type Orientation = 'forward' | 'reverse';
type ApertureKind = 'shutoff' | 'balance' | 'zone' | 'two-way' | 'three-way';
export type ValveInput =
  | { kind: ApertureKind; opening: number }
  | { kind: 'filter'; loading: number; maxLossMultiplier: number }
  | { kind: 'check'; orientation?: Orientation; crackingPa?: number }
  | { kind: 'bypass'; orientation?: Orientation; opensPa: number; closesPa?: number; previouslyOpen?: boolean }
  | { kind: 'regulator'; orientation?: Orientation; flowM3s: number; minPa: number; maxPa: number };
export type ValveStatus = {
  kind: ValveInput['kind'];
  status: 'closed' | 'open' | 'blocked' | 'regulated' | 'below-range' | 'above-range';
};
export type MixingValveInput = {
  first: string; second: string; position: number;
};
export type ValveLaw = {
  kind: ValveInput['kind'];
  evaluate(delta: number): { q: number; dq: number };
  status(delta: number): ValveStatus;
};
export type ValveProfile =
  | { kind: ValveInput['kind']; mode: 'closed' }
  | { kind: ValveInput['kind']; mode: 'factor'; factor: number }
  | { kind: 'check' | 'bypass'; mode: 'one-way'; sign: number; crack: number }
  | { kind: 'regulator'; mode: 'regulator'; sign: number; target: number; min: number; max: number };

const ratio = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;
const nonnegative = (value: number): boolean => Number.isFinite(value) && value >= 0;
const positive = (value: number): boolean => Number.isFinite(value) && value > 0;

export function validMixingTopology(first: HydraulicChannel, second: HydraulicChannel): boolean {
  if (first.id === second.id || first.domainId !== second.domainId) return false;
  const shared = [first.from, first.to].filter((id) => id === second.from || id === second.to);
  return shared.length === 1;
}

export function parseValve(input: ValveInput): ValveProfile | null {
  const { kind } = input;
  if ('opening' in input) {
    if (!ratio(input.opening)) return null;
    if (input.opening === 0) return { kind, mode: 'closed' };
    const factor = 1 / input.opening ** 2;
    return Number.isFinite(factor) ? { kind, mode: 'factor', factor } : null;
  }
  if (kind === 'filter') {
    const { loading, maxLossMultiplier } = input;
    if (!ratio(loading) || !Number.isFinite(maxLossMultiplier) || maxLossMultiplier < 1) return null;
    return { kind, mode: 'factor', factor: 1 + loading * (maxLossMultiplier - 1) };
  }
  if (input.orientation !== undefined && input.orientation !== 'forward' && input.orientation !== 'reverse') return null;
  const sign = input.orientation === 'reverse' ? -1 : 1;
  if (kind === 'check') {
    const pressure = input.crackingPa ?? 0;
    return nonnegative(pressure) ? { kind, mode: 'one-way', sign, crack: pressure / pressureScale } : null;
  }
  if (kind === 'bypass') {
    const closes = input.closesPa ?? input.opensPa;
    return nonnegative(input.opensPa) && nonnegative(closes) && closes <= input.opensPa &&
      (input.previouslyOpen === undefined || typeof input.previouslyOpen === 'boolean')
      ? { kind, mode: 'one-way', sign, crack: (input.previouslyOpen ? closes : input.opensPa) / pressureScale }
      : null;
  }
  const { minPa, maxPa, flowM3s } = input;
  const min = minPa / pressureScale, max = maxPa / pressureScale, target = flowM3s * flowScale;
  return positive(min) && positive(max) && min < max && positive(target)
    ? { kind: 'regulator', mode: 'regulator', sign, target, min, max }
    : null;
}

export function scaleResistance(law: ResistanceLaw, factor: number): ResistanceLaw | null {
  const linear = law.linear * factor, quadratic = law.quadratic * factor;
  const series = {
    linearPaPerM3s: (law.profile.linearPaPerM3s ?? 0) * factor,
    quadraticPaPerM3s2: (law.profile.quadraticPaPerM3s2 ?? 0) * factor,
  };
  if (![linear, quadratic, series.linearPaPerM3s, series.quadraticPaPerM3s2].every(Number.isFinite)) return null;
  return { linear, quadratic, profile: series };
}

const smallSlope = 1e-8;
export function valveLaw(profile: Exclude<ValveProfile, { mode: 'closed' }>, resistance: ResistanceLaw): ValveLaw {
  const kind = profile.kind;
  if (profile.mode === 'factor') return {
    kind, evaluate: (delta) => passiveFlow(resistance, delta),
    status: () => ({ kind, status: 'open' }),
  };
  if (profile.mode === 'one-way') return {
    kind,
    evaluate(delta) {
      const drive = delta * profile.sign - profile.crack;
      if (drive <= 0) return { q: 0, dq: smallSlope };
      const { q, dq } = passiveFlow(resistance, drive);
      return { q: q * profile.sign, dq };
    },
    status: (delta) => ({ kind, status: delta * profile.sign > profile.crack ? 'open' : 'blocked' }),
  };
  const { min, max, sign, target } = profile;
  // Tiny fixed droop (at most 0.1% of target) keeps the in-range plateau numerically observable.
  const regulatedEdge = target * 1.001;
  return {
    kind,
    evaluate(delta) {
      const d = delta * sign;
      if (d <= 0) return { q: 0, dq: smallSlope };
      if (d < min) return { q: sign * target * Math.sqrt(d / min), dq: target / (2 * Math.sqrt(d * min)) };
      if (d <= max) return { q: sign * target * (1 + .001 * (d - min) / (max - min)), dq: target * .001 / (max - min) };
      return { q: sign * regulatedEdge * Math.sqrt(d / max), dq: regulatedEdge / (2 * Math.sqrt(d * max)) };
    },
    status(delta) {
      const d = delta * sign;
      return { kind, status: d <= 0 ? 'blocked' : d < min ? 'below-range' : d <= max ? 'regulated' : 'above-range' };
    },
  };
}
