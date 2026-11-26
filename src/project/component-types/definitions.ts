import type { ComponentHydraulics, ComponentType, ControlPort, HydronicPort, PortDefinition } from '../types';

type Scalar = string | number | boolean;
type NumberParameter = { type: 'number'; titleRu: string; unit: string; min: number; max: number; initial: number };
type BooleanParameter = { type: 'boolean'; titleRu: string; initial: boolean };
type ChoiceParameter = { type: 'choice'; titleRu: string; choices: readonly string[]; initial: string };
type Parameter = NumberParameter | BooleanParameter | ChoiceParameter;
export type Settings = Readonly<Record<string, Parameter>>;
export type EquipmentMode = 'hydronic' | 'control' | 'material' | 'mount';
type Reading = 'flow' | 'pressure' | 'temperature' | 'power' | 'opening' | 'signal' | 'status' | 'installation';
export type EquipmentDefinition = {
  id: string; family: string; variant: string; titleRu: string; mode: EquipmentMode; basis: 'training';
  model: string; settings: Settings; readings: readonly Reading[]; installation: string; component: ComponentType;
};
type Model = Omit<ComponentType, 'id' | 'defaultParameters'>;
type Spec = Omit<EquipmentDefinition, 'id' | 'basis' | 'component' | 'mode'> & { id?: string; shape: Model; mode?: EquipmentMode };

export const n = (titleRu: string, unit: string, min: number, max: number, initial: number): NumberParameter =>
  ({ type: 'number', titleRu, unit, min, max, initial });
export const b = (titleRu: string, initial: boolean): BooleanParameter => ({ type: 'boolean', titleRu, initial });
export const c = (titleRu: string, choices: readonly string[], initial: string): ChoiceParameter =>
  ({ type: 'choice', titleRu, choices, initial });
export function accepts(parameter: Parameter, value: unknown): value is Scalar {
  switch (parameter.type) {
    case 'number': return typeof value === 'number' && Number.isFinite(value) && value >= parameter.min && value <= parameter.max;
    case 'boolean': return typeof value === 'boolean';
    case 'choice': return typeof value === 'string' && parameter.choices.includes(value);
  }
}

export const tube = (id: string, diameterMm = 16, mate: 'tube' | 'socket' = 'socket'): HydronicPort =>
  ({ id, domain: 'hydronic', medium: 'heating', connector: { family: 'tube', diameterMm, mate } });
export const signal = (id: string, direction: ControlPort['direction'], value: ControlPort['signal']): ControlPort =>
  ({ id, domain: 'control', direction, signal: value });
export const hydraulics = (ports: readonly PortDefinition[], model: ComponentHydraulics, category: ComponentType['category'] = 'equipment'): Model =>
  ({ ports, hydraulics: model, category });
export const passive = (kind: 'source' | 'pump' | 'passive' = 'passive', controls: readonly ControlPort[] = []): Model =>
  hydraulics([tube('in'), tube('out'), ...controls], { portNodes: { in: 'in', out: 'out' },
    channels: [{ id: kind, from: 'in', to: 'out', kind }],
    ...(kind === 'source' || kind === 'pump' ? { pressureReference: 'in' } : {}) });
export const terminal = (port = 'in'): Model => hydraulics([tube(port)], { portNodes: { [port]: 'terminal' }, channels: [] });
export const junction = (ids: readonly string[]): Model =>
  hydraulics(ids.map((id) => tube(id)), { portNodes: Object.fromEntries(ids.map((id) => [id, 'junction'])), channels: [] });
export const signals = (...ports: ControlPort[]): Model => ({ ports, category: 'equipment' });
export const material: Model = { ports: [], category: 'equipment' };

export function define(spec: Spec, base?: ComponentType): EquipmentDefinition {
  const { shape, id = `training-${spec.variant}`, mode, ...data } = spec;
  const componentModel = base ? { ...base, ports: [...base.ports, ...shape.ports.filter((port) =>
    port.domain === 'control' && !base.ports.some((existing) => existing.id === port.id))] } : shape;
  const settings = { ...data.settings, ...(componentModel.hydraulics ? { enabled: b('Оборудование включено', true) } : {}) };
  return { ...data, settings, id, basis: 'training',
    mode: mode ?? (componentModel.hydraulics ? 'hydronic' : 'control'),
    component: { ...componentModel, id, defaultParameters: base?.defaultParameters ?? Object.fromEntries(Object.entries(settings).map(([key, v]) => [key, v.initial])) } };
}
export type EquipmentSpec = Spec;
