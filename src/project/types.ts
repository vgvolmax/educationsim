import type { z } from 'zod';
import type { projectSchema } from './schema';

export type ProjectDocument = z.infer<typeof projectSchema>;
export type Room = ProjectDocument['rooms'][number];
export type ComponentInstance = ProjectDocument['components'][number];
export type HydronicLink = ProjectDocument['hydronicLinks'][number];
export type ControlLink = ProjectDocument['controlLinks'][number];
export type LoopRoute = ProjectDocument['loopRoutes'][number];
export type CatalogParameterSnapshot = ProjectDocument['appliedCatalogSnapshots'][number];
export type Point3 = ComponentInstance['position'];
export type Point2 = Room['outline'][number];

export type Diagnostic = {
  code: string;
  severity: 'error' | 'warning';
  path: string;
  message: string;
};
export type Result<T> =
  | { ok: true; value: T; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: [Diagnostic, ...Diagnostic[]] };
