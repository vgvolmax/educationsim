import type { ControlDevice, ControlState, ControlWire } from './controls';
import type { FaultCommand, FaultState } from './faults';
import type { FluidThermalInput, FluidThermalState } from './heat-transfer';
import type { HydraulicInputs, HydraulicSnapshot } from './hydraulics';
import type { BuildingInput, BuildingState } from './room';
import type { PressureInput, advancePressure } from './pressure';
import type { ServiceExchange } from './storage-tank';
import type { SourceProfile, regulateSource } from './sources';
import type { CompiledSystem } from './types';

type SensorBinding = { sampleId: string; kind: 'fluid' | 'room' | 'floor-surface'; id: string };
type EngineSource = { componentId: string; channelId: string; waterCellId: string; actuatorIds: readonly string[]; profile: SourceProfile };
export type EnginePressureProfile = { domainId: string;
  profile: Omit<PressureInput, 'seconds' | 'priorNetVolumeM3' | 'admittedVolumeM3' | 'meanC' | 'densityKgM3' | 'cpJkgK'> };
export type EnginePressureState = Extract<ReturnType<typeof advancePressure>, { ok: true }>['value'];
export type SimulationScenario = {
  system: CompiledSystem; hydraulic: HydraulicInputs;
  fluid: Pick<FluidThermalInput, 'storage' | 'sinks'> & FluidThermalInput['state'];
  control: {
    devices: readonly ControlDevice[]; wires: readonly ControlWire[]; bindings: readonly SensorBinding[];
    zoneChannels?: Readonly<Record<string, readonly string[]>>;
  };
  building?: Omit<BuildingInput, 'seconds' | 'fluidProfiles' | 'state'> & Pick<BuildingInput['state'], 'roomsC'> & {
    floorTemperatures: BuildingInput['state']['floors'];
  };
  sources: readonly EngineSource[];
  pressure?: readonly EnginePressureProfile[];
  teachingBoundary?: { sampleCellId: string; maximumC: number };
  serviceCapacityM3ByCell?: Readonly<Record<string, number>>;
  outdoorC: number;
};
export type SimulationCommand =
  | { kind: 'set-valve'; channelId: string; opening: number }
  | { kind: 'manual'; actuatorId: string; demand: boolean }
  | { kind: 'power'; powered: boolean }
  | { kind: 'fault'; command: FaultCommand }
  | { kind: 'reset-limit'; limiterId: string }
  | ({ kind: 'service' } & ServiceExchange);
type SuccessfulSource = Extract<ReturnType<typeof regulateSource>, { ok: true }>['value'];
export type SimulationState = {
  projectId: string; projectRevision: number; tick: number; powered: boolean;
  manual: Readonly<Record<string, boolean>>; valveOpenings: Readonly<Record<string, number>>; faults: FaultState; control: ControlState | null;
  fluid: Pick<FluidThermalState, 'cells' | 'fluidProfileByCell'>; hydraulics: HydraulicSnapshot | null;
  building: BuildingState | null; sources: Record<string, SuccessfulSource>;
  energy: FluidThermalState['energy'] | null;
  health: 'normal' | 'restricted' | 'stopped'; pressure: Record<string, EnginePressureState>; pressureReliefJ: number;
};
