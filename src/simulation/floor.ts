import { finiteTemperature } from './mixing';
import { nonnegative, positive } from './climate';
import type { HeatBody } from './climate';

export type FloorProfile = {
  kind: 'wet' | 'dry' | 'custom';
  coreCapacityJm2K: number; surfaceCapacityJm2K: number;
  waterToCoreWm2K: number; coreToSurfaceWm2K: number; surfaceToAirWm2K: number; coreToGroundWm2K: number;
};
export type FloorSection = { id: string; roomId: string; waterCellId: string; areaM2: number; surfaceLimitC: number; profile: FloorProfile };
export type FloorTemperatures = { coreC: number; surfaceC: number };
export const trainingFloorProfiles: Readonly<Record<'wet' | 'dry', FloorProfile>> = {
  wet: Object.freeze({ kind: 'wet', coreCapacityJm2K: 90_000, surfaceCapacityJm2K: 12_000,
    waterToCoreWm2K: 10, coreToSurfaceWm2K: 14, surfaceToAirWm2K: 7, coreToGroundWm2K: 1 }),
  dry: Object.freeze({ kind: 'dry', coreCapacityJm2K: 18_000, surfaceCapacityJm2K: 9_000,
    waterToCoreWm2K: 10, coreToSurfaceWm2K: 14, surfaceToAirWm2K: 7, coreToGroundWm2K: 1 }),
};

export function prepareFloor(input: FloorSection, initial: FloorTemperatures | undefined): null | {
  core: HeatBody; surface: HeatBody; waterUA: number; surfaceUA: number; roomUA: number; groundUA: number;
} {
  const p = input.profile, a = input.areaM2;
  if (!initial || !finiteTemperature(initial.coreC) || !finiteTemperature(initial.surfaceC) ||
      !finiteTemperature(input.surfaceLimitC) || !positive(a) ||
      !['wet', 'dry', 'custom'].includes(p.kind) || !positive(p.coreCapacityJm2K * a) || !positive(p.surfaceCapacityJm2K * a) ||
      ![p.waterToCoreWm2K, p.coreToSurfaceWm2K, p.surfaceToAirWm2K, p.coreToGroundWm2K].every((value) => nonnegative(value * a))) return null;
  return {
    core: { c: p.coreCapacityJm2K * a, t: initial.coreC }, surface: { c: p.surfaceCapacityJm2K * a, t: initial.surfaceC },
    waterUA: p.waterToCoreWm2K * a, surfaceUA: p.coreToSurfaceWm2K * a,
    roomUA: p.surfaceToAirWm2K * a, groundUA: p.coreToGroundWm2K * a,
  };
}
