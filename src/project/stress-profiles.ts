import type { ComponentType, HydronicPort } from './types';

const port = (id: string): HydronicPort => ({ id, domain: 'hydronic', medium: 'heating',
  connector: { family: 'tube', diameterMm: 16, mate: 'socket' } });
const lanes = (count: number, prefix: string) => Array.from({ length: count }, (_, i) => port(prefix + i));
const shape = (id: string, ports: HydronicPort[], junction: (port: string) => string): ComponentType => ({
  id, category: 'equipment', ports, defaultParameters: {},
  hydraulics: { portNodes: Object.fromEntries(ports.map(({ id }) => [id, junction(id)])), channels: [] },
});

/** Hidden teaching geometry for the official 12-room load fixture; never a catalog product. */
export const stressTypes = [
  shape('benchmark-bank-2', [port('main'), ...lanes(2, 'lane-')], () => 'header'),
  shape('benchmark-bank-8', [port('main'), ...lanes(8, 'lane-')], () => 'header'),
  shape('benchmark-manifold-8', [port('feed'), port('return'), ...lanes(8, 'supply-'), ...lanes(8, 'return-')],
    (id) => id.startsWith('return') ? 'return' : 'supply'),
];
