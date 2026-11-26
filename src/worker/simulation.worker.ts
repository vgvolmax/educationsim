import type { Diagnostic } from '../project/types';
import { createSession } from '../simulation/session';
import { sameKey } from './protocol';
import type { RunKey, WorkerRequest, WorkerResponse } from './protocol';

type Session = Extract<ReturnType<typeof createSession>, { ok: true }>['value'];
let run: { key: RunKey; session: Session; serial: number; lastRequest: number } | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastPulse = 0, lastPublished = 0;
const post = (data: WorkerResponse): void => self.postMessage(data);
const invalid = (code: string, message: string): Diagnostic => ({ code, path: 'worker', severity: 'error', message });

function stopTimer(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}
function publish(requestId?: number, reset = false): void {
  if (run) {
    post({ kind: 'view', key: run.key, requestId, serial: ++run.serial, reset, view: run.session.view });
    lastPublished = performance.now();
  }
}
function schedule(): void {
  if (timer !== undefined || run?.session.view.mode !== 'running') return;
  lastPulse = performance.now();
  const pump = () => {
    if (run?.session.view.mode !== 'running') { stopTimer(); return; }
    const now = performance.now();
    run.session.pulse(now - lastPulse);
    lastPulse = now;
    if (run.session.view.mode !== 'running' || now - lastPublished >= 50) publish();
    if (run.session.view.mode === 'running') timer = setTimeout(pump, 10);
    else stopTimer();
  };
  timer = setTimeout(pump, 10);
}

self.addEventListener('message', ({ data }: MessageEvent<WorkerRequest>) => {
  const key = data?.key;
  if (!key || typeof key.runId !== 'string' || !key.runId || typeof key.projectId !== 'string' ||
      !Number.isSafeInteger(key.projectRevision) || !Number.isSafeInteger(data.requestId) || data.requestId <= 0) return;
  try {
    if (data.kind === 'load') {
      if (data.scenario?.system.projectId !== key.projectId || data.scenario?.system.projectRevision !== key.projectRevision) {
        post({ kind: 'error', key, requestId: data.requestId, diagnostics: [invalid('worker_identity', 'Сценарий и ревизия Worker не совпадают.')] });
        return;
      }
      const session = createSession(data.scenario);
      if (!session.ok) { post({ kind: 'error', key, requestId: data.requestId, diagnostics: session.diagnostics }); return; }
      stopTimer();
      run = { key, session: session.value, serial: 0, lastRequest: data.requestId };
      publish(data.requestId);
      return;
    }
    if (!run || !sameKey(run.key, key) || data.requestId <= run.lastRequest) return;
    run.lastRequest = data.requestId;
    const session = run.session, requestId = data.requestId;
    switch (data.kind) {
      case 'resume': session.resume(); schedule(); break;
      case 'pause': session.pause(); stopTimer(); break;
      case 'visibility': session.visibility(data.visible); if (!data.visible) stopTimer(); break;
      case 'step': session.stepOnce(); break;
      case 'advance':
        if (!Number.isSafeInteger(data.ticks) || data.ticks <= 0 || data.ticks > 120 || session.view.mode !== 'paused') {
          post({ kind: 'error', key, requestId, diagnostics: [invalid('worker_ticks', 'Допустимо до 120 тиков остановленного прогона.')] });
          return;
        }
        for (let tick = 0; tick < data.ticks; tick++) session.stepOnce();
        break;
      case 'speed': session.setSpeed(data.speed); lastPulse = performance.now(); break;
      case 'reset': session.reset(); stopTimer(); publish(data.requestId, true); return;
      case 'record': post({ kind: 'record', key, requestId: data.requestId, record: session.record() }); return;
      case 'command':
        if (!session.command(data.command)) {
          post({ kind: 'error', key, requestId: data.requestId, diagnostics: [invalid('worker_queue_full', 'Команда не принята: очередь заполнена или расчёт остановлен.')] });
          return;
        }
        break;
      default:
        post({ kind: 'error', key, requestId, diagnostics: [invalid('worker_command', 'Неизвестная команда Worker.')] });
        return;
    }
    publish(data.requestId);
  } catch {
    if (run && sameKey(run.key, key)) { run.session.pause(); stopTimer(); publish(); }
    post({ kind: 'error', key, requestId: data.requestId, diagnostics: [invalid('worker_invalid_message', 'Сбой запроса к расчёту; последний снимок сохранён.')] });
  }
});
