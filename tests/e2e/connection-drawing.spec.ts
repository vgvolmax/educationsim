import { expect, test } from '@playwright/test';

test('supply, return and a not-yet-traced collector loop remain distinct on the drawing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый проект', exact: true }).click();
  const mount = page.getByRole('button', { name: 'Установить', exact: true });
  await mount.click();
  await page.getByLabel('Учебное оборудование').selectOption('training-manifold-two-way');
  await mount.click();
  const guide = page.getByRole('region', { name: 'Соединение элементов' });
  await page.getByRole('button', { name: /^Газовый котёл · mount-/ }).click();
  await guide.getByRole('button', { name: /^Подача/ }).click();
  await guide.getByRole('button', { name: /коллектор.*Вход подачи/i }).click();
  await page.getByRole('button', { name: /^Пара коллекторов.* · mount-/ }).click();
  await guide.getByRole('button', { name: /^Обратка ·/ }).click();
  await guide.getByRole('button', { name: /Газовый котёл · Обратка$/i }).click();
  await guide.getByRole('button', { name: /^Подача петли 1/ }).click();
  await guide.getByRole('button', { name: /Обратка петли 1$/ }).click();
  const links = page.locator('polyline.plan-link.water');
  await expect(links).toHaveCount(3);
  const paths = await links.evaluateAll((els) => (els as SVGPolylineElement[]).map((el) => {
    const points = [...el.points].map(({ x, y }) => x + ',' + y).filter((point, i, all) => point !== all[i - 1]);
    return { key: [points.join(' '), points.reverse().join(' ')].sort()[0], length: el.getTotalLength() };
  }));
  expect(new Set(paths.map(({ key }) => key)).size).toBe(3);
  expect(paths.every(({ length }) => length > 0)).toBe(true);
  const list = page.getByRole('region', { name: 'Монтаж и свойства' });
  await expect(list.getByText('Газовый котёл · Подача → Пара коллекторов с расходомерами · Вход подачи')).toBeVisible();
  await expect(list.getByText('Пара коллекторов с расходомерами · Подача петли 1 → Пара коллекторов с расходомерами · Обратка петли 1')).toBeVisible();
});
