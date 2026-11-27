import { expect, test } from '@playwright/test';

test('the first lesson action and the water connections are visible at office window size', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: /^L15 ·/ }).click();
  await page.evaluate(() => scrollTo(0, 0));
  const diagram = page.getByRole('img', { name: 'Схема этажа' });
  await expect(diagram.locator('[data-link].water').first()).toHaveCSS('stroke', 'rgb(21, 87, 82)');
  await expect(page.getByRole('button', { name: 'Рассчитать один тик' })).toBeInViewport({ ratio: 1 });
  await expect(page.getByText('Расход · Петля 1 · Нет данных')).toBeVisible();
  await expect(page.getByText('link:pipe-a', { exact: false })).toHaveCount(0);
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(diagram.locator('[data-link].water').first()).not.toHaveCSS('stroke', 'none');
});

test('restarting an assessed lesson hides the walkthrough and restores the unsubmitted state', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^L15 ·/ }).click();
  await page.getByRole('button', { name: 'Показать разбор', exact: true }).click();
  const explanation = page.getByText(/Число петель не равно числу комнат/);
  await expect(explanation).toBeVisible();
  await page.getByRole('button', { name: 'Начать попытку заново' }).click();
  await expect(explanation).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Завершить попытку', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Сохранить отчёт наставнику' })).toBeDisabled();
});

test('a submitted lesson stays unsubmitted after restart and new interaction', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^L15 ·/ }).click();
  await page.getByRole('button', { name: 'Рассчитать один тик' }).click();
  await page.getByRole('button', { name: 'Завершить попытку', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранить отчёт наставнику' })).toBeEnabled();
  await page.getByRole('button', { name: 'Начать попытку заново' }).click();
  await expect(page.getByRole('heading', { name: 'Клиент: комплект на четыре петли', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Рассчитать один тик' }).click();
  await expect(page.getByRole('button', { name: 'Завершить попытку', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Сохранить отчёт наставнику' })).toBeDisabled();
});
