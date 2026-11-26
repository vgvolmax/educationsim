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
  await press(page, 'Рассчитать один тик');
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
});
test('L09 retains the protection case when the unsupported branch refuses numbers', async ({ page }) => {
  await lesson(page, 'L09');
  await press(page, 'Рассчитать один тик');
  await expect(page.getByText('Модельный тик: 1')).toBeVisible();
  await press(page, 'Сравнить стенд без ограничителя');
  await press(page, 'Рассчитать один тик');
  await expect(page.getByRole('alert')).toContainText('учебная модель останавливает расчёт');
  await done(page);
});
test('L15 rejects a working but redundant purchase and checks the offered explanation', async ({ page }) => {
  await lesson(page, 'L15');
  await press(page, 'Рассчитать один тик');
  for (const label of ['Добавить один комплект Эко 4', 'Добавить отдельную трубу', 'Добавить ещё один насос', 'Четыре петли, хотя комнат три',
    'По карточке восемь евроконусов; подтвердить расхождение', 'Сверить 130/180 мм, присоединения и рабочую точку']) await press(page, label);
  await expect(page.getByText('Урок пройден.', { exact: true })).toHaveCount(0);
  await press(page, 'Убрать лишний насос');
  await done(page);
});
