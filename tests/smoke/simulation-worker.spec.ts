import { expect, test } from '@playwright/test';
import { scenario } from '../fixtures/simulation-engine';

test('runs the real two-loop simulation in a Worker, pauses and exports the accepted commands', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async (fixture) => {
    const path = '/src/worker/client.ts';
    const { createSimulationClient } = await import(path) as typeof import('../../src/worker/client');
    const client = createSimulationClient(undefined, 3000);
    const wait = async (condition: () => boolean) => {
      const limit = performance.now() + 4000;
      while (!condition() && performance.now() < limit) await new Promise((resolve) => setTimeout(resolve, 20));
      if (!condition()) throw new Error(JSON.stringify(client.state));
    };
    try {
      client.load('test-run', fixture);
      await wait(() => client.state.mode === 'paused');
      client.send({ kind: 'command', command: { kind: 'manual', actuatorId: 'drive', demand: true } });
      client.send({ kind: 'step' });
      await wait(() => client.state.view?.snapshot.tick === 1);
      const first = client.state.view!.snapshot;
      client.send({ kind: 'record' });
      await wait(() => client.state.record?.untilTick === 1);
      const recording = client.state.record;
      client.send({ kind: 'speed', speed: 60 });
      client.send({ kind: 'resume' });
      await wait(() => (client.state.view?.snapshot.tick ?? 0) > 1);
      client.send({ kind: 'visibility', visible: false });
      await wait(() => client.state.mode === 'paused');
      const pausedTick = client.state.view!.snapshot.tick;
      await new Promise((resolve) => setTimeout(resolve, 180));
      const unchanged = pausedTick === client.state.view!.snapshot.tick;
      client.send({ kind: 'reset' });
      await wait(() => client.state.view?.snapshot.tick === 0);
      return {
        tick: first.tick, a: first.hydraulics?.channels['link:pipe-a']?.flowM3s,
        b: first.hydraulics?.channels['link:pipe-b']?.flowM3s,
        recorded: recording?.commands[0]?.command.kind, unchanged,
        resetTick: client.state.view?.snapshot.tick,
      };
    } finally { client.dispose(); }
  }, scenario());
  expect(result).toMatchObject({ tick: 1, recorded: 'manual', unchanged: true, resetTick: 0 });
  expect(result.a).toBeGreaterThan(0);
  expect(result.a).toBeCloseTo(result.b!, 10);
});

test('retains the last good tick if a running Worker stops responding', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async (fixture) => {
    const path = '/src/worker/client.ts';
    const { createSimulationClient } = await import(path) as typeof import('../../src/worker/client');
    const child = new Worker('/src/worker/simulation.worker.ts', { type: 'module' });
    const client = createSimulationClient(() => child, 1000);
    const wait = async (condition: () => boolean) => {
      const limit = performance.now() + 4000;
      while (!condition() && performance.now() < limit) await new Promise((resolve) => setTimeout(resolve, 20));
      if (!condition()) throw new Error(JSON.stringify(client.state));
    };
    try {
      client.load('watched-run', fixture);
      await wait(() => client.state.mode === 'paused');
      client.send({ kind: 'speed', speed: 60 });
      client.send({ kind: 'resume' });
      await wait(() => (client.state.view?.snapshot.tick ?? 0) >= 2);
      child.terminate();
      const lastGood = client.state.view!.snapshot.tick;
      await wait(() => client.state.mode === 'stalled');
      return { lastGood, after: client.state.view?.snapshot.tick, stale: client.state.view?.stale, code: client.state.diagnostics[0]?.code };
    } finally { client.dispose(); }
  }, scenario());
  expect(result.lastGood).toBeGreaterThan(0);
  expect(result).toMatchObject({ after: result.lastGood, stale: true, code: 'worker_stalled' });
});
