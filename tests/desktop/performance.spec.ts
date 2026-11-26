import { _electron, expect, test } from '@playwright/test';
import { measureWorkload, performanceTarget, softwareGraphicsArgs } from '../helpers/performance-workload';

test.describe.configure({ mode: 'serial' });

for (const size of ['small', 'large'] as const) {
  test('records offline packaged startup and real renderer/Worker timings, ' + size, async ({}, evidence) => {
    test.setTimeout(performanceTarget ? 180_000 : 90_000);
    const executablePath = process.env.EDUCATIONSIM_DESKTOP_EXE;
    if (!executablePath) throw new Error('Set EDUCATIONSIM_DESKTOP_EXE to the executable from the extracted ZIP.');
    const env = { ...process.env, EDUCATIONSIM_TEST_PROFILE: evidence.outputPath('Профиль замеров'), EDUCATIONSIM_TEST_OFFLINE: '1' };
    const args = performanceTarget ? [] : softwareGraphicsArgs;
    const start = performance.now();
    const app = await _electron.launch({ executablePath, env, args, timeout: 30_000 });
    try {
      const page = await app.firstWindow();
      expect(page.url()).toBe('app://educationsim/');
      await expect(page.getByRole('status')).toHaveText('Автономная среда готова');
      const coldMs = performance.now() - start;
      if (performanceTarget) {
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.maximize());
      }
      const versions = await app.evaluate(() => ({ chromium: process.versions.chrome!, electron: process.versions.electron! }));
      const result = await measureWorkload(page, size, { coldMs, ...versions }, evidence);
      // Only an actual, separately identified target PC can turn this attempt into acceptance evidence.
      if (performanceTarget) {
        expect(process.platform).toBe('win32');
        expect(process.arch).toBe('x64');
        expect(result.video.gpu).not.toMatch(/SwiftShader|Basic Render Driver|not reported/i);
        expect(coldMs).toBeLessThanOrEqual(4_000);
        expect(result.p95EditorMs).toBeLessThanOrEqual(150);
        expect(result.p95AckMs).toBeLessThanOrEqual(size === 'small' ? 500 : 1000);
        expect(result.p95NextSnapshotMs).toBeLessThanOrEqual(size === 'small' ? 1500 : 2000);
        if (size === 'large') expect(result.p95FrameMs).toBeLessThanOrEqual(33);
      }
    } finally {
      await app.close();
    }
  });
}
