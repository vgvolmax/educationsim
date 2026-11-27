import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function add(page: Page, type: string) {
  await page.getByLabel('Учебное оборудование').selectOption(type);
  await page.getByRole('button', { name: 'Установить', exact: true }).click();
}

test('a new seller connects two parts from the visible, guided workflow', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый проект', exact: true }).click();
  const connect = page.getByRole('region', { name: 'Соединение элементов' });
  await expect(connect).toBeInViewport();
  await expect(connect).toContainText('Установите оборудование');
  await add(page, 'training-heat-source');
  await add(page, 'training-manifold-two-way');
  const nodes = page.locator('circle[data-component]');
  await expect(nodes).toHaveCount(2);
  const x = await nodes.evaluateAll((elements) => elements.map((el) => el.getAttribute('cx')));
  expect(x[0]).not.toEqual(x[1]);
  await page.getByRole('button', { name: /^Газовый котёл · mount-/ }).click();
  await connect.getByRole('button', { name: /Подача/ }).focus();
  await page.keyboard.press('Enter');
  await expect(connect).toContainText('Газовый котёл');
  await expect(connect.getByRole('button', { name: /Газовый котёл/ })).toHaveCount(0);
  await connect.getByRole('button', { name: /Коллектор.*Вход подачи/i }).click();
  await expect(connect.getByRole('status')).toContainText('Соединение добавлено');
  await expect(page.locator('[data-link]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Отменить', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.locator('[data-link]')).toHaveCount(0);
});

test('guided signals use output to input; a pending selection can be cancelled', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый проект', exact: true }).click();
  await add(page, 'training-thermostat');
  await add(page, 'training-zone-actuator');
  const connect = page.getByRole('region', { name: 'Соединение элементов' });
  await expect(connect.getByRole('button', { name: /Вход сигнала/ })).toBeDisabled();
  await page.getByRole('button', { name: /^Комнатный термостат.* · mount-/ }).click();
  await connect.getByRole('button', { name: /Выход сигнала/ }).click();
  await page.keyboard.press('Escape');
  await expect(connect.getByRole('button', { name: /Выход сигнала/ })).toBeFocused();
  await expect(page.locator('[data-link]')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await connect.getByRole('button', { name: /Привод.*Вход сигнала/i }).click();
  await expect(page.locator('[data-link].control')).toHaveCount(1);
});

for (const width of [390, 1024, 1366]) {
  test('the inspector and catalog do not overflow at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Прямое подключение: две петли' }).click();
    await page.getByRole('button', { name: 'Газовый котёл · source', exact: true }).click();
    for (const control of [page.getByLabel('Заменить на'), page.getByLabel('Учебное оборудование')]) {
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    await page.getByRole('button', { name: 'Каталог ВОЛМАКС', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Каталог ВОЛМАКС' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test('no compatible endpoint is safe, and a manifold loop can connect matched ports on one component', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый проект', exact: true }).click();
  await add(page, 'training-manifold-two-way');
  const guide = page.getByRole('region', { name: 'Соединение элементов' });
  await guide.getByRole('button', { name: /^Вход подачи/ }).click();
  await expect(guide.getByText(/Нет свободного совместимого/)).toBeVisible();
  await expect(page.locator('[data-link]')).toHaveCount(0);
  await guide.getByRole('button', { name: 'Отменить выбор' }).click();
  await guide.getByRole('button', { name: /^Подача петли 1/ }).click();
  await expect(guide.getByRole('button', { name: /Обратка петли 2/ })).toHaveCount(0);
  await guide.getByRole('button', { name: /Обратка петли 1/ }).click();
  await expect(page.locator('[data-link].water')).toHaveCount(1);
});
