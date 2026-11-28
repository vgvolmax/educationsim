import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function open(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Прямое подключение: две петли' }).click();
  await page.getByRole('button', { name: 'Каталог ВОЛМАКС', exact: true }).click();
}
async function find(page: Page, query: string, id: string) {
  await page.getByLabel('Поиск по артикулу, ID или названию').fill(query);
  await page.getByTestId('offer-' + id).click();
}
test('catalog_uses_bundled_release_on_first_start and searches_by_product_or_shop_sku', async ({ page }) => {
  await open(page);
  await expect(page.getByText('Версия: volmax-public-20261126-v1')).toBeVisible();
  await find(page, '35495', '35495');
  await expect(page.getByText('Ограничитель температуры теплоносителя GAPPO G1495')).toBeVisible();
  await expect(page.getByText('Для этой позиции пока нет учебной 3D-модели.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Разместить на сцене' })).toHaveCount(0);
  await find(page, 'G1494', '35494');
  await expect(page.getByText('Монтажный термоблок GAPPO G1494')).toBeVisible();
});
test('a catalog analogue can attach to an equivalent mounted source, keep its links and run', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Газовый котёл · source' }).click();
  await page.getByLabel('Контекст каталога').selectOption('heating');
  await find(page, '7814104', '34039');
  await page.getByRole('button', { name: 'Предпросмотр замены из каталога' }).click();
  await expect(page.getByText(/Связей сохранится: 2/)).toBeVisible();
  await page.getByRole('button', { name: 'Применить учебную замену' }).click();
  await expect(page.locator('[data-link]')).toHaveCount(4);
  await expect(page.getByText(/Учебный аналог из каталога · volmax-public-20261126-v1/)).toBeVisible();
  await page.getByRole('button', { name: 'Подготовить прогон' }).click();
  await page.getByRole('button', { name: 'Один шаг расчёта' }).click();
  await expect(page.locator('[data-meter="link:pipe-a"]')).toContainText(/^[1-9]/);
});
test('the section filters automatically and the actual reported angle valve has a usable 3D model', async ({ page }) => {
  await open(page);
  const query = page.getByLabel('Поиск по артикулу, ID или названию');
  const context = page.getByLabel('Контекст каталога');
  await expect(page.getByLabel('Только этот контекст')).toHaveCount(0);
  await query.fill('212122B');
  await context.selectOption('floor');
  await expect(page.getByTestId('offer-36893')).toHaveCount(0);
  await context.selectOption('radiator');
  await page.getByTestId('offer-36893').click();
  const preview = page.getByRole('img', { name: 'Учебная 3D-модель: Угловой радиаторный клапан' });
  await expect(preview).toHaveAttribute('data-model-ready', 'training-radiator-angle-valve');
  await expect(page.getByRole('heading', { name: 'Назначение', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Что проверить перед подбором' })).toBeVisible();
  await page.getByRole('button', { name: 'Разместить на сцене' }).click();
  const placement = page.getByRole('region', { name: 'Размещение детали' });
  await expect(placement).toContainText('В руке: Угловой радиаторный клапан');
  await expect(page.getByRole('button', { name: /^Угловой радиаторный клапан · catalog-/ })).toHaveCount(0);
  const canvas = page.locator('canvas[data-scene]');
  await canvas.scrollIntoViewIfNeeded();
  const rect = (await canvas.boundingBox())!;
  const point = { x: rect.width * .62, y: rect.height * .58 };
  await canvas.hover({ position: point });
  await expect(canvas).toHaveAttribute('data-placement', 'ready');
  await page.keyboard.press('r');
  await canvas.click({ position: point });
  await expect(placement).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Угловой радиаторный клапан · catalog-/ })).toBeVisible();
  await expect(page.getByText('Редакция 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Переместить деталь' }).click();
  const newPoint = { x: rect.width * .43, y: rect.height * .64 };
  await canvas.hover({ position: newPoint });
  await expect(canvas).toHaveAttribute('data-placement', 'ready');
  await canvas.click({ position: newPoint });
  await expect(page.getByText('Деталь перемещена.')).toBeVisible();
  await expect(page.getByText('Редакция 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Угловой радиаторный клапан · catalog-/ })).toBeVisible();
});
test('ambiguous_bundle_shows_source_and_requires_sales_confirmation', async ({ page }) => {
  await open(page);
  const id = await page.getByTestId('catalog-panel').getAttribute('data-active-release');
  expect(id).toMatch(/volmax-public/);
  await page.getByLabel('Поиск по артикулу, ID или названию').fill('17052-04eco');
  await page.getByRole('button', { name: /17052-04eco/i }).click();
  await expect(page.getByText(/Перед продажей требуется подтвердить фактический состав/)).toBeVisible();
  await expect(page.getByText(/29352.*8 шт\./)).toBeVisible();
  await expect(page.getByText(/39511.*2 шт\./)).toHaveCount(0);
});
test('local_catalog_update_is_atomic_and_survives_restart', async ({ page }) => {
  await page.setViewportSize({ width: 1008, height: 681 });
  await open(page);
  const payload = { version: 1, releaseId: 'local-test', publishedOn: '2026-11-26',
    offers: [], products: [], kits: [] };
  await page.getByText('Локальное обновление', { exact: true }).click();
  const upload = page.getByLabel('Файл обновления каталога');
  await upload.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"version":99}') });
  await expect(page.getByText('Обновление отклонено.')).toBeVisible();
  await expect(page.getByText('Версия: volmax-public-20261126-v1')).toBeVisible();
  await upload.setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
  await expect(page.getByText('Подготовлен выпуск local-test.')).toBeVisible();
  await expect(page.getByText('Версия: volmax-public-20261126-v1')).toBeVisible();
  await page.getByRole('button', { name: 'Активировать выпуск' }).click();
  await expect(page.getByText('Версия: local-test')).toBeVisible();
  await page.getByRole('button', { name: 'Добавить комнату' }).click();
  await expect(page.locator('[data-room]')).toHaveCount(2);
  await open(page);
  await expect(page.getByText('Версия: local-test')).toBeVisible();
});

test('changes active catalog without deleting either saved release and preserves the choice across restart', async ({ page }) => {
  await open(page);
  const data = { version: 1, releaseId: 'local-reference-rollback', publishedOn: '2026-11-26', offers: [], products: [], kits: [] };
  await page.getByText('Локальное обновление', { exact: true }).click();
  await page.getByLabel('Файл обновления каталога').setInputFiles({
    name: 'reference.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.getByRole('button', { name: 'Активировать выпуск' }).click();
  await expect(page.getByText('Версия: local-reference-rollback')).toBeVisible();
  const release = page.getByLabel('Архив выпусков');
  const select = page.getByRole('button', { name: 'Переключить выпуск' });
  await expect(release).toBeVisible();
  await release.selectOption('embedded');
  await select.click();
  await expect(page.getByText('Версия: volmax-public-20261126-v1')).toBeVisible();
  await open(page);
  await expect(page.getByText('Версия: volmax-public-20261126-v1')).toBeVisible();
  await page.getByText('Локальное обновление', { exact: true }).click();
  await release.selectOption('saved:local-reference-rollback');
  await select.click();
  await expect(page.getByText('Версия: local-reference-rollback')).toBeVisible();
  await open(page);
  await expect(page.getByText('Версия: local-reference-rollback')).toBeVisible();
});
