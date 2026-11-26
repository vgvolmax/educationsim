import room from './projects/direct-small.json';
import { compileProject } from '../../src/simulation/compile';
import { parseProject } from '../../src/project/document';
import { trainingRegistry } from '../../src/project/registry';
import type { SimulationScenario } from '../../src/simulation/engine';
export function scenario(): SimulationScenario {
  const p = parseProject(room);
  if (!p.ok) throw new Error('Bad project fixture');
  const result = compileProject(p.value, trainingRegistry);
  if (!result.ok) throw new Error('Bad compiled fixture');
  const s = result.value;
  const sourceChannelId = 'component:source:source';
  const target = { componentId: 'source', channelId: sourceChannelId, waterCellId: sourceChannelId, actuatorIds: ['drive'],
    profile: { kind: 'boiler' as const, ratedPowerW: 6000, maximumSupplyC: 60,
      weather: { coldOutdoorC: -20, coldSupplyC: 60, warmOutdoorC: 15, warmSupplyC: 35 } },
  };
  return {
    system: s,
    hydraulic: { resistance: { [sourceChannelId]: { linearPaPerM3s: 1000 } },
      fixedDarcyFactors: Object.fromEntries(s.hydraulicChannels.filter((x) => x.kind === 'pipe').map(({ id }) => [id, .035])),
      pumps: { [sourceChannelId]: { mode: 'fixed-speed', points: [{ flowM3s: 0, headPa: 30000 }, { flowM3s: .0001, headPa: 0 }] } } },
    fluid: { cells: Object.fromEntries(s.hydraulicChannels.map(({ id }) => [id, { massKg: 1, temperatureC: 20 }])) },
    control: {
      devices: [
        { id: 'probe', kind: 'sensor', sampleId: 'supply', measurement: 'supply', maxAgeTicks: 1 },
        { id: 'limit', kind: 'high-limit', limitC: 50, hysteresisC: 3, latching: true },
        { id: 'drive', kind: 'actuator', normally: 'NC', travelSeconds: 2, wantsLimiter: true },
      ],
      wires: [{ id: 't', from: 'probe', to: 'limit', port: 'temperature' }, { id: 'p', from: 'limit', to: 'drive', port: 'permit' }],
      bindings: [{ sampleId: 'supply', kind: 'fluid', id: sourceChannelId }],
    },
    sources: [target], outdoorC: 0,
  };
}
