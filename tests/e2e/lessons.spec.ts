import { expect, test } from '@playwright/test';

test('a real lesson uses the Worker, restricts actions and can create an unlocked copy', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /L01 · Подача, петля и обратка/ }).click();
  await expect(page.getByRole('heading', { name: 'Подача, петля и обратка' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить комнату' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Запустить воду', exact: true }).click();
  await expect(page.getByText('Расход в петле 1: 2,94 л/мин')).toBeVisible();
  await page.getByRole('button', { name: 'Показать подачу' }).click();
  await expect(page.locator('[data-link="supply"]')).toHaveClass(/lesson-identified/);
  await page.getByRole('button', { name: 'Показать петлю пола' }).click();
  await page.getByRole('button', { name: 'Показать обратку' }).click();
  await expect(page.getByText('Урок пройден.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Начать попытку заново' }).click();
  await expect(page.getByText('Расход ещё не измерен')).toBeVisible();
  await expect(page.getByText('Урок пройден.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Открыть свободную копию' }).click();
  await expect(page.getByRole('button', { name: 'Добавить комнату' })).toBeVisible();
  await expect(page.locator('[data-link]')).toHaveCount(4);
});

test('invalid author JSON shows a diagnostic without installing the lesson', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Предпросмотр авторского урока', { exact: true }).click();
  await page.getByLabel('Файл урока JSON').setInputFiles({
    name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"version":999,"id":"L01"}'),
  });
  await expect(page.getByRole('alert')).toContainText('формат задания');
  await expect(page.getByRole('button', { name: /L01 · Подача/ })).toBeVisible();
});
