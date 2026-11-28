import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function lesson(page: Page, id: string) {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp('^' + id + ' ·') }).click();
}
const press = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
const done = (page: Page) => expect(page.getByText('Урок пройден.', { exact: true })).toBeVisible();

test('L02 measures flow balance, not an action alone', async ({ page }) => {
  await lesson(page, 'L02');
  await press(page, 'Один шаг расчёта');
  await expect(page.getByText('Модельный тик: 1')).toBeVisible();
  await expect(page.getByText('Урок пройден.', { exact: true })).toHaveCount(0);
  await press(page, 'Поставить клапан первой петли на 45 %');
  await done(page);
  await expect(page.getByText(/Расход второй петли.*2,40 л\/мин/)).toBeVisible();
});
test('L04 verifies two settings at the same elapsed simulated time', async ({ page }) => {
  await lesson(page, 'L04');
  await press(page, 'Просчитать 120 тиков');
  await expect(page.getByText('Модельный тик: 120')).toBeVisible();
  await expect(page.getByText(/Подача пола.*32,69 °C/)).toBeVisible();
  await press(page, 'Установить горячий вход 80 %');
  await press(page, 'Просчитать 120 тиков');
  await done(page);
  const comparison = page.getByRole('region', { name: 'Сравнение стендов' });
  await expect(comparison.getByRole('row', { name: /35 %.*120.*32,69/ })).toBeVisible();
  await expect(comparison.getByRole('row', { name: /80 %.*120.*38,63/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Замер на тике 120 готов' })).toBeDisabled();
  await press(page, 'Установить горячий вход 35 %');
  await expect(page.getByRole('button', { name: 'Замер на тике 120 готов' })).toBeDisabled();
  await done(page);
});
test('L09 retains the protection case when the unsupported branch refuses numbers', async ({ page }) => {
  await lesson(page, 'L09');
  await press(page, 'Один шаг расчёта');
  await expect(page.getByText('Модельный тик: 1')).toBeVisible();
  await press(page, 'Сравнить стенд без ограничителя');
  await press(page, 'Один шаг расчёта');
  await expect(page.getByText('Ожидаемая остановка без защиты.')).toBeVisible();
  await done(page);
});
test('archived L15 remains teachable after its source SKU is absent from the active catalog', async ({ page }) => {
  await page.goto('/');
  await press(page, 'Прямое подключение: две петли');
  await press(page, 'Каталог ВОЛМАКС');
  await page.getByText('Локальное обновление', { exact: true }).click();
  await page.getByLabel('Файл обновления каталога').setInputFiles({
    name: 'replacement-references.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, releaseId: 'without-eco4', publishedOn: '2026-11-26', offers: [], products: [], kits: [] })),
  });
  await press(page, 'Активировать выпуск');
  await expect(page.getByText('Версия: without-eco4')).toBeVisible();
  await press(page, 'Закрыть каталог');
  await press(page, '← Старт');
  await page.getByRole('button', { name: /^L15 ·/ }).click();
  await page.getByText('Карточка комплекта · 17052-04eco', { exact: true }).click();
  await expect(page.getByRole('link', { name: /17052-04eco/ })).toBeVisible();
  await press(page, 'Один шаг расчёта');
  await expect(page.getByText('Модельный тик: 1')).toBeVisible();
  await press(page, 'Добавить один комплект Эко 4');
  await press(page, 'Добавить отдельную трубу');
  for (const label of ['Четыре петли, хотя комнат три', 'По карточке восемь евроконусов; подтвердить расхождение',
    'Сверить 130/180 мм, присоединения и рабочую точку']) await page.getByRole('radio', { name: label, exact: true }).check();
  await press(page, 'Завершить попытку');
  await done(page);
});
