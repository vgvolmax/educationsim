import type { Page } from '@playwright/test';
import type { WorkerRequest, WorkerResponse } from '../../src/worker/protocol';

type RecordedTiming = { acknowledgementMs: number; nextSnapshotMs: number; acknowledgedTick: number; appliedTick: number };
type TimingPage = Window & { educationCommandTimings?: RecordedTiming[] };

export async function observeWorkerCommands(page: Page) {
  // Observe the real message boundary without modifying a request, response or simulation clock.
  await page.evaluate(() => {
    const original = window.Worker;
    const timings: RecordedTiming[] = [];
    (window as TimingPage).educationCommandTimings = timings;
    window.Worker = class extends original {
      private probes = new Map<number, { startedAt: number; powered: boolean; acknowledgementMs?: number; acknowledgedTick?: number }>();

      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', ({ data }: MessageEvent<WorkerResponse>) => {
          if (data?.kind !== 'view') return;
          const { tick, powered } = data.view.snapshot;
          const now = performance.now();
          const acknowledged = data.requestId === undefined ? undefined : this.probes.get(data.requestId);
          if (acknowledged) {
            acknowledged.acknowledgementMs = now - acknowledged.startedAt;
            acknowledged.acknowledgedTick = tick;
          }
          for (const [id, probe] of this.probes) {
            if (probe.acknowledgementMs === undefined || probe.acknowledgedTick === undefined || tick <= probe.acknowledgedTick || powered !== probe.powered) continue;
            timings.push({ acknowledgementMs: probe.acknowledgementMs, nextSnapshotMs: now - probe.startedAt,
              acknowledgedTick: probe.acknowledgedTick, appliedTick: tick });
            this.probes.delete(id);
          }
        });
      }

      override postMessage(message: WorkerRequest, options?: StructuredSerializeOptions | Transferable[]) {
        if (message?.kind === 'command' && message.command.kind === 'power') {
          this.probes.set(message.requestId, { startedAt: performance.now(), powered: message.command.powered });
        }
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }
    };
  });
}

export const readCommandTimings = (page: Page) => page.evaluate(() => (window as TimingPage).educationCommandTimings ?? []);
