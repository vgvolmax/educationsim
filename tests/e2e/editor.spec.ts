import { expect, test } from '@playwright/test';

test('opens_template_and_edits_connected_graph', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Прямое подключение: две петли' }).click();
  await expect(page.getByRole('heading', { name: 'Прямое подключение: две петли' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Схема этажа' }).locator('[data-link]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Удалить связь supply', exact: true }).click();
  await expect(page.locator('[data-link="supply"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Отменить' })).toBeEnabled();
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(page.locator('[data-link="supply"]')).toHaveCount(1);
});

test('builds_room_from_empty_project and leaves last accepted geometry on invalid input', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.getByRole('button', { name: 'Добавить комнату' }).click();
  await expect(page.getByRole('img', { name: 'Схема этажа' }).locator('[data-room]')).toHaveCount(1);
  const width = page.getByLabel('Ширина, м');
  await width.fill('7,5');
  await page.getByRole('button', { name: 'Применить размеры' }).click();
  await expect(page.locator('[data-room]')).toHaveAttribute('data-width', '7.5');
  await width.fill('0');
  await page.getByRole('button', { name: 'Применить размеры' }).click();
  await expect(page.getByRole('alert')).toContainText('Размеры');
  await expect(page.locator('[data-room]')).toHaveAttribute('data-width', '7.5');
  await expect(width).toHaveValue('0');
});

test('keyboard_can_select_connect_and_undo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Прямое подключение: две петли' }).click();
  await page.getByRole('button', { name: 'Удалить связь supply', exact: true }).click();
  const source = page.getByRole('button', { name: 'Газовый котёл · source', exact: true });
  await source.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Подача', exact: true }).focus();
  await page.keyboard.press('Enter');
  const manifold = page.getByRole('button', { name: 'Пара коллекторов с расходомерами · manifold', exact: true });
  await manifold.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Вход подачи', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-link]')).toHaveCount(4);
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-link]')).toHaveCount(3);
  await page.keyboard.press('Control+y');
  await expect(page.locator('[data-link]')).toHaveCount(4);
});

test('the editor fits a narrow window and does not discard work from the home screen', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 700 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.getByRole('button', { name: 'Добавить комнату' }).click();
  await expect(page.getByRole('img', { name: 'Схема этажа' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(720);
  await page.getByRole('button', { name: 'Старт' }).click();
  await page.getByRole('button', { name: 'Прямое подключение: две петли' }).click();
  await page.getByRole('button', { name: 'Старт' }).click();
  await page.getByRole('button', { name: 'Новый проект · редакция 1', exact: true }).click();
  await expect(page.locator('[data-room]')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Новый проект' })).toBeVisible();
});
