import type { ComponentInstance, ControlLink, InternalHydraulicChannel, PortEndpoint, ProjectDocument } from '../project/types';
import type { FluidProfile } from './fluids';

export type ChannelOrigin = {
  componentId?: string;
  linkId?: string;
  loopRouteId?: string;
  roomId?: string;
};
export type HydraulicNode = {
  id: string;
  componentId: string;
  elevationM: number;
  ports: PortEndpoint[];
};
type ChannelBase = {
  id: string;
  from: string;
  to: string;
  domainId: string;
  enabled: boolean;
  origin: ChannelOrigin;
};
export type PipeChannel = ChannelBase & {
  kind: 'pipe';
  lengthM: number;
  diameterM: number;
  localLossCoefficient: number;
  lengthSource: 'loop-route' | 'link-route' | 'component-position';
};
export type HydraulicChannel = PipeChannel | (ChannelBase & {
  kind: InternalHydraulicChannel['kind'];
});
export type HydraulicDomain = {
  id: string;
  nodeIds: string[];
  channelIds: string[];
  activity: 'driven' | 'passive' | 'inactive';
  flowConstraint: 'solve' | 'zero';
  referenceNodeId: string;
  pressureAtReferencePa: number;
  fluid: FluidProfile;
};
export type ThermalLink =
  | { kind: 'floor-loop'; channelId: string; roomId: string; loopRouteId: string }
  | { kind: 'heat-exchanger'; componentId: string; primaryChannelId: string; secondaryChannelId: string; uaWPerK: number };
export type CompiledComponent = Pick<ComponentInstance, 'id' | 'typeId' | 'catalogSnapshotId' | 'roomId'> & {
  enabled: boolean;
  parameters: ComponentInstance['parameters'];
};
export type CompiledSystem = {
  projectId: string;
  projectRevision: number;
  initialWaterC: number;
  components: CompiledComponent[];
  nodes: HydraulicNode[];
  hydraulicChannels: HydraulicChannel[];
  hydraulicDomains: HydraulicDomain[];
  thermalLinks: ThermalLink[];
  thermalRooms: ProjectDocument['rooms'];
  controlLinks: ControlLink[];
};
