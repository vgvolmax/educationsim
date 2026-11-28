import { expect, test } from '@playwright/test';

test('home and editor share a styled workspace instead of default file controls', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.home-hero')).toBeVisible();
  await expect(page.getByRole('link', { name: 'К учебным заданиям' })).toBeVisible();
  const files = page.getByRole('region', { name: 'Файлы проекта' });
  await expect(files.locator('.file-pick')).toBeVisible();
  await expect(files.getByLabel('Импорт проекта JSON')).toHaveAttribute('type', 'file');
  await page.getByRole('button', { name: 'Новый проект', exact: true }).click();
  await expect(page.locator('.editor').getByRole('region', { name: 'Файлы проекта' })).toBeHidden();
  await page.getByRole('button', { name: 'Файлы и имя проекта' }).click();
  await expect(page.locator('.editor').getByRole('region', { name: 'Файлы проекта' })).toBeVisible();
  await expect(page.getByRole('button', { name: '2D схема', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await files.getByLabel('Импорт проекта JSON').setInputFiles({
    name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}'),
  });
  await expect(files.getByRole('alert')).toContainText('Импорт не выполнен');
});

test('the home, lesson and running editor fit a narrow viewport without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/');
  const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await fits();
  await page.getByRole('link', { name: 'К учебным заданиям' }).click();
  await page.getByRole('button', { name: /^L01 ·/ }).click();
  await page.getByRole('button', { name: 'Один шаг расчёта', exact: true }).click();
  await expect(page.getByText('Модельный тик: 1', { exact: true })).toBeVisible();
  await fits();
  await page.getByRole('button', { name: '← К заданиям', exact: true }).first().click();
  await page.getByRole('button', { name: 'Прямое подключение: две петли' }).click();
  await page.getByRole('button', { name: 'Подготовить прогон' }).click();
  await page.getByRole('button', { name: 'Один шаг расчёта' }).click();
  await expect(page.getByText('Модельный тик: 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Каталог ВОЛМАКС', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Каталог ВОЛМАКС' })).toBeVisible();
  await fits();
});
