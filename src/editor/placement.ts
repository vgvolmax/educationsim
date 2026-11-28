import type { CatalogParameterSnapshot } from '../project/types';

export type Placement = { typeId: string; quarterTurns: number; movingId?: string; snapshot?: CatalogParameterSnapshot };

export function snapToGrid(value: number): number {
  return Math.round(value * 4) / 4;
}
