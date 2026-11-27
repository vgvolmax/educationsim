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
  await expect(page.getByText('Учебная карточка. Не используйте её как рекомендацию к покупке.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Установить учебный аналог' })).toHaveCount(0);
  await find(page, 'G1494', '35494');
  await expect(page.getByText('Монтажный термоблок GAPPO G1494')).toBeVisible();
});
test('a catalog analogue can attach to an equivalent mounted source, keep its links and run', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Газовый котёл · source' }).click();
  await find(page, '7814104', '34039');
  await page.getByLabel('Контекст каталога').selectOption('heating');
  await page.getByRole('button', { name: 'Предпросмотр замены из каталога' }).click();
  await expect(page.getByText(/Связей сохранится: 2/)).toBeVisible();
  await page.getByRole('button', { name: 'Применить учебную замену' }).click();
  await expect(page.locator('[data-link]')).toHaveCount(4);
  await expect(page.getByText(/Учебный аналог из каталога · volmax-public-20261126-v1/)).toBeVisible();
  await page.getByRole('button', { name: 'Подготовить прогон' }).click();
  await page.getByRole('button', { name: 'Один шаг' }).click();
  await expect(page.locator('[data-meter="link:pipe-a"]')).toContainText(/^[1-9]/);
});
test('radiator valve is blocked in a floor loop but available in radiator context', async ({ page }) => {
  await open(page);
  await find(page, 'G262.04', '35285');
  const install = page.getByRole('button', { name: 'Установить учебный аналог' });
  await expect(install).toBeDisabled();
  await expect(page.getByText(/Не подходит для выбранного контекста/)).toBeVisible();
  await page.getByLabel('Контекст каталога').selectOption('radiator');
  await expect(install).toBeEnabled();
  await install.click();
  await expect(page.getByRole('button', { name: /^Шаровой кран · catalog-/ })).toBeVisible();
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
  await open(page);
  const payload = { version: 1, releaseId: 'local-test', publishedOn: '2026-11-26',
    offers: [], products: [], kits: [] };
  const upload = page.getByLabel('Файл обновления каталога');
  await upload.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"version":99}') });
  await expect(page.getByText('Обновление отклонено.')).toBeVisible();
  await expect(page.getByText('Версия: volmax-public-20261126-v1')).toBeVisible();
  await upload.setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
  await expect(page.getByText('Подготовлен выпуск local-test.')).toBeVisible();
  await expect(page.getByText('Версия: volmax-public-20261126-v1')).toBeVisible();
  await page.getByRole('button', { name: 'Активировать выпуск' }).click();
  await expect(page.getByText('Версия: local-test')).toBeVisible();
  await open(page);
  await expect(page.getByText('Версия: local-test')).toBeVisible();
});

test('changes active catalog without deleting either saved release and preserves the choice across restart', async ({ page }) => {
  await open(page);
  const data = { version: 1, releaseId: 'local-reference-rollback', publishedOn: '2026-11-26', offers: [], products: [], kits: [] };
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
  await release.selectOption('saved:local-reference-rollback');
  await select.click();
  await expect(page.getByText('Версия: local-reference-rollback')).toBeVisible();
  await open(page);
  await expect(page.getByText('Версия: local-reference-rollback')).toBeVisible();
});
