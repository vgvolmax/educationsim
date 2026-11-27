import { expect, test } from '@playwright/test';

test('a newcomer opens the first experiment from the home screen and sees real feedback', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto('/');
  const start = page.getByRole('button', { name: 'Начать первый урок' });
  await expect(start).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Новый проект', exact: true })).toBeVisible();
  await start.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Подача, петля и обратка' })).toBeFocused();
  const guide = page.getByRole('region', { name: 'Следующий шаг' });
  await expect(guide).toContainText('1 из 3');
  await expect(guide).toContainText('Расход ещё не измерен');
  await page.getByRole('button', { name: 'Рассчитать один тик', exact: true }).click();
  await expect(guide).toContainText('2 из 3');
  await expect(guide).toContainText(/Расход в петле 1: [1-9]\d*,\d{2} л\/мин/);
  await page.getByRole('button', { name: 'Найти подачу', exact: true }).click();
  await expect(page.locator('[data-link="supply"]')).toHaveClass(/lesson-identified/);
  await page.getByRole('button', { name: 'Найти петлю пола', exact: true }).click();
  await page.getByRole('button', { name: 'Найти обратку', exact: true }).click();
  await expect(guide).toContainText('3 из 3');
  await expect(guide.getByRole('button', { name: 'Открыть свободную копию' })).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: 'Начать попытку заново' }).click();
  await expect(guide).toContainText('1 из 3');
  await expect(guide).toContainText('Расход ещё не измерен');
});

test('the same guide is available from the lesson library without revealing the assessed rubric', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^L01 ·/ }).click();
  await expect(page.getByRole('region', { name: 'Следующий шаг' })).toBeVisible();
  await page.getByRole('button', { name: '← Старт' }).click();
  await page.getByRole('button', { name: /^L15 ·/ }).click();
  await expect(page.getByRole('region', { name: 'Следующий шаг' })).toHaveCount(0);
  await expect(page.getByText('Оценка появится после завершения попытки.', { exact: false })).toBeVisible();
});
