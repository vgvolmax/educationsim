import type { LoopRouteInput, PlannedLoop } from './routing';
import type { RouteDiagnostic } from './route-warnings';
import type { RouteWorkerRequest, RouteWorkerResponse } from './routing.worker';

type Attempt =
  | { status: 'cancelled' | 'stale' }
  | { status: 'failed'; diagnostics: RouteDiagnostic[] }
  | { status: 'ready'; route: PlannedLoop; revision: number; diagnostics: RouteDiagnostic[] };
type RouteState = { revision: number; route: PlannedLoop | null };

const communicationError: Attempt = {
  status: 'failed',
  diagnostics: [{ code: 'routing_worker', path: 'route', severity: 'error', message: 'Не удалось выполнить автопрокладку. Прежняя трасса не изменена.' }],
};

export function createRoutingClient(
  getRevision: () => number,
  factory = () => new Worker(new URL('./routing.worker.ts', import.meta.url), { type: 'module' }),
) {
  let id = 0;
  let pending: { worker: Worker; settle: (result: Attempt) => void } | undefined;
  let latest: { attempt: Extract<Attempt, { status: 'ready' }>; route: PlannedLoop } | undefined;

  function cancel(): boolean {
    latest = undefined;
    if (!pending) return false;
    pending.settle({ status: 'cancelled' });
    return true;
  }

  function request(input: LoopRouteInput): Promise<Attempt> {
    cancel();
    const revision = getRevision();
    const taskId = ++id;
    return new Promise((resolve) => {
      let worker: Worker;
      try { worker = factory(); }
      catch { resolve(communicationError); return; }
      const settle = (result: Attempt): void => {
        if (pending?.worker !== worker) return;
        pending = undefined;
        worker.terminate();
        if (result.status === 'ready') latest = { attempt: result, route: structuredClone(result.route) };
        resolve(result);
      };
      pending = { worker, settle };
      worker.onerror = () => settle(communicationError);
      worker.onmessageerror = () => settle(communicationError);
      worker.onmessage = ({ data }: MessageEvent<RouteWorkerResponse>) => {
        if (data.id !== taskId || data.revision !== revision || getRevision() !== revision) {
          settle({ status: 'stale' }); return;
        }
        settle(data.result.ok
          ? { status: 'ready', route: data.result.value, diagnostics: data.result.diagnostics, revision }
          : { status: 'failed', diagnostics: data.result.diagnostics });
      };
      const message: RouteWorkerRequest = { id: taskId, revision, input };
      try { worker.postMessage(message); }
      catch { settle(communicationError); }
    });
  }

  function applyPreview(state: RouteState, attempt: Attempt, replaceManual: boolean): RouteState {
    if (attempt.status !== 'ready' || latest?.attempt !== attempt || state.revision !== attempt.revision ||
        getRevision() !== state.revision || !Number.isSafeInteger(state.revision + 1) ||
        (state.route?.kind === 'manual' && !replaceManual)) return state;
    const route = latest.route;
    latest = undefined;
    return { revision: state.revision + 1, route };
  }
  return { request, cancel, applyPreview };
}
