import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function openCase(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^L15 ·/ }).click();
}

async function fillCase(page: Page, wrongPump: boolean) {
  await button(page, 'Один шаг расчёта').click();
  await button(page, 'Добавить один комплект Эко 4').click();
  await button(page, 'Добавить отдельную трубу').click();
  if (wrongPump) await button(page, 'Добавить ещё один насос').click();
  await page.getByRole('radio', { name: 'Четыре петли, хотя комнат три' }).check();
  await page.getByRole('radio', { name: 'По карточке восемь евроконусов; подтвердить расхождение' }).check();
  await page.getByRole('radio', { name: 'Сверить 130/180 мм, присоединения и рабочую точку' }).check();
}

test('an assessed case shows measurements, answers and the offline source at office window size', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await openCase(page);
  await expect(button(page, 'Один шаг расчёта')).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('region', { name: 'Состав заказа' })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('heading', { name: 'Вопросы' })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('complementary', { name: 'Измерения и готовность' })).toContainText('Расход · Петля 1');
  await expect(page.getByText('link:pipe-a', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Ровно нужные позиции, без лишних')).toHaveCount(0);
  await expect(page.getByText(/Число петель не равно числу комнат/)).toHaveCount(0);
  await expect(button(page, 'Завершить попытку')).toBeDisabled();
  await page.getByText('Карточка комплекта · 17052-04eco', { exact: true }).click();
  await expect(page.getByText(/евроконус.*8 шт\./i)).toBeVisible();
  await page.getByText('Схема контрольного стенда', { exact: true }).click();
  const link = page.getByRole('img', { name: 'Схема этажа' }).locator('[data-link].water').first();
  await expect(link).toHaveCSS('stroke', 'rgb(21, 87, 82)');
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(link).not.toHaveCSS('stroke', 'none');
});

test('quantities can be corrected without restarting the case or losing answers', async ({ page }) => {
  await openCase(page);
  await fillCase(page, false);
  await button(page, 'Добавить один комплект Эко 4').click();
  await button(page, 'Добавить отдельную трубу').click();
  await expect(page.getByRole('status', { name: 'Комплект «Эко 4»' })).toHaveText('2');
  await button(page, 'Убрать один комплект Эко 4').click();
  await button(page, 'Убрать отдельную трубу').click();
  await expect(page.getByRole('status', { name: 'Комплект «Эко 4»' })).toHaveText('1');
  await expect(page.getByRole('status', { name: 'Труба' })).toHaveText('1');
  await expect(page.getByRole('radio', { name: 'Четыре петли, хотя комнат три' })).toBeChecked();
  await button(page, 'Завершить попытку').click();
  await expect(page.getByText('Урок пройден.', { exact: true })).toBeVisible();
});

test('submitted attempts preserve their results across retries and reload and export their own run', async ({ page }) => {
  await openCase(page);
  await fillCase(page, true);
  await button(page, 'Завершить попытку').click();
  await expect(page.getByText('Частичный результат.')).toBeVisible();
  await expect(page.getByText('4 из 5', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Разбор' })).toBeVisible();
  await expect(button(page, 'Убрать лишний насос')).toHaveCount(0);
  await button(page, 'Новая попытка').click();
  await expect(button(page, 'Завершить попытку')).toBeDisabled();
  await fillCase(page, false);
  await button(page, 'Завершить попытку').click();
  await expect(page.getByText('Урок пройден.', { exact: true })).toBeVisible();
  await openCase(page);
  await expect(page.getByText('Урок пройден.', { exact: true })).toBeVisible();
  const history = page.getByLabel('История попыток');
  await history.selectOption({ index: 1 });
  await expect(page.getByText('Частичный результат.')).toBeVisible();
  await page.getByText('Что было сдано', { exact: true }).click();
  await expect(page.getByText('Дополнительный насос · 1 шт.')).toBeVisible();
  const downloading = page.waitForEvent('download');
  await button(page, 'Сохранить отчёт наставнику').click();
  const result = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
  expect(result).toMatchObject({ grade: { count: 4, total: 5 }, records: { main: { untilTick: 1 } } });
});
