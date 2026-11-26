import { expect, test } from '@playwright/test';
import { measureWorkload, softwareGraphicsArgs } from '../helpers/performance-workload';

test.use({ viewport: { width: 1600, height: 1000 }, launchOptions: {
  executablePath: process.env.EDUCATIONSIM_CHROMIUM_PATH, args: softwareGraphicsArgs,
} });

for (const size of ['small', 'large'] as const) {
  test('measures actual renderer and Worker, ' + size, async ({ page, browser }, evidence) => {
    test.setTimeout(70_000);
    const start = performance.now();
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText('Автономная среда готова');
    await measureWorkload(page, size, { coldMs: performance.now() - start, chromium: browser.version(), electron: null }, evidence);
  });
}
