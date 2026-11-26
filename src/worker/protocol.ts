import type { Diagnostic } from '../project/types';
import type { SimulationCommand, SimulationScenario } from '../simulation/engine-types';
import type { SimulationRecord } from '../simulation/replay';
import type { SessionView, SimulationSpeed } from '../simulation/session';

export type RunKey = { runId: string; projectId: string; projectRevision: number };
type Keyed = { key: RunKey; requestId: number };
export type WorkerRequest = Keyed & (
  | { kind: 'load'; scenario: SimulationScenario }
  | { kind: 'resume' | 'pause' | 'step' | 'reset' | 'record' }
  | { kind: 'visibility'; visible: boolean }
  | { kind: 'speed'; speed: SimulationSpeed }
  | { kind: 'command'; command: SimulationCommand }
);
export type WorkerResponse =
  | { kind: 'view'; key: RunKey; requestId?: number; serial: number; reset: boolean; view: SessionView }
  | { kind: 'record'; key: RunKey; requestId: number; record: SimulationRecord | null }
  | { kind: 'error'; key: RunKey; requestId?: number; diagnostics: Diagnostic[] };
export const sameKey = (a: RunKey, b: RunKey): boolean =>
  a.runId === b.runId && a.projectId === b.projectId && a.projectRevision === b.projectRevision;

type Mark = { serial: number; tick: number };
export function shouldAcceptView(expected: RunKey, previous: Mark, next: Mark & { key: RunKey; reset: boolean }): boolean {
  return sameKey(expected, next.key) && Number.isSafeInteger(next.serial) && next.serial > previous.serial &&
    Number.isSafeInteger(next.tick) && next.tick >= 0 && (next.reset ? next.tick === 0 : next.tick >= previous.tick);
}

export class Watchdog {
  #lastSeen = 0;
  #lastTick = 0;
  constructor(private readonly timeoutMs: number) {}
  progress(now: number, tick: number): void { this.#lastSeen = now; this.#lastTick = tick; }
  check(now: number, isWaiting: boolean): { code: 'worker_stalled'; lastTick: number } | null {
    return isWaiting && now - this.#lastSeen > this.timeoutMs ? { code: 'worker_stalled', lastTick: this.#lastTick } : null;
  }
}
