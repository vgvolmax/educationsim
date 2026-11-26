import { branchEvidence } from './evidence';
import type { SimulationScenario } from './engine-types';
import type { SessionView } from './session';

type Reading = { id: string; unit: string; value: number | null };
type Equipment = { id: string; typeId: string; catalogSnapshotId: string | null };
type Capture = {
  projectId: string; revision: number; tick: number;
  start: unknown; components: readonly Equipment[]; readings: readonly Reading[]; events: readonly SessionView['events'][number][];
};
export type SimulationCapture = Readonly<Capture>;
const numeric = (n: number | null | undefined) => typeof n === 'number' && Number.isFinite(n) ? n : null;
const sameStart = (l: unknown, r: unknown): boolean => JSON.stringify(l) === JSON.stringify(r);

export function captureFrame(scenario: SimulationScenario, frame: SessionView): SimulationCapture | null {
  const { system, fluid, building, outdoorC, pressure } = scenario;
  const state = frame.snapshot;
  if (frame.stale || frame.mode === 'stopped' || state.health === 'stopped' || !state.hydraulics || state.tick < 1 ||
      system.projectId !== state.projectId || system.projectRevision !== state.projectRevision) return null;
  const collection: Reading[] = [];
  const add = (id: string, unit: string, value: number | null | undefined) => collection.push({ id, unit, value: numeric(value) });
  for (const { id } of system.hydraulicChannels) {
    const current = branchEvidence(frame, id).reading;
    add('flow:' + id, 'л/мин', current.status === 'measured' ? current.value : null);
  }
  for (const [id, gauge] of Object.entries(state.hydraulics.pressurePa)) add('pressure:' + id, 'Па', gauge);
  for (const [id, { temperatureC }] of Object.entries(state.fluid.cells)) add('water:' + id, '°C', temperatureC);
  for (const [id, { surfaceC }] of Object.entries(state.building?.floors ?? {})) add('floor:' + id, '°C', surfaceC);
  for (const [id, c] of Object.entries(state.building?.roomsC ?? {})) add('room:' + id, '°C', c);
  for (const [id, source] of Object.entries(state.sources)) add('heat:' + id, 'Вт', source.powerW);
  return structuredClone({
    projectId: state.projectId, revision: state.projectRevision, tick: state.tick,
    start: { outdoorC, roomsC: building?.roomsC, floorTemperatures: building?.floorTemperatures,
      initialWaterC: system.initialWaterC, climate: building?.climate,
      fluid: system.hydraulicDomains.map(({ fluid, pressureAtReferencePa }) => ({ fluid: fluid.id, pressureAtReferencePa })),
      temperatures: Object.values(fluid.cells).map(({ temperatureC }) => temperatureC), pressure },
    components: system.components.map(({ id, typeId, catalogSnapshotId }) => ({ id, typeId, catalogSnapshotId })),
    readings: collection, events: frame.events,
  });
}

export function compareCaptures(before: SimulationCapture, after: SimulationCapture) {
  const sameTick = before.tick === after.tick;
  const left = new Map(before.readings.map((r) => [r.id, r]));
  const right = new Map(after.readings.map((r) => [r.id, r]));
  const changed = (item: Equipment, current: readonly Equipment[]) =>
    !current.some((r) => r.id === item.id && r.typeId === item.typeId && r.catalogSnapshotId === item.catalogSnapshotId);
  return {
    sameTick, sameStart: sameStart(before.start, after.start), sameProject: before.projectId === after.projectId,
    removed: before.components.filter((c) => changed(c, after.components)),
    added: after.components.filter((c) => changed(c, before.components)),
    readings: [...new Set([...left.keys(), ...right.keys()])].map((id) => {
      const a = left.get(id), b = right.get(id), x = a?.value ?? null, y = b?.value ?? null;
      return { id, before: x, after: y, unit: a?.unit ?? b?.unit ?? '',
        delta: sameTick && a?.unit === b?.unit && x !== null && y !== null ? numeric(y - x) : null };
    }),
  };
}
