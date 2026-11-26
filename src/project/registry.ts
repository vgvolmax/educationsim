import type { ComponentType, ControlPort, HydronicPort } from './types';

export type ComponentRegistry = ReadonlyMap<string, ComponentType>;

const tube = (id: string, diameterMm: number, mate: 'tube' | 'socket'): HydronicPort =>
  ({ id, domain: 'hydronic', medium: 'heating', connector: { family: 'tube', diameterMm, mate } });
const signal = (id: string, direction: ControlPort['direction'], value: ControlPort['signal']): ControlPort =>
  ({ id, domain: 'control', direction, signal: value });

const commonManifold = [tube('feed', 16, 'socket'), tube('return', 16, 'socket'), tube('supply-1', 16, 'socket'), tube('return-1', 16, 'socket')];
const trainingTypes: readonly ComponentType[] = [
  { id: 'training-heat-source', category: 'equipment', ports: [tube('supply', 16, 'tube'), tube('return', 16, 'tube')], defaultParameters: { supplyC: 40 } },
  { id: 'training-manifold-one-way', category: 'equipment', ports: commonManifold, defaultParameters: {} },
  { id: 'training-manifold-two-way', category: 'equipment', ports: [...commonManifold, tube('supply-2', 16, 'socket'), tube('return-2', 16, 'socket')], defaultParameters: {} },
  { id: 'training-pipe-20', category: 'equipment', ports: [tube('in', 20, 'tube'), tube('out', 20, 'tube')], defaultParameters: {} },
  { id: 'training-adapter-16-20', category: 'adapter', ports: [tube('side-16', 16, 'socket'), tube('side-20', 20, 'socket')], defaultParameters: {} },
  { id: 'training-thermostat', category: 'equipment', ports: [signal('demand', 'output', 'demand')], defaultParameters: {} },
  { id: 'training-zone-actuator', category: 'equipment', ports: [signal('demand', 'input', 'demand')], defaultParameters: {} },
  { id: 'training-temperature-sensor', category: 'equipment', ports: [signal('temperature', 'output', 'temperature')], defaultParameters: {} },
];

/** Training connection profiles only; no implication of real SKU fit or availability. */
export const trainingRegistry: ComponentRegistry = new Map(trainingTypes.map((type) => [type.id, type]));
