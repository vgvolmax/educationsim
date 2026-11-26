import type { ProjectDocument, HydronicLink } from '../project/types';
import type { SimulationScenario } from '../simulation/engine-types';
import type { HydraulicInputs } from '../simulation/hydraulics';
import { trainingFloorProfiles } from '../simulation/floor';

export const lessonProfiles = ['paired-cold', 'paired-warm', 'mixed-low', 'mixed-high', 'closed-loops', 'with-bypass', 'tank-absent',
  'tank-relief', 'without-limiter', 'series-slow', 'series-fast', 'separator-slow', 'separator-fast', 'separator-check',
  'heat-pump-direct', 'heat-pump-buffered', 'dry-floor'] as const;
export type LessonProfile = typeof lessonProfiles[number];
const pipeA = 'link:pipe-a', pipeB = 'link:pipe-b';
const linearPipes = (s: SimulationScenario) => Object.fromEntries(s.system.hydraulicChannels
  .filter((channel) => channel.kind === 'pipe').map(({ id }) => [id, { linearPaPerM3s: 6e7 }]));
const source = 'component:source:source', cross = 'component:storage:internal-mixing', pump = 'component:secondary-pump:pump';
const pos = (x: number, z: number) => ({ x, y: 0, z });
const branch = (id: string, a: string, pa: string, b: string, pb: string): HydronicLink => ({ id,
  from: { componentId: a, portId: pa }, to: { componentId: b, portId: pb }, points: [], materialId: 'training-pipe', innerDiameterM: .016 });

function addIndependentLoop(p: ProjectDocument) {
  const copy = structuredClone(p), prefix = (id: string) => 'aux-' + id;
  const offset = <T extends { x: number }>(point: T): T => ({ ...point, x: point.x + 9 });
  p.rooms.push(...copy.rooms.map((r) => ({ ...r, id: prefix(r.id), name: 'Независимая зона', outline: r.outline.map(offset) })));
  p.components.push(...copy.components.map((c) => ({ ...c, id: prefix(c.id), position: offset(c.position), roomId: c.roomId ? prefix(c.roomId) : null })));
  p.hydronicLinks.push(...copy.hydronicLinks.map((l) => ({ ...l, id: prefix(l.id), points: l.points.map(offset),
    from: { ...l.from, componentId: prefix(l.from.componentId) }, to: { ...l.to, componentId: prefix(l.to.componentId) } })));
  p.loopRoutes.push(...copy.loopRoutes.map((r) => ({ ...r, id: prefix(r.id), roomId: prefix(r.roomId),
    linkId: prefix(r.linkId), points: r.points.map(offset) })));
  p.initialConditions.airCByRoomId['aux-room-a'] = 20;
}
export function prepareLessonProject(p: ProjectDocument, profile: LessonProfile | undefined) {
  if (profile === 'paired-cold' || profile === 'paired-warm') {
    addIndependentLoop(p);
    p.initialConditions.airCByRoomId['room-a'] = profile === 'paired-warm' ? 26 : 19;
  } else if (profile === 'mixed-low' || profile === 'mixed-high') {
    const mixer = p.components.find((c) => c.id === 'mixer');
    if (!mixer) throw new Error('Не найден смесительный узел.');
    mixer.parameters.position = profile === 'mixed-low' ? .35 : .8;
  } else if (profile === 'with-bypass') {
    for (const [id, typeId, position] of [
      ['s-tee', 'training-tee', pos(-.45, .1)], ['r-tee', 'training-tee', pos(-.45, .62)], ['bypass', 'training-bypass', pos(-.75, .35)],
    ] as const) p.components.push({ id, typeId, position, roomId: null, level: 0, catalogSnapshotId: null, parameters: {} });
    p.hydronicLinks = p.hydronicLinks.filter((l) => l.id !== 'supply' && l.id !== 'return');
    p.hydronicLinks.push(branch('supply', 'source', 'supply', 's-tee', 'a'), branch('feed', 's-tee', 'b', 'manifold', 'feed'),
      branch('bypass-in', 's-tee', 'c', 'bypass', 'in'), branch('bypass-out', 'bypass', 'out', 'r-tee', 'c'),
      branch('return-loop', 'manifold', 'return', 'r-tee', 'a'), branch('return', 'r-tee', 'b', 'source', 'return'));
  } else if (profile === 'heat-pump-direct') {
    const item = p.components.find((c) => c.id === 'source');
    if (!item) throw new Error('Не найден источник.');
    item.typeId = 'training-heat-pump';
    for (const link of p.hydronicLinks) {
      if (link.from.componentId === 'source' && link.from.portId === 'supply') link.from.portId = 'out';
      if (link.to.componentId === 'source' && link.to.portId === 'return') link.to.portId = 'in';
    }
  }
}

export function prepareLessonScenario(s: SimulationScenario, profile: LessonProfile | undefined): SimulationScenario {
  if (profile === 'paired-cold' || profile === 'paired-warm') {
    const valves = { ...s.hydraulic.valves };
    delete valves[pipeA]; delete valves[pipeB];
    return { ...s, hydraulic: { ...s.hydraulic, valves }, control: {
      ...s.control, devices: [...s.control.devices, { id: 'paired-zone', kind: 'actuator', normally: 'NC', travelSeconds: 1, wantsLimiter: false }],
      wires: [...s.control.wires, { id: 'paired-demand', from: 'thermostat', to: 'paired-zone', port: 'demand' }],
      zoneChannels: { ...s.control.zoneChannels, 'paired-zone': [pipeA, pipeB] },
    } };
  }
  if (profile === 'closed-loops' || profile === 'with-bypass' || profile === 'heat-pump-direct' || profile === 'heat-pump-buffered') {
    const measurable = profile === 'with-bypass' || profile === 'heat-pump-buffered';
    return { ...s, hydraulic: { ...s.hydraulic, closedChannels: [pipeA, pipeB],
      ...(measurable && { resistance: { ...s.hydraulic.resistance, ...linearPipes(s) } }),
      ...(profile === 'heat-pump-buffered' && { pumps: { ...s.hydraulic.pumps, [pump]: { mode: 'off', blockReverse: true } } }),
    } };
  }
  if (profile === 'tank-absent' || profile === 'tank-relief') {
    const domain = s.system.hydraulicDomains[0];
    if (!domain || !s.fluid.cells[source]) throw new Error('Не найдён учебный контур бака.');
    const withTank = profile === 'tank-relief';
    return { ...s, pressure: [{ domainId: domain.id, profile: {
      referenceLiquidM3: .005, referenceC: 20, expansionPerK: 0, atmosphericPa: 100000, referenceGaugePa: 100000,
      ...(withTank && { tank: { gasAtReferenceM3: .008, minimumGasM3: .001, maximumGasM3: .010 },
        relief: { opensGaugePa: 150000, ratedMaxM3s: .001 } }),
    } }], serviceCapacityM3ByCell: { [source]: .006 } };
  }
  if (profile === 'without-limiter') {
    return { ...s, teachingBoundary: { sampleCellId: source, maximumC: 62 },
      control: { ...s.control, devices: s.control.devices.filter((d) => d.id !== 'supply-limit'),
        wires: s.control.wires.filter((w) => w.from !== 'supply-limit' && w.to !== 'supply-limit') } };
  }
  if (profile?.startsWith('series-') || profile?.startsWith('separator-')) {
    const resistance = { ...s.hydraulic.resistance, ...linearPipes(s) };
    const settings: HydraulicInputs = {
      ...s.hydraulic, resistance, closedChannels: profile.startsWith('series-') ? [cross] : [],
      pumps: { ...s.hydraulic.pumps, [pump]: { mode: 'fixed-speed', speedFraction: profile.endsWith('-slow') ? .25 : 1,
        points: [{ flowM3s: 0, headPa: 45000 }, { flowM3s: .00024, headPa: 0 }] } },
      valves: { ...s.hydraulic.valves, ...(profile === 'separator-check' && { [cross]: { kind: 'check', crackingPa: 0 } }) },
    };
    return { ...s, hydraulic: settings };
  }
  if (profile === 'dry-floor' && s.building) {
    return { ...s, building: { ...s.building, floors: s.building.floors.map((floor) => ({ ...floor, profile: trainingFloorProfiles.dry })) } };
  }
  return s;
}
