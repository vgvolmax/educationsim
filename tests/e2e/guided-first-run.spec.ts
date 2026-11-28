import { expect, test } from '@playwright/test';

test('one visible next action guides the entire first experiment with the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto('/');
  const start = page.getByRole('button', { name: 'Начать первый урок' });
  await expect(start).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Новый проект', exact: true })).toBeVisible();
  await start.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Подача, петля и обратка' })).toBeFocused();
  const guide = page.getByRole('region', { name: 'Следующий шаг' });
  const progress = page.getByRole('complementary', { name: 'Прогресс первого урока' });
  const launch = guide.getByRole('button', { name: 'Запустить воду' });
  await expect(launch).toBeInViewport({ ratio: 1 });
  await expect(launch).toBeEnabled();
  await launch.focus();
  await page.keyboard.press('Enter');
  await expect(progress).toContainText(/Расход в петле 1: [1-9]\d*,\d{2} л\/мин/);
  for (const [index, name] of ['Показать подачу', 'Показать петлю пола', 'Показать обратку'].entries()) {
    const next = guide.getByRole('button', { name });
    await expect(next).toBeInViewport({ ratio: 1 });
    await expect(next).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(progress).toContainText((index + 1) + ' из 3');
  }
  await expect(guide.getByRole('button', { name: 'Следующее задание' })).toBeFocused();
  await expect(guide.getByRole('button', { name: 'Открыть свободную копию' })).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: 'Начать попытку заново' }).click();
  await expect(launch).toBeEnabled();
  await expect(progress).toContainText('Расход ещё не измерен');
  await page.reload();
  await expect(page.getByRole('button', { name: /L01 ·.*Пройдено/ })).toBeVisible();
});

test('touch-sized labels and the area next to the pipe both respond', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Начать первый урок' }).click();
  await page.getByRole('button', { name: 'Запустить воду' }).click();
  const diagram = page.getByRole('region', { name: 'Схема пути воды' });
  const label = diagram.getByRole('button', { name: 'Подача на схеме' });
  await expect(label).toBeEnabled();
  const supply = diagram.locator('[data-link="supply"]');
  const clickPoint = await supply.evaluate((element) => {
    const path = element as unknown as SVGPathElement;
    const point = path.getPointAtLength(path.getTotalLength() * .67).matrixTransform(path.getScreenCTM()!);
    return { x: point.x, y: point.y + 8 };
  });
  await page.mouse.click(clickPoint.x, clickPoint.y);
  await expect(supply).toHaveClass(/lesson-identified/);
  await diagram.getByRole('button', { name: 'Петля пола на схеме' }).click();
  await expect(diagram.getByRole('status')).toContainText('отдаёт тепло');
  await diagram.getByRole('button', { name: 'Обратка на схеме' }).click();
  await expect(page.getByText('Урок пройден.', { exact: true })).toBeVisible();
});

test('the same guide is available from the lesson library without revealing the assessed rubric', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^L01 ·/ }).click();
  await expect(page.getByRole('region', { name: 'Следующий шаг' })).toBeVisible();
  await page.getByRole('button', { name: '← К заданиям' }).click();
  await page.getByRole('button', { name: /^L15 ·/ }).click();
  await expect(page.getByRole('region', { name: 'Следующий шаг' })).toHaveCount(0);
  await expect(page.getByText('После сдачи откроются оценка и разбор.')).toBeVisible();
});
