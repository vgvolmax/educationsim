import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { _electron, expect, test } from '@playwright/test';

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
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
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

    const monitor = await app.evaluateHandle(({ shell }) => {
      const seen: string[] = [];
      shell.openExternal = async (url) => { seen.push(url); };
      return seen;
    });
    await page.getByRole('link', { name: 'Каталог ВОЛМАКС' }).click();
    await expect.poll(() => monitor.jsonValue()).toEqual([expect.stringMatching(/^https:\/\/volmax\.ru\/catalog\//)]);
    await monitor.dispose();
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
