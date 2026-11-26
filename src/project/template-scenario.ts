import { trainingCompositeHydraulics } from './component-types/composite-hydraulics';
import { trainingFloorProfiles } from '../simulation/floor';
import type { SimulationScenario } from '../simulation/engine-types';
import type { CompiledSystem } from '../simulation/types';
import type { ProjectDocument, Result } from './types';
import type { TemplateId } from './templates';

export function assembleTemplateScenario(id: TemplateId, doc: ProjectDocument, system: CompiledSystem): Result<SimulationScenario> {
  const composite = trainingCompositeHydraulics(system);
  if (!composite.ok) return composite;
  const resistance = { ...composite.value.resistance };
  const pumps = { ...composite.value.pumps };
  const fixedDarcyFactors: Record<string, number> = {};
  const cells: Record<string, SimulationScenario['fluid']['cells'][string]> = {};
  const fluids = new Map(system.hydraulicDomains.map((d) => [d.id, d.fluid]));
  const sourceChannel = 'component:source:source';
  const storageKind = id === 'heat-pump-buffer' ? 'buffer' : id === 'two-floors-separator' ? 'hydraulic-separator' : null;
  const storageChannel = 'component:storage:internal-mixing';
  const storage: NonNullable<SimulationScenario['fluid']['storage']> = storageKind
    ? [{ id: 'storage-cell', kind: storageKind, channelIds: [storageChannel] }] : [];
  for (const channel of system.hydraulicChannels) {
    if (channel.kind === 'pipe') fixedDarcyFactors[channel.id] = .035;
    else resistance[channel.id] ??= { linearPaPerM3s: channel.id === storageChannel ? 3e6 : 4e7 };
    if (channel.kind === 'source') pumps[channel.id] = { mode: 'fixed-speed',
      points: [{ flowM3s: 0, headPa: 28_000 }, { flowM3s: id === 'floor-and-radiators' ? .0002 : .00013, headPa: 0 }] };
    const fluid = fluids.get(channel.domainId)!;
    const massKg = channel.id === storageChannel ? (storageKind === 'buffer' ? 120 : 12)
      : channel.kind === 'pipe' ? Math.max(.2, fluid.densityKgM3 * Math.PI * channel.diameterM ** 2 * channel.lengthM / 4) : 2;
    cells[channel.id === storageChannel ? 'storage-cell' : channel.id] = { massKg,
      temperatureC: id === 'water-glycol-exchanger' && fluid.kind === 'water' ? 30 : system.initialWaterC };
  }
  const control = templateControl(id, sourceChannel, doc.rooms[0]!.id);
  const roomAreas = new Map(doc.rooms.map(({ id, outline }) => [id, Math.abs(outline.reduce((sum, p, i) => {
    const q = outline[(i + 1) % outline.length]!;
    return sum + p.x * q.z - q.x * p.z;
  }, 0)) / 2]));
  const floorCounts = new Map<string, number>();
  for (const route of doc.loopRoutes) floorCounts.set(route.roomId, (floorCounts.get(route.roomId) ?? 0) + 1);
  const floors = doc.loopRoutes.map((route) => ({ id: route.id, roomId: route.roomId, waterCellId: 'link:' + route.linkId,
    areaM2: roomAreas.get(route.roomId)! / floorCounts.get(route.roomId)!,
    surfaceLimitC: doc.rooms.find((r) => r.id === route.roomId)!.surfaceLimitC, profile: trainingFloorProfiles.wet }));
  const building: SimulationScenario['building'] = {
    climate: { ...doc.environment, airVolumetricCapacityJm3K: 1200 },
    rooms: doc.rooms.map((room) => ({ id: room.id, airCapacityJK: room.airCapacityJPerK,
      envelopeWPerK: room.wallLossWPerK, ventilationM3s: .01, airTargetC: room.airSetpointC })),
    floors, floorTemperatures: Object.fromEntries(floors.map((floor) => [floor.id, { surfaceC: 20, coreC: 20 }])),
    roomsC: { ...doc.initialConditions.airCByRoomId },
    ...(id === 'floor-and-radiators' && { radiators: [{ roomId: 'room-a', waterCellId: 'component:radiator:passive', uaWPerK: 85 }] }),
  };
  return { ok: true, diagnostics: [], value: {
    system, hydraulic: { ...composite.value, resistance, pumps, fixedDarcyFactors },
    fluid: { cells, storage }, control, outdoorC: doc.environment.outdoorC,
    building,
    sources: [{ componentId: 'source', channelId: sourceChannel, waterCellId: sourceChannel, actuatorIds: ['heat-drive'],
      profile: { kind: id === 'heat-pump-buffer' ? 'heat-pump' : 'boiler',
        ratedPowerW: 6000, maximumSupplyC: id === 'heat-pump-buffer' ? 45 : 60,
        ...(id === 'heat-pump-buffer' && { minimumFlowM3s: .00005 }),
        weather: { coldOutdoorC: -20, coldSupplyC: 55, warmOutdoorC: 15, warmSupplyC: 32 } } }],
  } };
}

function templateControl(id: TemplateId, sourceChannel: string, roomId: string): SimulationScenario['control'] {
  const devices: SimulationScenario['control']['devices'][number][] = [
    { id: 'room-sensor', kind: 'sensor', sampleId: 'room', measurement: 'air', maxAgeTicks: 1 },
    { id: 'thermostat', kind: 'thermostat', targetC: 22, hysteresisC: 1 },
    { id: 'supply-sensor', kind: 'sensor', sampleId: 'supply', measurement: 'supply', maxAgeTicks: 1 },
    { id: 'supply-limit', kind: 'high-limit', limitC: 62, hysteresisC: 4, latching: true },
    { id: 'heat-drive', kind: 'actuator', normally: 'NC', travelSeconds: 3, wantsLimiter: true },
  ];
  const wires: SimulationScenario['control']['wires'][number][] = [
    { id: 'room-input', from: 'room-sensor', to: 'thermostat', port: 'temperature' },
    { id: 'heat-request', from: 'thermostat', to: 'heat-drive', port: 'demand' },
    { id: 'supply-input', from: 'supply-sensor', to: 'supply-limit', port: 'temperature' },
    { id: 'supply-interlock', from: 'supply-limit', to: 'heat-drive', port: 'permit' },
  ];
  const bindings: SimulationScenario['control']['bindings'][number][] = [
    { sampleId: 'room', kind: 'room', id: roomId }, { sampleId: 'supply', kind: 'fluid', id: sourceChannel },
  ];
  if (id !== 'rtl-loop') return { devices, wires, bindings };
  devices.push({ id: 'return-sensor', kind: 'sensor', sampleId: 'return', measurement: 'return', maxAgeTicks: 1 },
    { id: 'rtl-limit', kind: 'rtl', limitC: 35, hysteresisC: 2, latching: false },
    { id: 'rtl-drive', kind: 'actuator', normally: 'NO', travelSeconds: 3, wantsLimiter: true });
  wires.push({ id: 'return-input', from: 'return-sensor', to: 'rtl-limit', port: 'temperature' },
    { id: 'rtl-permit', from: 'rtl-limit', to: 'rtl-drive', port: 'permit' },
    { id: 'rtl-demand', from: 'thermostat', to: 'rtl-drive', port: 'demand' });
  bindings.push({ sampleId: 'return', kind: 'fluid', id: 'component:rtl:passive' });
  return { devices, wires, bindings, zoneChannels: { 'rtl-drive': ['component:rtl:passive'] } };
}
