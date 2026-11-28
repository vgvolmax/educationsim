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
  await page.getByRole('button', { name: 'Подача', exact: true }).click();
  await page.getByRole('button', { name: /^Манометр · mount-/ }).click();
  await page.getByRole('button', { name: 'Вход', exact: true }).click();
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
  await page.getByRole('button', { name: 'Ввести координаты' }).click();
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
  await page.getByRole('button', { name: 'Ввести координаты' }).click();
  await page.getByLabel('Вход и выход на одной стене, X Z, м').fill('0 0,15\n0 0,3');
  await page.getByRole('button', { name: 'Предпросмотр трассы' }).click();
  await expect(page.locator('[data-route-preview]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Добавить комнату' }).click();
  await expect(page.locator('[data-route-preview]')).toHaveCount(0);
  await expect(page.getByText('Предпросмотр устарел. Запросите новый.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Принять трассу' })).toHaveCount(0);
});

async function clickFloor(page: Page, x: number, z: number) {
  const plan = page.getByRole('img', { name: 'Схема этажа' });
  await plan.scrollIntoViewIfNeeded();
  const point = await plan.evaluate((el, { x, z }) => {
    const screen = new DOMPoint(x, z).matrixTransform((el as unknown as SVGSVGElement).getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  }, { x, z });
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('[data-floor-cursor]:not(.invalid)')).toHaveCount(1);
  await page.mouse.click(point.x, point.y);
}

test('draws a snapped floor loop from a free manifold pair and commits both in one edit', async ({ page }) => {
  await open(page, 'Новый проект');
  await page.getByRole('button', { name: 'Добавить комнату' }).click();
  await page.getByLabel('Учебное оборудование').selectOption('training-manifold-two-way');
  await page.getByRole('button', { name: 'Установить', exact: true }).click();
  await page.getByText('Трассировка петли', { exact: true }).click();
  await expect(page.getByLabel('Связь петли').locator('option:checked')).toContainText('Петля 1');
  await page.getByLabel('Шаг, мм', { exact: true }).fill('200');
  await page.getByRole('button', { name: 'Рисовать трубу на плане' }).click();
  await clickFloor(page, .41, 1.02);
  await clickFloor(page, 4.42, 1.06);
  await clickFloor(page, 4.37, 1.23);
  await clickFloor(page, .39, 1.22);
  const draft = page.locator('[data-floor-draft]');
  const points = await draft.evaluate((el) => Array.from((el as unknown as SVGPolylineElement).points,
    ({ x, y }) => [Number(x.toFixed(2)), Number(y.toFixed(2))]));
  expect(points).toEqual([[.4, 1], [4.4, 1], [4.4, 1.2], [.4, 1.2]]);
  await page.getByRole('button', { name: 'Убрать точку' }).click();
  await expect(draft).toHaveAttribute('points', /^0\.4,1 4\.4,1 4\.4,1\.2\S*$/);
  await clickFloor(page, .39, 1.22);
  await page.getByRole('button', { name: 'Предпросмотр трассы' }).click();
  await expect(page.locator('[data-route-preview]')).toHaveCount(1);
  await expect(page.locator('[data-link]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Принять трассу' }).click();
  await expect(page.getByText('Редакция 3', { exact: true })).toBeVisible();
  await expect(page.locator('[data-link^="pipe-"]:not(.approximate)')).toHaveCount(1);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.locator('[data-link]')).toHaveCount(0);
});

test('automatic serpentine uses two snapped entries on the selected wall', async ({ page }) => {
  await open(page, 'Одиночная петля с RTL');
  await page.getByText('Трассировка петли', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Укладка', exact: true }).selectOption('serpentine');
  await page.getByRole('button', { name: 'Отметить вход и выход на плане' }).click();
  await clickFloor(page, .04, .17);
  await clickFloor(page, .10, .34);
  await expect(page.locator('[data-floor-draft]')).toHaveAttribute('points', '0,0.15 0,0.3');
  await page.getByRole('button', { name: 'Предпросмотр трассы' }).click();
  await expect(page.locator('[data-route-preview]')).toHaveCount(1);
});
