import { expect, test } from '@playwright/test';

test.use({ launchOptions: { executablePath: process.env.EDUCATIONSIM_CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

test('scene_and_2d_share_selection and context_loss_switches_to_2d_without_losing_project', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Прямое подключение: две петли' }).click();
  await page.getByRole('button', { name: '3D сцена' }).click();
  const canvas = page.locator('canvas[data-scene]');
  await expect(canvas).toBeVisible();
  await page.getByRole('button', { name: 'Пара коллекторов с расходомерами · manifold' }).click();
  await expect(page.getByText('Выбрано в 3D: Пара коллекторов с расходомерами')).toBeVisible();
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

test('canvas supports WASD and arrows without taking keys from a form', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Прямое подключение: две петли' }).click();
  await page.getByRole('button', { name: '3D сцена' }).click();
  const canvas = page.locator('canvas[data-scene]');
  await expect(canvas).toHaveAttribute('tabindex', '0');
  await expect(page.getByText(/стрелки и WASD/)).toBeVisible();
  await page.getByLabel('Без движения').focus();
  await page.keyboard.press('Tab');
  await expect(canvas).toBeFocused();
  const frames = () => page.evaluate(() => new Promise<void>((resolve) => {
    let count = 9;
    const tick = () => { if (--count === 0) resolve(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }));
  const panCount = async () => Number(await canvas.getAttribute('data-keyboard-pans'));
  await expect(canvas).toHaveAttribute('data-keyboard-pans', '0');
  const before = await panCount();
  await page.keyboard.down('w');
  await frames();
  await page.keyboard.up('w');
  const moved = await panCount();
  expect(moved).toBeGreaterThan(before);
  await page.keyboard.down('ArrowRight');
  await frames();
  await page.keyboard.up('ArrowRight');
  const right = await panCount();
  expect(right).toBeGreaterThan(moved);

  await page.keyboard.down('ArrowDown');
  await frames();
  const field = page.getByLabel('X, м', { exact: true });
  await field.focus();
  await expect(field).toBeFocused();
  const blur = await panCount();
  expect(blur).toBeGreaterThan(right);
  await frames();
  expect(await panCount()).toBe(blur);
  await page.keyboard.up('ArrowDown');
  await field.fill('1,2');
  await expect(field).toHaveValue('1,2');
  const preTop = await canvas.screenshot();
  await page.getByRole('button', { name: 'Сверху', exact: true }).click();
  const top = await canvas.screenshot();
  expect(top.equals(preTop)).toBe(false);
  const r = (await canvas.boundingBox())!;
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2 + 55, r.y + r.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  await frames();
  await expect(canvas).toBeFocused();
  expect((await canvas.screenshot()).equals(top)).toBe(false);
  await expect(page.getByText('Редакция 0', { exact: true })).toBeVisible();
});
