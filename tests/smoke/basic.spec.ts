import { expect, test } from '@playwright/test';

test('opens_education_sim_shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Волмакс · Тёплый пол' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Новый проект' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Автономная среда готова');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
});
