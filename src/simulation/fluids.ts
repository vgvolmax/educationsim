export type FluidProfile = {
  id: string;
  kind: 'water' | 'propylene-glycol';
  massFraction: number;
  referenceC: 20;
  densityKgM3: number;
  specificHeatJkgK: number;
  dynamicViscosityPaS: number;
  basis: 'training-constant' | 'published-fixed-reference';
  source: string;
};

const water = Object.freeze({
  id: 'training-water-v1', kind: 'water', massFraction: 0, referenceC: 20,
  densityKgM3: 1000, specificHeatJkgK: 4180, dynamicViscosityPaS: .001,
  basis: 'training-constant', source: 'EducationSim design V04, fixed training assumptions',
} satisfies FluidProfile);

const pg = Object.freeze({
  id: 'ashrae-2025-si-pg30-at20-v1', kind: 'propylene-glycol', massFraction: .3, referenceC: 20,
  densityKgM3: 1032.1, specificHeatJkgK: 3960, dynamicViscosityPaS: .003,
  basis: 'published-fixed-reference',
  source: 'ASHRAE Handbook Fundamentals 2025, SI, ch.31 tables 10,11,13; https://handbook.ashrae.org/handbooks/F25/SI/f25_Ch31/f25_Ch31_si.aspx',
} satisfies FluidProfile);

export function resolveFluid(kind: unknown, massFraction?: unknown): FluidProfile | null {
  if (kind === 'water' && (massFraction === undefined || massFraction === 0)) return water;
  if (kind === 'propylene-glycol' && massFraction === pg.massFraction) return pg;
  return null;
}
