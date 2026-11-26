import type { Diagnostic, Result } from '../project/types';
import { openSimulation } from './engine';
import type { SimulationCommand, SimulationScenario, SimulationState } from './engine-types';

export const recordingVersion = 'education-sim-engine-v1';
export const maxCommands = 20_000;
export const maxReplayTicks = 36_000;
export const maxJournalEvents = 2048;
export type RecordedCommand = { tick: number; seq: number; command: SimulationCommand };
export type SimulationRecord = { version: typeof recordingVersion; scenario: SimulationScenario; untilTick: number; commands: RecordedCommand[] };
type ControlEvent = NonNullable<SimulationState['control']>['events'][number];
export type RunEvent = ControlEvent & { id: string };
export const collectEvents = (snapshot: SimulationState): RunEvent[] =>
  (snapshot.control?.events ?? []).map((event, i) => ({ ...event, id: `${snapshot.tick}:${i}` }));

export function replay(record: SimulationRecord): Result<{ snapshot: SimulationState; events: RunEvent[] }> {
  const fail = (code: string, message: string): Result<{ snapshot: SimulationState; events: RunEvent[] }> =>
    ({ ok: false, diagnostics: [{ code, path: 'record', message, severity: 'error' }] });
  if (record.version !== recordingVersion || !Number.isSafeInteger(record.untilTick) || record.untilTick < 0 ||
      record.untilTick > maxReplayTicks || record.commands.length > maxCommands) {
    return fail('invalid_record', 'Запись несовместима или превышает лимит повторного прогона.');
  }
  let priorTick = 0, priorSeq = -1;
  for (const event of record.commands) {
    if (!Number.isSafeInteger(event.tick) || event.tick <= 0 || event.tick < priorTick || event.tick > record.untilTick ||
        !Number.isSafeInteger(event.seq) || event.seq <= priorSeq) {
      return fail('invalid_record_order', 'Команды не упорядочены по модельному тику и последовательности.');
    }
    priorTick = event.tick; priorSeq = event.seq;
  }
  const engine = openSimulation(record.scenario);
  if (!engine.ok) return engine;
  let snapshot = engine.value.initial(), cursor = 0;
  const events: RunEvent[] = [];
  let diagnostics: Diagnostic[] = [];
  while (snapshot.tick < record.untilTick) {
    const commands: SimulationCommand[] = [];
    while (record.commands[cursor]?.tick === snapshot.tick + 1) commands.push(record.commands[cursor++]!.command);
    const next = engine.value.step(snapshot, commands);
    if (!next.ok) return next;
    snapshot = next.value; diagnostics = next.diagnostics;
    events.push(...collectEvents(snapshot));
    if (events.length > maxJournalEvents) events.splice(0, events.length - maxJournalEvents);
    if (snapshot.health === 'stopped' && snapshot.tick < record.untilTick) {
      return fail('record_stopped_early', 'Расчёт остановлен раньше конца записи.');
    }
  }
  return { ok: true, value: { snapshot, events }, diagnostics };
}
