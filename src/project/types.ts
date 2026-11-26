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
  componentId?: string;
  portId?: string;
};
export type Result<T> =
  | { ok: true; value: T; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: [Diagnostic, ...Diagnostic[]] };

export type PortEndpoint = HydronicLink['from'];
export type HydronicConnector =
  | { family: 'tube'; diameterMm: number; mate: 'tube' | 'socket' }
  | { family: 'thread'; profile: 'G' | 'R'; size: string; mate: 'male' | 'female' };
export type HydronicPort = { id: string; domain: 'hydronic'; medium: 'heating' | 'potable'; connector: HydronicConnector };
export type ControlPort = { id: string; domain: 'control'; direction: 'input' | 'output'; signal: 'demand' | 'temperature' | 'relay' | 'actuator' };
export type PortDefinition = HydronicPort | ControlPort;
export type ComponentType = {
  id: string;
  ports: readonly PortDefinition[];
  category: 'equipment' | 'adapter';
  defaultParameters: ComponentInstance['parameters'];
};

type NamedCommand = { commandId: string };
export type ProjectEdit = NamedCommand & (
  | { kind: 'rename_project'; title: string }
  | { kind: 'add_component'; component: ComponentInstance }
  | { kind: 'remove_component'; componentId: string }
  | { kind: 'connect_hydronic'; link: HydronicLink }
  | { kind: 'connect_control'; link: ControlLink }
  | { kind: 'disconnect'; domain: 'hydronic' | 'control'; linkId: string }
);
export type ReplaceComponentCommand = NamedCommand & {
  kind: 'replace_component'; componentId: string; typeId: string; expectedRevision: number;
};
export type ProjectCommand = ProjectEdit | ReplaceComponentCommand |
  (NamedCommand & { kind: 'batch'; edits: readonly ProjectEdit[] });
