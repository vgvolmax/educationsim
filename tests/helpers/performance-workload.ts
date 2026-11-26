import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { observeWorkerCommands, readCommandTimings } from './command-timing';

export const performanceTarget = process.env.EDUCATIONSIM_PERFORMANCE_TARGET === '1';
const frameWindow = performanceTarget ? 30_000 : 2_500;
export const softwareGraphicsArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const bench = resolve('tests/fixtures/projects/benchmark-large.json');
type EditorProbe = HTMLInputElement & { editorPaint?: Promise<number> };

async function sampleFrames(page: Page) {
  const canvas = page.locator('canvas[data-scene]');
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const r = (await canvas.boundingBox())!;
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  const collecting = page.evaluate((duration) => new Promise<number[]>((resolve) => {
    const times: number[] = [];
    let first = -1, last = 0;
    const frame = (at: number) => {
      if (first < 0) { first = at; last = at; }
      else { times.push(at - last); last = at; }
      if (at - first >= duration) resolve(times);
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), frameWindow);
  const moves = performanceTarget ? 120 : 20;
  try {
    for (let i = 0; i < moves; i++) {
      await page.mouse.move(r.x + r.width / 2 + Math.sin(i * .34) * Math.min(230, r.width / 3),
        r.y + r.height / 2 + Math.cos(i * .25) * Math.min(110, r.height / 4));
      await new Promise((resolve) => setTimeout(resolve, (frameWindow - 200) / moves));
    }
  } finally { await page.mouse.up(); }
  return collecting;
}

export async function measureWorkload(
  page: Page,
  size: 'small' | 'large',
  launch: { coldMs: number; chromium: string; electron: string | null },
  testInfo: TestInfo,
) {
  if (size === 'small') await page.getByRole('button', { name: 'Прямое подключение: две петли' }).click();
  else {
    await page.getByLabel('Импорт проекта JSON').setInputFiles(bench);
    await page.getByRole('button', { name: 'Открыть отдельную копию' }).click();
  }
  const visible = page.locator('polyline[data-link].water');
  const waterLinks = await visible.count();
  expect(waterLinks).toBeGreaterThan(0);
  const editorReactionMs: number[] = [];
  const water = page.getByLabel('Вода', { exact: true });
  for (let i = 0; i < 6; i++) {
    await water.evaluate((el: EditorProbe, expected) => {
      el.editorPaint = new Promise((resolve) => {
        el.addEventListener('click', () => {
          const start = performance.now();
          const check = () => {
            if (document.querySelectorAll('polyline[data-link].water').length === expected) {
              requestAnimationFrame(() => resolve(performance.now() - start));
            } else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        }, { once: true, capture: true });
      });
    }, i % 2 ? waterLinks : 0);
    await water.click();
    await expect(visible).toHaveCount(i % 2 ? waterLinks : 0);
    editorReactionMs.push(await water.evaluate((el: EditorProbe) => el.editorPaint!));
  }
  await observeWorkerCommands(page);
  await page.getByRole('button', { name: 'Подготовить прогон' }).click();
  await page.getByRole('button', { name: 'Пуск', exact: true }).click();
  const meter = page.locator(size === 'small' ? '[data-meter="link:pipe-a"]' : '[data-meter="link:g0-loop-0"]');
  await expect(meter).toHaveText(/[1-9].*л\/мин/);
  for (let i = 0; i < 6; i++) {
    await page.getByRole('button', { name: i % 2 ? 'Восстановить питание модели' : 'Отключить питание модели' }).click();
    if (i % 2) await expect(meter).toHaveText(/[1-9].*л\/мин/);
    else await expect(meter).toHaveText('0,00 л/мин');
  }
  const commands = await readCommandTimings(page);
  expect(commands).toHaveLength(6);
  for (const timing of commands) expect(timing.appliedTick).toBe(timing.acknowledgedTick + 1);
  const acknowledgementMs = commands.map((command) => command.acknowledgementMs);
  const nextSnapshotMs = commands.map((command) => command.nextSnapshotMs);
  await page.getByRole('button', { name: '3D сцена' }).click();
  const framesMs = await sampleFrames(page);
  expect(framesMs.length).toBeGreaterThan(8);
  expect(framesMs.every((x) => Number.isFinite(x) && x >= 0)).toBe(true);
  const video = await page.locator('canvas[data-scene]').evaluate((el) => {
    const gl = (el as HTMLCanvasElement).getContext('webgl2'), marker = gl?.getExtension('WEBGL_debug_renderer_info');
    return { gpu: marker ? String(gl!.getParameter(marker.UNMASKED_RENDERER_WEBGL)) : 'not reported',
      cssWidth: el.clientWidth, cssHeight: el.clientHeight, viewportWidth: innerWidth, viewportHeight: innerHeight,
      pixelRatio: devicePixelRatio, canvasPixelRatio: (el as HTMLCanvasElement).width / el.clientWidth, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches };
  });
  const cpu = cpus(), out = { version: 1, measurementClass: launch.electron ? (performanceTarget ? 'packaged-windows-target-attempt' : 'packaged-windows-software-ci') : 'browser-software-ci',
    size, environment: { os: platform(), release: release(), arch: arch(), logicalCpus: cpu.length, cpu: cpu[0]?.model ?? 'unknown',
      memoryMiB: Math.round(totalmem() / 1024 ** 2), chromium: launch.chromium, electron: launch.electron, ...video },
    coldMs: launch.coldMs, editorReactionMs, commands, frameWindowMs: frameWindow, framesMs };
  await testInfo.attach('performance-' + size, { body: JSON.stringify(out), contentType: 'application/json' });
  const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1]!;
  const stats = { p95FrameMs: p95(framesMs), p95EditorMs: p95(editorReactionMs),
    p95AckMs: p95(acknowledgementMs), p95NextSnapshotMs: p95(nextSnapshotMs) };
  console.log('EDUCATIONSIM_PERF', JSON.stringify({ ...out, framesMs: undefined, samples: framesMs.length, ...stats }));
  return { ...stats, video };
}
