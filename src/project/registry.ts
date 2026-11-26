import type { ComponentHydraulics, ComponentType, ControlPort, HydronicPort } from './types';

export type ComponentRegistry = ReadonlyMap<string, ComponentType>;

const tube = (id: string, diameterMm: number, mate: 'tube' | 'socket'): HydronicPort =>
  ({ id, domain: 'hydronic', medium: 'heating', connector: { family: 'tube', diameterMm, mate } });
const signal = (id: string, direction: ControlPort['direction'], value: ControlPort['signal']): ControlPort =>
  ({ id, domain: 'control', direction, signal: value });

const commonManifold = [tube('feed', 16, 'socket'), tube('return', 16, 'socket'), tube('supply-1', 16, 'socket'), tube('return-1', 16, 'socket')];
const manifoldModel = (ways: 1 | 2): ComponentHydraulics => ({
  portNodes: Object.fromEntries(commonManifold.concat(ways === 2 ? [tube('supply-2', 16, 'socket'), tube('return-2', 16, 'socket')] : [])
    .map((port) => [port.id, port.id === 'feed' || port.id.startsWith('supply') ? 'supply' : 'return'])),
  channels: [],
});
const passage = (left: string, right: string): ComponentHydraulics => ({
  portNodes: { [left]: 'in', [right]: 'out' },
  channels: [{ id: 'passage', from: 'in', to: 'out', kind: 'passive' }],
});

const trainingTypes: readonly ComponentType[] = [
  {
    id: 'training-heat-source', category: 'equipment',
    ports: [tube('supply', 16, 'tube'), tube('return', 16, 'tube')], defaultParameters: { supplyC: 40 },
    hydraulics: {
      portNodes: { supply: 'supply', return: 'return' },
      channels: [{ id: 'source', from: 'return', to: 'supply', kind: 'source' }],
      pressureReference: 'return',
      fluids: [{ node: 'return', selection: 'project-default' }],
    },
  },
  { id: 'training-manifold-one-way', category: 'equipment', ports: commonManifold, defaultParameters: {}, hydraulics: manifoldModel(1) },
  { id: 'training-manifold-two-way', category: 'equipment', ports: [...commonManifold, tube('supply-2', 16, 'socket'), tube('return-2', 16, 'socket')], defaultParameters: {}, hydraulics: manifoldModel(2) },
  { id: 'training-pipe-20', category: 'equipment', ports: [tube('in', 20, 'tube'), tube('out', 20, 'tube')], defaultParameters: {}, hydraulics: passage('in', 'out') },
  { id: 'training-adapter-16-20', category: 'adapter', ports: [tube('side-16', 16, 'socket'), tube('side-20', 20, 'socket')], defaultParameters: {}, hydraulics: passage('side-16', 'side-20') },
  {
    id: 'training-circulator', category: 'equipment',
    ports: [tube('in', 16, 'tube'), tube('out', 16, 'tube')], defaultParameters: {},
    hydraulics: {
      portNodes: { in: 'in', out: 'out' },
      channels: [{ id: 'pump', from: 'in', to: 'out', kind: 'pump' }],
      pressureReference: 'in',
    },
  },
  {
    id: 'training-heat-exchanger', category: 'equipment',
    ports: ['primary-in', 'primary-out', 'secondary-in', 'secondary-out'].map((id) => tube(id, 16, 'socket')),
    defaultParameters: { uaWPerK: 500 },
    hydraulics: {
      portNodes: { 'primary-in': 'p-in', 'primary-out': 'p-out', 'secondary-in': 's-in', 'secondary-out': 's-out' },
      channels: [
        { id: 'primary', from: 'p-in', to: 'p-out', kind: 'exchanger' },
        { id: 'secondary', from: 's-in', to: 's-out', kind: 'exchanger' },
      ],
      fluids: [
        { node: 'p-in', selection: 'project-default' },
        { node: 's-in', selection: { kindParameter: 'secondaryFluid', concentrationParameter: 'secondaryGlycolMassFraction' } },
      ],
      heatExchange: { primary: 'primary', secondary: 'secondary', uaParameter: 'uaWPerK' },
    },
  },
  { id: 'training-thermostat', category: 'equipment', ports: [signal('demand', 'output', 'demand')], defaultParameters: {} },
  { id: 'training-zone-actuator', category: 'equipment', ports: [signal('demand', 'input', 'demand')], defaultParameters: {} },
  { id: 'training-temperature-sensor', category: 'equipment', ports: [signal('temperature', 'output', 'temperature')], defaultParameters: {} },
];

/** Training connection profiles only; no implication of real SKU fit or availability. */
export const trainingRegistry: ComponentRegistry = new Map(trainingTypes.map((type) => [type.id, type]));
