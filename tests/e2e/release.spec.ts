import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readWorkspace } from '../../src/storage/project-transfer';
import { replay } from '../../src/simulation/replay';

const bench = resolve('tests/fixtures/projects/benchmark-large.json');
const prepare = (page: Page) => page.getByRole('button', { name: 'Подготовить прогон' }).click();
const step = (page: Page) => page.getByRole('button', { name: 'Один шаг расчёта' }).click();

test('assembles_edits_runs_saves_imports_and_replays_large_project', async ({ page }) => {
  test.setTimeout(55_000);
  await page.goto('/');
  await page.getByLabel('Импорт проекта JSON').setInputFiles(bench);
  await page.getByRole('button', { name: 'Открыть отдельную копию' }).click();
  await expect(page.locator('[data-room]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Стенд 1, помещение 1', exact: true }).click();
  await page.getByLabel('Ширина, м').fill('7,2');
  await page.getByRole('button', { name: 'Применить размеры' }).click();
  await expect(page.getByText('Редакция 1')).toBeVisible();
  await prepare(page);
  await step(page);
  await expect(page.locator('[data-meter="link:g0-loop-0"]')).toHaveText(/[1-9].*л\/мин/);
  await page.getByRole('button', { name: 'Зафиксировать А' }).click();
  await page.getByLabel('Ширина, м').fill('7,3');
  await page.getByRole('button', { name: 'Применить размеры' }).click();
  await expect(page.getByText('Редакция 2')).toBeVisible();
  await prepare(page); await step(page);
  await page.getByRole('button', { name: 'Зафиксировать Б' }).click();
  await page.getByRole('button', { name: 'Сохранить запись прогона' }).click();
  await expect(page.getByText('Сохранённых записей: 1')).toBeVisible();
  await expect(page.getByText('Проект сохранён локально.')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Открыть последний сохранённый проект' }).click();
  await expect(page.getByText('Редакция 2')).toBeVisible();
  await expect(page.getByText(/А: редакция 1, тик 1. Б: редакция 2, тик 1./)).toBeVisible();
  await page.getByRole('button', { name: 'Файлы и имя проекта' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт проекта и прогонов' }).click();
  const text = await readFile((await (await download).path())!, 'utf8');
  const decoded = readWorkspace(text);
  if (!decoded.ok) throw new Error(JSON.stringify(decoded.diagnostics));
  expect(decoded.value.project).toMatchObject({ revision: 2 });
  expect(decoded.value.project.rooms).toHaveLength(12);
  expect(decoded.value.project.components).toHaveLength(220);
  expect(decoded.value.project.hydronicLinks).toHaveLength(400);
  expect(decoded.value.project.loopRoutes).toHaveLength(48);
  const recovered = replay(decoded.value.records[0]!);
  if (!recovered.ok) throw new Error(JSON.stringify(recovered.diagnostics));
  expect(recovered.value.snapshot.hydraulics?.channels['link:g0-loop-0']?.flowM3s).toBeGreaterThan(0);
  await page.getByLabel('Импорт проекта JSON').setInputFiles({
    name: 'Нагрузка с доказательствами.json', mimeType: 'application/json', buffer: Buffer.from(text),
  });
  await page.getByRole('button', { name: 'Открыть отдельную копию' }).click();
  await expect(page.getByRole('heading', { name: / · копия · копия$/ })).toBeVisible();
  await expect(page.getByText(/А: редакция 1, тик 1. Б: редакция 2, тик 1./)).toBeVisible();
  await expect(page.getByText('Сохранённых записей: 1')).toBeVisible();
});

test('catalog training provenance survives reopening without overriding a real profile', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Прямое подключение: две петли' }).click();
  await page.getByRole('button', { name: 'Газовый котёл · source' }).click();
  await page.getByRole('button', { name: 'Каталог ВОЛМАКС', exact: true }).click();
  await page.getByLabel('Поиск по артикулу, ID или названию').fill('7814104');
  await page.getByLabel('Контекст каталога').selectOption('heating');
  await page.getByTestId('offer-34039').click();
  await page.getByRole('button', { name: 'Предпросмотр замены из каталога' }).click();
  await page.getByRole('button', { name: 'Применить учебную замену' }).click();
  await expect(page.getByText('Проект сохранён локально.')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Открыть последний сохранённый проект' }).click();
  await page.getByRole('button', { name: 'Газовый котёл · source' }).click();
  await expect(page.getByText(/Учебный аналог из каталога · volmax-public-20261126-v1.*7814104/)).toBeVisible();
  await prepare(page); await step(page);
  await expect(page.locator('[data-meter="link:pipe-a"]')).toHaveText(/[1-9].*л\/мин/);
});
