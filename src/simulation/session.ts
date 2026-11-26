import type { Diagnostic, Result } from '../project/types';
import { openSimulation } from './engine';
import type { SimulationCommand, SimulationScenario, SimulationState } from './engine-types';
import { collectEvents, maxCommands, maxJournalEvents, maxReplayTicks, recordingVersion } from './replay';
import type { RecordedCommand, RunEvent, SimulationRecord } from './replay';

const speeds = [1, 10, 60, 600] as const;
export type SimulationSpeed = typeof speeds[number];
type Sample = { tick: number; sourcePowerW: number; highestWaterC: number | null; energyResidualJ: number | null };
export type SessionView = {
  snapshot: SimulationState; mode: 'paused' | 'running' | 'stopped'; speed: SimulationSpeed;
  diagnostics: Diagnostic[]; events: RunEvent[]; samples: Sample[]; stale: boolean; throttled: boolean;
};
type Session = {
  readonly view: SessionView; resume(): void; pause(): void; visibility(visible: boolean): void;
  setSpeed(speed: SimulationSpeed): void; command(command: SimulationCommand): boolean;
  stepOnce(): void; pulse(elapsedMs: number): void; reset(): void; record(): SimulationRecord | null;
};

const commandCapacityPerTick = 128, maxSamples = 2000, maxTicksPerSlice = 8;

export function createSession(supplied: SimulationScenario): Result<Session> {
  const scenario = structuredClone(supplied);
  const result = openSimulation(scenario);
  if (!result.ok) return result;
  const engine = result.value;
  let view: SessionView, pending: SimulationCommand[], commands: RecordedCommand[];
  let debt = 0, visible = true;
  function sample(snapshot: SimulationState): Sample {
    const temps = Object.values(snapshot.fluid.cells).map(({ temperatureC }) => temperatureC);
    return { tick: snapshot.tick, sourcePowerW: Object.values(snapshot.sources).reduce((sum, source) => sum + source.powerW, 0),
      highestWaterC: temps.length ? Math.max(...temps) : null, energyResidualJ: snapshot.energy?.residualJ ?? null };
  }
  function initialize(): void {
    const snapshot = engine.initial();
    view = { snapshot, mode: 'paused', speed: 1, diagnostics: [], events: [], samples: [sample(snapshot)], stale: false, throttled: false };
    pending = []; commands = []; debt = 0;
  }
  initialize();
  function tick(): void {
    const result = engine.step(view.snapshot, pending);
    if (!result.ok) {
      view = { ...view, mode: 'stopped', diagnostics: result.diagnostics, stale: true, throttled: false };
      debt = 0; return;
    }
    const snapshot = result.value;
    for (const command of pending) commands.push({ tick: snapshot.tick, seq: commands.length, command });
    pending = [];
    view = { ...view, snapshot, diagnostics: result.diagnostics,
      events: [...view.events, ...collectEvents(snapshot)].slice(-maxJournalEvents),
      samples: [...view.samples, sample(snapshot)].slice(-maxSamples),
      mode: snapshot.health === 'stopped' ? 'stopped' : view.mode };
    if (view.mode === 'stopped') debt = 0;
  }
  function pause(): void {
    debt = 0;
    if (view.mode !== 'stopped') view = { ...view, mode: 'paused', throttled: false };
  }
  return { ok: true, value: {
    get view() { return view; },
    pause,
    resume: () => { if (visible && view.mode !== 'stopped') view = { ...view, mode: 'running' }; },
    visibility: (isVisible) => { visible = isVisible; if (!visible) pause(); },
    setSpeed: (speed) => {
      if (!speeds.includes(speed)) return;
      view = { ...view, speed, throttled: false }; debt = 0;
    },
    command: (command) => {
      if (view.mode === 'stopped' || pending.length >= commandCapacityPerTick || commands.length + pending.length >= maxCommands) return false;
      pending.push(structuredClone(command)); return true;
    },
    stepOnce: () => { if (visible && view.mode === 'paused') tick(); },
    pulse: (elapsedMs) => {
      if (view.mode !== 'running' || !visible || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return;
      const requested = debt + Math.min(elapsedMs, 1000) * view.speed / 1000;
      const due = Math.min(maxTicksPerSlice, Math.floor(requested + 1e-12));
      view = { ...view, throttled: elapsedMs > 1000 || Math.floor(requested) > maxTicksPerSlice };
      debt = Math.min(maxTicksPerSlice, Math.max(0, requested - due));
      for (let i = 0; i < due && view.mode === 'running'; i++) tick();
    },
    reset: initialize,
    record: () => view.snapshot.tick > maxReplayTicks ? null :
      structuredClone({ version: recordingVersion, scenario, untilTick: view.snapshot.tick, commands }),
  }, diagnostics: [] };
}
