import { trainingCompositeHydraulics } from './component-types/composite-hydraulics';
import { equipmentRegistry } from './registry';
import { trainingValveLaws } from './runtime-valves';
import { trainingFloorProfiles } from '../simulation/floor';
import type { SimulationScenario } from '../simulation/engine-types';
import type { CompiledSystem } from '../simulation/types';
import type { ProjectDocument, Result } from './types';
import type { TemplateId } from './templates';

export function assembleTemplateScenario(id: TemplateId | undefined, doc: ProjectDocument, system: CompiledSystem): Result<SimulationScenario> {
  const composite = trainingCompositeHydraulics(system, new Set(doc.appliedCatalogSnapshots.filter((s) =>
    s.basis === 'training' && Object.keys(s.parameters).length === 0).map(({ id }) => id)));
  if (!composite.ok) return composite;
  const resistance = { ...composite.value.resistance };
  const pumps = { ...composite.value.pumps };
  const fixedDarcyFactors: Record<string, number> = {};
  const cells: Record<string, SimulationScenario['fluid']['cells'][string]> = {};
  const fluids = new Map(system.hydraulicDomains.map((d) => [d.id, d.fluid]));
  const components = new Map(system.components.map((c) => [c.id, c]));
  const thermalDevices = system.hydraulicChannels.filter((c) => c.kind === 'source' && c.enabled);
  const storeChannels = new Map<string, { massKg: number; cellId: string }>();
  const storage: NonNullable<SimulationScenario['fluid']['storage']>[number][] = [];
  const variantOf = (componentId: string) => equipmentRegistry.get(components.get(componentId)?.typeId ?? '')?.variant;
  for (const channel of system.hydraulicChannels) {
    const owner = channel.origin.componentId;
    const variant = owner ? variantOf(owner) : undefined;
    if ((variant === 'buffer' || variant === 'hydraulic-separator') && channel.id.endsWith(':internal-mixing')) {
      const cellId = owner === 'storage' ? 'storage-cell' : 'storage:' + owner;
      const massKg = variant === 'buffer' ? 120 : 12;
      storeChannels.set(channel.id, { massKg, cellId });
      storage.push({ id: cellId, kind: variant, channelIds: [channel.id] });
    }
    if (channel.kind === 'pipe') fixedDarcyFactors[channel.id] = .035;
    else resistance[channel.id] ??= { linearPaPerM3s: storeChannels.has(channel.id) ? 3e6 : 4e7 };
    if (channel.kind === 'source') pumps[channel.id] = { mode: 'fixed-speed',
      points: [{ flowM3s: 0, headPa: 28_000 }, { flowM3s: id === 'floor-and-radiators' ? .0002 : .00013, headPa: 0 }] };
    if (channel.kind === 'pump' && !pumps[channel.id]) {
      const params = components.get(owner ?? '')?.parameters;
      const headPa = typeof params?.maxHeadPa === 'number' ? params.maxHeadPa : 30000;
      const flowM3s = typeof params?.maxFlowM3s === 'number' ? params.maxFlowM3s : .0001;
      const points = [{ flowM3s: 0, headPa }, { flowM3s, headPa: 0 }];
      const blockReverse = params?.checkValve === true;
      pumps[channel.id] = params?.mode === 'constant-pressure' ? { mode: 'constant-pressure', points, blockReverse,
        targetPa: typeof params.targetPa === 'number' ? params.targetPa : 18000 } : { mode: 'fixed-speed', points, blockReverse };
    }
    const fluid = fluids.get(channel.domainId)!;
    const store = storeChannels.get(channel.id);
    const massKg = store?.massKg ?? (channel.kind === 'pipe' ?
      Math.max(.2, fluid.densityKgM3 * Math.PI * channel.diameterM ** 2 * channel.lengthM / 4) : 2);
    cells[store?.cellId ?? channel.id] = { massKg,
      temperatureC: id === 'water-glycol-exchanger' && fluid.kind === 'water' ? system.initialWaterC + 10 : system.initialWaterC };
  }
  const rtl = system.hydraulicChannels.find((c) => c.origin.componentId && variantOf(c.origin.componentId) === 'rtl');
  const control = {
    devices: [] as SimulationScenario['control']['devices'][number][],
    wires: [] as SimulationScenario['control']['wires'][number][],
    bindings: [] as SimulationScenario['control']['bindings'][number][],
    zoneChannels: {} as Record<string, readonly string[]>,
  };
  const sources: SimulationScenario['sources'][number][] = [];
  thermalDevices.forEach((channel, index) => {
    const componentId = channel.origin.componentId!;
    const component = components.get(componentId)!;
    const room = doc.rooms.find((r) => r.id === component.roomId) ?? doc.rooms[0];
    const suffix = index ? '-' + index : '';
    const useRtl = index === 0 && !!rtl && !!room;
    const draft = templateControl(useRtl, channel.id, room?.id, room?.airSetpointC ?? 22,
      rtl?.id ?? '', suffix);
    control.devices.push(...draft.devices);
    control.wires.push(...draft.wires);
    control.bindings.push(...draft.bindings);
    Object.assign(control.zoneChannels, draft.zoneChannels);
    const heatPump = variantOf(componentId) === 'heat-pump';
    const params = component.parameters;
    const ratedPowerW = typeof params.powerW === 'number' ? params.powerW : 6000;
    const maximumSupplyC = typeof params.supplyC === 'number' ? params.supplyC : heatPump ? 45 : 60;
    const minimumFlowM3s = typeof params.minimumFlowM3s === 'number' ? params.minimumFlowM3s : heatPump ? .00005 : 0;
    sources.push({ componentId, channelId: channel.id, waterCellId: channel.id, actuatorIds: ['heat-drive' + suffix],
      profile: { kind: heatPump ? 'heat-pump' : 'boiler', ratedPowerW, maximumSupplyC, minimumFlowM3s,
        weather: { coldOutdoorC: -20, coldSupplyC: 55, warmOutdoorC: 15, warmSupplyC: 32 } } });
  });
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
    radiators: system.hydraulicChannels.flatMap((c) => {
      const owner = c.origin.componentId, roomId = owner ? components.get(owner)?.roomId : null;
      return owner && roomId && variantOf(owner) === 'radiator' ? [{ roomId, waterCellId: c.id, uaWPerK: 85 }] : [];
    }),
  };
  return { ok: true, diagnostics: [], value: {
    system, hydraulic: { ...composite.value, resistance, pumps, fixedDarcyFactors,
      valves: { ...trainingValveLaws(doc, system), ...composite.value.valves } },
    fluid: { cells, storage }, control, outdoorC: doc.environment.outdoorC,
    building,
    sources,
  } };
}

function templateControl(withRtl: boolean, sourceChannel: string, roomId: string | undefined, targetC: number,
  rtlChannel: string, suffix: string): SimulationScenario['control'] {
  const devices: SimulationScenario['control']['devices'][number][] = [
    { id: 'room-sensor', kind: 'sensor', sampleId: 'room', measurement: 'air', maxAgeTicks: 1 },
    { id: 'thermostat', kind: 'thermostat', targetC, hysteresisC: 1 },
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
    ...(roomId ? [{ sampleId: 'room', kind: 'room' as const, id: roomId }] : []), { sampleId: 'supply', kind: 'fluid', id: sourceChannel },
  ];
  if (withRtl) {
  devices.push({ id: 'return-sensor', kind: 'sensor', sampleId: 'return', measurement: 'return', maxAgeTicks: 1 },
    { id: 'rtl-limit', kind: 'rtl', limitC: 35, hysteresisC: 2, latching: false },
    { id: 'rtl-drive', kind: 'actuator', normally: 'NO', travelSeconds: 3, wantsLimiter: true });
  wires.push({ id: 'return-input', from: 'return-sensor', to: 'rtl-limit', port: 'temperature' },
    { id: 'rtl-permit', from: 'rtl-limit', to: 'rtl-drive', port: 'permit' },
    { id: 'rtl-demand', from: 'thermostat', to: 'rtl-drive', port: 'demand' });
    bindings.push({ sampleId: 'return', kind: 'fluid', id: rtlChannel });
  }
  return {
    devices: devices.map((d) => ({ ...d, id: d.id + suffix, ...(d.kind === 'sensor' && { sampleId: d.sampleId + suffix }) })),
    wires: wires.map((w) => ({ ...w, id: w.id + suffix, to: w.to + suffix, from: w.from + suffix })),
    bindings: bindings.map((b) => ({ ...b, sampleId: b.sampleId + suffix })),
    ...(withRtl && { zoneChannels: { ['rtl-drive' + suffix]: [rtlChannel] } }),
  };
}
