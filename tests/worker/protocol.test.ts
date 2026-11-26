import { expect, test } from 'vitest';
import { shouldAcceptView, Watchdog } from '../../src/worker/protocol';
const live = { runId: 'new', projectId: 'p', projectRevision: 3 };
test('drops_stale_revision_snapshot and retired run, and reset is explicit', () => {
  expect(shouldAcceptView(live, { serial: 5, tick: 4 }, { key: { ...live, projectRevision: 2 }, serial: 6, tick: 5, reset: false })).toBe(false);
  expect(shouldAcceptView(live, { serial: 5, tick: 4 }, { key: { ...live, runId: 'old' }, serial: 6, tick: 5, reset: false })).toBe(false);
  expect(shouldAcceptView(live, { serial: 5, tick: 4 }, { key: live, serial: 4, tick: 5, reset: false })).toBe(false);
  expect(shouldAcceptView(live, { serial: 5, tick: 4 }, { key: live, serial: 6, tick: 0, reset: false })).toBe(false);
  expect(shouldAcceptView(live, { serial: 5, tick: 4 }, { key: live, serial: 6, tick: 0, reset: true })).toBe(true);
});
test('worker_reports_stall_without_faking_sim_time', () => {
  const watchdog = new Watchdog(100);
  watchdog.progress(200, 4);
  expect(watchdog.check(280, true)).toBeNull();
  expect(watchdog.check(301, false)).toBeNull();
  expect(watchdog.check(301, true)).toEqual({ code: 'worker_stalled', lastTick: 4 });
});
