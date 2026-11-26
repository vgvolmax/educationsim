import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import { scenario } from '../fixtures/simulation-engine';

test('launches the packaged app offline, retains storage and rejects a second instance', async ({}, testInfo) => {
  test.setTimeout(150_000);
  const executablePath = process.env.EDUCATIONSIM_DESKTOP_EXE;
  if (!executablePath) throw new Error('Set EDUCATIONSIM_DESKTOP_EXE to the executable from the extracted ZIP.');
  const profile = testInfo.outputPath('Профиль проверки');
  const env = { ...process.env, EDUCATIONSIM_TEST_PROFILE: profile, EDUCATIONSIM_TEST_OFFLINE: '1' };
  const args = process.platform === 'linux' ? ['--ozone-platform=headless'] : [];
  const options = { executablePath, env, args, timeout: 30_000 };
  const expected = randomUUID();
  const app = await _electron.launch(options);
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Волмакс · Тёплый пол' })).toBeVisible();
    expect(page.url()).toBe('app://educationsim/');
    const networkError = await app.evaluate(async ({ net }) => {
      try { await net.fetch('https://example.invalid/'); return null; }
      catch (error) { return (error as Error).message; }
    });
    expect(networkError).toContain('ERR_BLOCKED_BY_CLIENT');
    await expect(page.getByRole('status')).toHaveText('Автономная среда готова');
    expect(await page.evaluate(async () => (await fetch('/runtime.json')).json())).toEqual({ format: 1 });
    const blocked = await app.evaluate(async ({ net }) => {
      const urls = [
        'app://educationsim/..%2fpackage.json',
        'app://educationsim/assets/..%5cpackage.json',
        'app://alien/runtime.json',
      ];
      return Promise.all(urls.map(async (url) => (await net.fetch(url)).status));
    });
    expect(blocked).toEqual([404, 404, 404]);

    const calculation = await page.evaluate(async (fixture) => {
      const built = '/assets/simulation.js';
      const { createSimulationClient } = await import(built) as typeof import('../../src/worker/client');
      const client = createSimulationClient(undefined, 5000);
      const wait = async (condition: () => boolean) => {
        const until = performance.now() + 5500;
        while (!condition() && performance.now() < until && client.state.mode !== 'stalled') {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        if (!condition()) throw new Error(JSON.stringify(client.state.diagnostics));
      };
      try {
        client.load('packaged-offline', fixture);
        await wait(() => client.state.mode === 'paused');
        client.send({ kind: 'command', command: { kind: 'manual', actuatorId: 'drive', demand: true } });
        client.send({ kind: 'step' });
        await wait(() => client.state.view?.snapshot.tick === 1);
        const snapshot = client.state.view!.snapshot;
        return {
          time: snapshot.tick,
          a: snapshot.hydraulics?.channels['link:pipe-a']?.flowM3s,
          b: snapshot.hydraulics?.channels['link:pipe-b']?.flowM3s,
        };
      } finally { client.dispose(); }
    }, scenario());
    expect(calculation.time).toBe(1);
    expect(calculation.a).toBeGreaterThan(0);
    expect(calculation.a).toBeCloseTo(calculation.b!, 10);

    const monitor = await app.evaluateHandle(({ shell }) => {
      const seen: string[] = [];
      shell.openExternal = async (url) => { seen.push(url); };
      return seen;
    });
    await page.getByRole('link', { name: 'Каталог ВОЛМАКС' }).click();
    await expect.poll(() => monitor.jsonValue()).toEqual([expect.stringMatching(/^https:\/\/volmax\.ru\/catalog\//)]);
    await monitor.dispose();
    await page.getByRole('button', { name: 'Прямое подключение: две петли' }).click();
    await expect(page.getByRole('img', { name: 'Схема этажа' }).locator('[data-link]')).toHaveCount(4);
    await page.getByRole('button', { name: 'Удалить связь supply', exact: true }).click();
    await expect(page.locator('[data-link="supply"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(page.locator('[data-link="supply"]')).toHaveCount(1);
    await page.getByText('Трассировка петли', { exact: true }).click();
    await page.getByLabel('Связь петли').selectOption('pipe-a');
    await page.getByLabel('Точки X Z, м').fill('0,2 0,2\n5 0,2\n5 0,35\n0,2 0,35');
    await page.getByRole('button', { name: 'Предпросмотр трассы' }).click();
    await expect(page.locator('[data-route-preview]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Принять трассу' })).toBeDisabled();
    await page.getByRole('button', { name: 'Подготовить прогон' }).click();
    await page.getByRole('button', { name: 'Один шаг' }).click();
    await expect(page.getByText('Модельный тик: 1')).toBeVisible();
    const firstFlow = await page.locator('[data-meter="link:pipe-a"]').textContent();
    expect(firstFlow).toMatch(/^[1-9]\d*,\d{2} л\/мин$/);
    await page.getByRole('button', { name: 'Закрыть клапан' }).click();
    await page.getByRole('button', { name: 'Один шаг' }).click();
    await expect(page.locator('[data-meter="link:pipe-a"]')).toHaveText('0,00 л/мин');



    expect(app.windows()).toHaveLength(1);
    expect(page.url()).toBe('app://educationsim/');

    await page.evaluate((value) => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('desktop-smoke', 1);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => request.result.createObjectStore('probe');
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('probe', 'readwrite');
        tx.objectStore('probe').put(value, 'value');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    }), expected);

    const other = testInfo.outputPath('Вторая сборка');
    await cp(dirname(executablePath), other, { recursive: true });
    const exit = await new Promise<number | null>((resolve, reject) => {
      const process = spawn(join(other, basename(executablePath)), args, { env, windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => { process.kill(); reject(new Error('Second instance did not exit')); }, 15_000);
      process.on('error', (error) => { clearTimeout(timer); reject(error); });
      process.on('exit', (code) => { clearTimeout(timer); resolve(code); });
    });
    expect(exit).toBe(0);
    expect(app.windows()).toHaveLength(1);
  } finally {
    await app.close();
  }

  const restarted = await _electron.launch(options);
  try {
    const page = await restarted.firstWindow();
    await expect(page.getByRole('heading', { name: 'Волмакс · Тёплый пол' })).toBeVisible();
    const read = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('desktop-smoke', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const value = db.transaction('probe').objectStore('probe').get('value');
        value.onsuccess = () => { db.close(); resolve(value.result); };
        value.onerror = () => { db.close(); reject(value.error); };
      };
    }));
    expect(read).toBe(expected);
  } finally {
    await restarted.close();
  }
});
