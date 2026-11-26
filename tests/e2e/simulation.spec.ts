import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Прямое подключение: две петли' }).click();
  await page.getByRole('button', { name: 'Подготовить прогон' }).click();
  await expect(page.getByText('Модельный тик: 0')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Один шаг' })).toBeEnabled();
}
test('play_pause_step_speed_and_reset use the real Worker clock', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Один шаг' }).click();
  await expect(page.getByText('Модельный тик: 1')).toBeVisible();
  await page.getByLabel('Скорость прогона').selectOption('10');
  await page.getByRole('button', { name: 'Пуск', exact: true }).click();
  await expect(page.getByText(/Модельный тик: [2-9]|Модельный тик: \d{2,}/)).toBeVisible();
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect(page.getByText('На паузе', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить прогон' }).click();
  await expect(page.getByText('Модельный тик: 0')).toBeVisible();
});
test('live_command_at_next_tick_changes_real_meter and records before/after evidence', async ({ page }) => {
  await ready(page);
  const meter = page.locator('[data-meter="link:pipe-a"]');
  await page.getByRole('button', { name: 'Один шаг' }).click();
  await expect(meter).not.toHaveText('0,00 л/мин');
  await page.getByRole('button', { name: 'Зафиксировать А' }).click();
  await page.getByLabel('Ветвь эксперимента').selectOption('link:pipe-a');
  await page.getByRole('button', { name: 'Закрыть клапан' }).click();
  await expect(meter).not.toHaveText('0,00 л/мин');
  await page.getByRole('button', { name: 'Один шаг' }).click();
  await expect(meter).toHaveText('0,00 л/мин');
  await page.getByRole('button', { name: 'Зафиксировать Б' }).click();
  await expect(page.getByText('Разное модельное время: разницы не рассчитаны.')).toBeVisible();
});
test('protective_event_points_to_device', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Имитировать отказ датчика' }).click();
  await page.getByRole('button', { name: 'Один шаг' }).click();
  await expect(page.getByText('Защита сработала')).toBeVisible();
  await page.getByRole('button', { name: 'Перейти к узлу защиты', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Газовый котёл · source' })).toHaveAttribute('aria-pressed', 'true');
});

test('sealed comparison survives an editor revision and aligns equal model time', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Прямое подключение: две петли' }).click();
  await page.getByLabel('Учебное оборудование').selectOption('training-wall-cabinet');
  await page.getByRole('button', { name: 'Установить' }).click();
  await page.getByRole('button', { name: 'Подготовить прогон' }).click();
  await page.getByRole('button', { name: 'Один шаг' }).click();
  await page.getByRole('button', { name: 'Зафиксировать А' }).click();
  await page.getByRole('button', { name: 'Удалить узел', exact: true }).click();
  await expect(page.getByText(/Схема изменилась/)).toBeVisible();
  await page.getByRole('button', { name: 'Подготовить прогон' }).click();
  await page.getByRole('button', { name: 'Один шаг' }).click();
  await expect(page.getByText('Модельный тик: 1')).toBeVisible();
  await page.getByRole('button', { name: 'Один шаг' }).click();
  await expect(page.getByText('Модельный тик: 2')).toBeVisible();
  await page.getByRole('button', { name: 'Зафиксировать Б' }).click();
  await expect(page.getByText(/А: редакция 1, тик 1. Б: редакция 2, тик 1./)).toBeVisible();
  await expect(page.getByText(/Сняты: mount-.*training-wall-cabinet/)).toBeVisible();
});
