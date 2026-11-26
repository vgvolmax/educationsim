import type { Diagnostic } from '../project/types';
import type { SimulationScenario } from '../simulation/engine-types';
import type { SimulationRecord } from '../simulation/replay';
import type { SessionView } from '../simulation/session';
import { sameKey, shouldAcceptView, Watchdog } from './protocol';
import type { RunKey, WorkerRequest, WorkerResponse } from './protocol';

type CommandMessage<T = WorkerRequest> = T extends WorkerRequest ? T extends { kind: 'load' } ? never : Omit<T, 'requestId' | 'key'> : never;
type ClientState = {
  mode: SessionView['mode'] | 'idle' | 'loading' | 'stalled';
  view: SessionView | null; record: SimulationRecord | null; diagnostics: Diagnostic[];
};

export function createSimulationClient(
  factory = () => new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' }),
  timeoutMs = 2500,
) {
  const watchdog = new Watchdog(timeoutMs);
  let state: ClientState = { mode: 'idle', view: null, record: null, diagnostics: [] };
  let active: RunKey | undefined, child: Worker | undefined;
  let sequence = 0, mark = { serial: 0, tick: 0 };
  const awaiting = new Map<number, number>();
  const now = () => performance.now();
  const stop = () => { child?.terminate(); child = undefined; awaiting.clear(); };
  function stall(code: string, message: string): void {
    stop();
    state = { ...state, mode: 'stalled', view: state.view && { ...state.view, mode: 'paused', stale: true },
      diagnostics: [{ code, path: 'worker', severity: 'error', message }] };
  }
  const timer = setInterval(() => {
    if (!child) return;
    const time = now();
    const stale = watchdog.check(time, state.mode === 'running' || state.mode === 'loading');
    if (stale || [...awaiting.values()].some((sent) => time - sent > timeoutMs)) {
      stall('worker_stalled', `Связь с расчётом потеряна. Последний модельный тик: ${mark.tick}.`);
    }
  }, Math.max(50, Math.min(250, timeoutMs / 4)));

  function submit(message: WorkerRequest): void {
    if (!child) return;
    awaiting.set(message.requestId, now());
    try { child.postMessage(message); }
    catch { stall('worker_send_failed', 'Не удалось передать запрос расчёту.'); }
  }

  function load(runId: string, scenario: SimulationScenario): void {
    stop();
    active = { runId, projectId: scenario.system.projectId, projectRevision: scenario.system.projectRevision };
    state = { mode: 'loading', view: null, record: null, diagnostics: [] };
    watchdog.progress(now(), 0);
    mark = { serial: 0, tick: 0 };
    try { child = factory(); }
    catch { stall('worker_start_failed', 'Не удалось запустить расчёт.'); return; }
    const instance = child;
    instance.onerror = () => { if (child === instance) stall('worker_crashed', 'Расчёт прерван; показан последний доступный снимок.'); };
    instance.onmessageerror = () => { if (child === instance) stall('worker_decode_failed', 'Не удалось прочитать снимок расчёта.'); };
    instance.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (child !== instance || !active || !data?.key || !sameKey(active, data.key)) return;
      if (data.kind === 'view') {
        const tick = data.view?.snapshot?.tick;
        if (typeof tick !== 'number' || !shouldAcceptView(active, mark, { serial: data.serial, tick, key: data.key, reset: data.reset }) ||
            data.view.snapshot.projectId !== active.projectId || data.view.snapshot.projectRevision !== active.projectRevision) return;
        const firstView = state.mode === 'loading';
        mark = { serial: data.serial, tick };
        watchdog.progress(now(), tick);
        if (data.requestId !== undefined) awaiting.delete(data.requestId);
        state = { ...state, mode: data.view.mode, view: data.view, diagnostics: data.view.diagnostics, record: data.reset ? null : state.record };
        if (firstView && globalThis.document?.hidden) visibility();
      } else if (data.kind === 'record') {
        if (!awaiting.delete(data.requestId)) return;
        state = { ...state, record: data.record };
      } else if (data.kind === 'error') {
        if (data.requestId !== undefined && !awaiting.delete(data.requestId)) return;
        if (state.mode === 'loading') { stop(); state = { ...state, mode: 'stopped', diagnostics: data.diagnostics }; }
        else state = { ...state, diagnostics: data.diagnostics };
      }
    };
    submit({ kind: 'load', scenario, key: active, requestId: ++sequence });
  }

  function send(message: CommandMessage): boolean {
    if ((message.kind === 'resume' && globalThis.document?.hidden) || !active || !child || awaiting.size >= 256 || state.mode === 'loading' || state.mode === 'stalled') return false;
    submit({ ...message, key: active, requestId: ++sequence } as WorkerRequest);
    return child !== undefined;
  }
  const visibility = () => { send({ kind: 'visibility', visible: !globalThis.document?.hidden }); };
  globalThis.document?.addEventListener('visibilitychange', visibility);
  return {
    get state() { return state; }, load, send,
    dispose() { stop(); clearInterval(timer); active = undefined; globalThis.document?.removeEventListener('visibilitychange', visibility); },
  };
}
