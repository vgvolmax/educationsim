import type { InspectorEdit } from './inspector-edits';
import type { RoomEdit } from './editor-geometry';
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
  hydraulics?: ComponentHydraulics;
};

type NamedCommand = { commandId: string };
export type ProjectEdit = NamedCommand & (
  | RoomEdit
  | InspectorEdit
  | { kind: 'rename_project'; title: string }
  | { kind: 'add_component'; component: ComponentInstance; catalogSnapshot?: CatalogParameterSnapshot }
  | { kind: 'move_component'; componentId: string; position: Point3; quarterTurns: number }
  | { kind: 'remove_component'; componentId: string }
  | { kind: 'connect_hydronic'; link: HydronicLink }
  | { kind: 'connect_control'; link: ControlLink }
  | { kind: 'disconnect'; domain: 'hydronic' | 'control'; linkId: string }
);
export type ReplaceComponentCommand = NamedCommand & {
  kind: 'replace_component'; componentId: string; typeId: string; expectedRevision: number; catalogSnapshot?: CatalogParameterSnapshot;
};
export type ProjectCommand = ProjectEdit | ReplaceComponentCommand |
  (NamedCommand & { kind: 'batch'; edits: readonly ProjectEdit[] });

/** Training/network metadata describes internal junctions, not catalog claims. */
export type ComponentHydraulics = {
  portNodes: Readonly<Record<string, string>>;
  channels: readonly InternalHydraulicChannel[];
  pressureReference?: string;
  fluids?: readonly {
    node: string;
    selection: 'project-default' | { kindParameter: string; concentrationParameter: string };
  }[];
  heatExchange?: { primary: string; secondary: string; uaParameter: string };
};

export type InternalHydraulicChannel = {
  id: string;
  from: string;
  to: string;
  kind: 'source' | 'pump' | 'passive' | 'exchanger';
};
