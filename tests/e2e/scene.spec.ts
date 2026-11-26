import { expect, test } from '@playwright/test';

test.use({ launchOptions: { executablePath: process.env.EDUCATIONSIM_CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

test('scene_and_2d_share_selection and context_loss_switches_to_2d_without_losing_project', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Прямое подключение: две петли' }).click();
  await page.getByRole('button', { name: '3D сцена' }).click();
  const canvas = page.locator('canvas[data-scene]');
  await expect(canvas).toBeVisible();
  await page.getByRole('button', { name: 'Пара коллекторов с расходомерами · manifold' }).click();
  await expect(page.getByText('Выбрано в 3D: manifold')).toBeVisible();
  await canvas.evaluate((node) => {
    const gl = (node as HTMLCanvasElement).getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_lose_context');
    if (!ext) throw new Error('No real WebGL loss adapter');
    ext.loseContext();
  });
  await expect(page.getByText('3D недоступно. Схема и расчёт сохранены в 2D.')).toBeVisible();
  await expect(page.locator('[data-component="manifold"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-link]')).toHaveCount(4);
});

test('a cutaway valve uses the running system and the same meter as 2D', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Прямое подключение: две петли' }).click();
  await page.getByRole('button', { name: 'Подготовить прогон' }).click();
  await page.getByRole('button', { name: 'Один шаг' }).click();
  await expect(page.getByText('Модельный тик: 1')).toBeVisible();
  await page.getByRole('button', { name: 'Пара коллекторов с расходомерами · manifold' }).click();
  await page.getByRole('button', { name: '3D сцена' }).click();
  await expect(page.locator('canvas[data-scene]')).toBeVisible();
  await page.getByRole('button', { name: 'Как работает' }).click();
  await expect(page.getByRole('img', { name: 'Принципиальные внутренние пути' })).toBeVisible();
  const section = page.locator('.cutaway-path').filter({ hasText: 'supply-1' });
  await section.getByRole('button', { name: 'Закрыть этот клапан' }).click();
  await page.getByRole('button', { name: 'Один шаг' }).click();
  await expect(section.getByText('Открытие 0 %')).toBeVisible();
  await page.getByRole('button', { name: '2D схема' }).click();
  await expect(page.locator('[data-meter="link:pipe-a"]')).toHaveText('0,00 л/мин');
  await expect(page.locator('[data-component="manifold"]')).toHaveClass(/selected/);
});
