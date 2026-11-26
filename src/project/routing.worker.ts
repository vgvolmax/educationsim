import { planLoop } from './routing';
import type { LoopRouteInput, RouteResult } from './routing';

export type RouteWorkerRequest = { id: number; revision: number; input: LoopRouteInput };
export type RouteWorkerResponse = { id: number; revision: number; result: RouteResult };

self.addEventListener('message', ({ data }: MessageEvent<RouteWorkerRequest>) => {
  const result: RouteWorkerResponse = { id: data.id, revision: data.revision, result: planLoop(data.input) };
  self.postMessage(result);
});
