import { explanation, fromDiagnostic } from './diagnostics';
import type { EvidenceState, EvidenceTarget, Explanation, Reading } from './diagnostics';
import type { SessionView } from './session';

type Frame = Pick<SessionView, 'snapshot' | 'mode' | 'stale' | 'diagnostics'>;
type Evidence = { state: EvidenceState; reading: Reading; target: EvidenceTarget; reasons: Explanation[] };

const stopped = (view: Frame): boolean => view.stale || view.mode === 'stopped' || view.snapshot.health === 'stopped';
function reading(view: Frame, value: number | null | undefined, unit: 'л/мин' | 'Па' | 'Вт', hadMeasurement = false): Reading {
  const { tick, health } = view.snapshot;
  const priorTick = health === 'stopped' ? tick - 1 : tick;
  if (!stopped(view) && typeof value === 'number' && Number.isFinite(value)) return { status: 'measured', value, unit, tick };
  return { status: 'unavailable', lastConfirmedTick: stopped(view) && hadMeasurement && priorTick > 0 ? priorTick : null };
}

export function branchEvidence(view: Frame, channelId: string): Evidence {
  const channel = Object.hasOwn(view.snapshot.hydraulics?.channels ?? {}, channelId)
    ? view.snapshot.hydraulics?.channels[channelId] : undefined;
  const target: EvidenceTarget = channel?.origin.linkId ? { kind: 'link', id: channel.origin.linkId }
    : channel?.origin.componentId ? { kind: 'component', id: channel.origin.componentId }
      : channelId.startsWith('link:') ? { kind: 'link', id: channelId.slice(5) } : { kind: 'channel', id: channelId };
  const sample = reading(view, channel === undefined ? undefined : channel.flowM3s * 60_000, 'л/мин', channel !== undefined);
  const item = (code: string, state: EvidenceState) => explanation(code, state, { target, reading: sample });
  if (stopped(view)) return { state: 'stopped', reading: sample, target, reasons: [item('model_stopped', 'stopped')] };
  if (sample.status === 'unavailable') return { state: 'insufficient', reading: sample, target, reasons: [item('data_missing', 'insufficient')] };
  const fault = Object.hasOwn(view.snapshot.faults.channels, channelId) ? view.snapshot.faults.channels[channelId] : undefined;
  const off = channel?.state !== 'open';
  const reasons = [];
  if (fault?.air) reasons.push(item('air_lock', off ? 'off' : 'restricted'));
  if (fault?.filter) reasons.push(item('filter_obstruction', 'restricted'));
  if (off && !reasons.length) reasons.push(item('circuit_off', 'off'));
  return { state: off ? 'off' : reasons.length ? 'restricted' : 'active', reading: sample, target, reasons };
}

export function domainPressureEvidence(view: Frame, domainId: string): Evidence {
  const target: EvidenceTarget = { kind: 'domain', id: domainId };
  const pressure = Object.hasOwn(view.snapshot.pressure, domainId) ? view.snapshot.pressure[domainId] : undefined;
  const sample = reading(view, pressure?.gaugePa, 'Па', typeof pressure?.gaugePa === 'number');
  const state = stopped(view) ? 'stopped' : sample.status === 'unavailable' ? 'insufficient' : pressure?.status === 'restricted' ? 'restricted' : 'active';
  const reasons: Explanation[] = view.diagnostics.filter((d) => d.path === domainId + '.pressure')
    .map((d) => ({ ...fromDiagnostic(d, stopped(view)), reading: sample, target }));
  if (!reasons.length && state !== 'active') reasons.push(explanation(state === 'stopped' ? 'model_stopped' : 'data_missing', state, { reading: sample, target }));
  return { target, reading: sample, state, reasons };
}

export function explainRun(view: Frame): Explanation[] {
  const pausedByFailure = stopped(view);
  const items = view.diagnostics.map((d) => fromDiagnostic(d, pausedByFailure));
  if (pausedByFailure) items.unshift(explanation('model_stopped', 'stopped'));
  if (!pausedByFailure) {
    for (const [id, blocked] of Object.entries(view.snapshot.control?.limits ?? {})) {
      if (blocked) items.push(explanation('limiter_tripped', 'protected', { target: { kind: 'component', id } }));
    }
    for (const id of view.snapshot.faults.sensors) items.push(explanation('sensor_failed', 'insufficient', { target: { kind: 'component', id } }));
    for (const id of Object.keys(view.snapshot.faults.jammed)) items.push(explanation('actuator_jammed', 'restricted', { target: { kind: 'component', id } }));
    for (const [id, source] of Object.entries(view.snapshot.sources)) {
      if (source.reason === 'minimum-flow') items.push(explanation('minimum_flow', 'restricted', { target: { kind: 'component', id },
        reading: reading(view, source.powerW, 'Вт') }));
    }
  }
  items.push(explanation('training_parameter', 'training'));
  return items;
}
