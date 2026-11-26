import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const direct = 'Прямое подключение: две петли';
async function open(page: Page, title = direct) {
  await page.goto('/');
  await page.getByRole('button', { name: title, exact: true }).click();
}
async function editSource(page: Page) {
  await page.getByRole('button', { name: 'Газовый котёл · source', exact: true }).click();
}
test('accepts_decimal_comma_and_validates_limits', async ({ page }) => {
  await open(page);
  await editSource(page);
  const field = page.getByLabel('Предельная подача, °C');
  await field.fill('41,5');
  await page.getByRole('button', { name: 'Применить параметры' }).click();
  await expect(page.getByText('Редакция 1')).toBeVisible();
  await expect(field).toHaveValue('41,5');
  await field.fill('900');
  await page.getByRole('button', { name: 'Применить параметры' }).click();
  await expect(page.getByRole('alert')).toContainText('Предельная подача');
  await expect(page.getByText('Редакция 1')).toBeVisible();
  await expect(field).toHaveValue('900');
});
test('replace_preview_shows_removed_ports and only updates the graph after confirmation', async ({ page }) => {
  await open(page);
  await editSource(page);
  await page.getByLabel('Заменить на').selectOption('training-cap');
  await page.getByRole('button', { name: 'Предпросмотр замены' }).click();
  await expect(page.getByText('supply: отсоединить')).toBeVisible();
  await expect(page.getByText('return: отсоединить')).toBeVisible();
  await expect(page.locator('[data-link]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Подтвердить замену' }).click();
  await expect(page.locator('[data-link]')).toHaveCount(2);
});
test('remove_is_different_from_bypass_with_pipe', async ({ page }) => {
  await open(page, 'Пол с подмесом и радиатор');
  await page.getByRole('button', { name: 'Радиатор · radiator', exact: true }).click();
  const before = await page.locator('[data-link]').count();
  await page.getByRole('button', { name: 'Удалить узел', exact: true }).click();
  await expect(page.locator('[data-link]')).toHaveCount(before - 2);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await page.getByRole('button', { name: 'Радиатор · radiator', exact: true }).click();
  await page.getByRole('button', { name: 'Заменить участком трубы' }).click();
  await expect(page.locator('[data-link]')).toHaveCount(before - 1);
});
test('dead_end_protection_can_be_removed_with_explicit_cap', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Удалить связь supply', exact: true }).click();
  await page.getByLabel('Учебное оборудование').selectOption('training-pressure-gauge');
  await page.getByRole('button', { name: 'Установить' }).click();
  await editSource(page);
  await page.getByRole('button', { name: 'Порт supply · вода' }).click();
  await page.getByRole('button', { name: /^Манометр · mount-/ }).click();
  await page.getByRole('button', { name: 'Порт in · вода' }).click();
  await page.getByRole('button', { name: 'Снять и поставить заглушку' }).click();
  await expect(page.getByRole('button', { name: /^Заглушка · mount-/ })).toBeVisible();
  await expect(page.locator('[data-link]')).toHaveCount(4);
});
test('start_values_differ_from_live_temperature', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Учебная комната' }).click();
  await page.getByLabel('Начальная температура воздуха, °C').fill('23,5');
  await page.getByRole('button', { name: 'Сохранить начальные условия' }).click();
  await expect(page.getByText('Редакция 1')).toBeVisible();
  await expect(page.getByText('Текущая температура: нет расчётного снимка.')).toBeVisible();
});

test('route worker previews in the schematic without silently replacing a manual loop', async ({ page }) => {
  await open(page);
  await page.getByText('Трассировка петли', { exact: true }).click();
  await page.getByLabel('Связь петли').selectOption('pipe-a');
  await page.getByLabel('Точки X Z, м').fill('0,2 0,2\n5 0,2\n5 0,35\n0,2 0,35');
  await page.getByRole('button', { name: 'Предпросмотр трассы' }).click();
  await expect(page.getByText(/Длина черновика:/)).toBeVisible();
  await expect(page.locator('[data-route-preview]')).toHaveCount(1);
  await expect(page.getByText('Редакция 0')).toBeVisible();
  const accept = page.getByRole('button', { name: 'Принять трассу' });
  await expect(accept).toBeDisabled();
  await page.getByLabel('Заменить прежнюю ручную трассу').check();
  await accept.click();
  await expect(page.getByText('Редакция 1')).toBeVisible();
  await expect(page.locator('[data-route-preview]')).toHaveCount(0);
  await expect(page.locator('[data-link="pipe-a"]')).toHaveAttribute('points', /5,0\.23/);
});

test('automatic layout uses wall entries and a stale preview cannot overwrite newer work', async ({ page }) => {
  await open(page, 'Одиночная петля с RTL');
  await page.getByText('Трассировка петли', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Укладка', exact: true }).selectOption('serpentine');
  await page.getByLabel('Вход и выход на одной стене, X Z, м').fill('0 0,15\n0 0,3');
  await page.getByRole('button', { name: 'Предпросмотр трассы' }).click();
  await expect(page.locator('[data-route-preview]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Добавить комнату' }).click();
  await expect(page.locator('[data-route-preview]')).toHaveCount(0);
  await expect(page.getByText('Предпросмотр устарел. Запросите новый.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Принять трассу' })).toHaveCount(0);
});
