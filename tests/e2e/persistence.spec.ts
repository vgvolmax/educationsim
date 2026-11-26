import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('restart_reopens_last_committed_revision with the exact origin project', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый проект', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить комнату' }).click();
  await expect(page.getByText('Проект сохранён локально.')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Открыть последний сохранённый проект' }).click();
  await expect(page.getByText('Редакция 1')).toBeVisible();
  await expect(page.locator('[data-room]')).toHaveCount(1);
});

test('export_import_preserves_two_revisions_and_run_results without overwriting the current project', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Прямое подключение: две петли' }).click();
  await page.getByRole('button', { name: 'Подготовить прогон' }).click();
  await page.getByRole('button', { name: 'Один шаг' }).click();
  await page.getByRole('button', { name: 'Зафиксировать А' }).click();
  await page.getByRole('button', { name: 'Зафиксировать Б' }).click();
  await page.getByRole('button', { name: 'Сохранить запись прогона' }).click();
  await expect(page.getByText('Сохранённых записей: 1')).toBeVisible();
  const recorded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт проекта и прогонов' }).click();
  const file = await recorded;
  const binary = await readFile((await file.path())!);
  const decoded = JSON.parse(binary.toString('utf8'));
  expect(decoded).toMatchObject({ version: 2, captures: { a: { tick: 1 }, b: { tick: 1 } }, records: [{ untilTick: 1 }] });
  const picker = page.getByLabel('Импорт проекта JSON');
  await picker.setInputFiles({ name: 'future.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"educationsim-workspace","version":99}') });
  await expect(page.getByText('Импорт не выполнен.')).toBeVisible();
  await expect(page.locator('[data-link]')).toHaveCount(4);
  await picker.setInputFiles({ name: 'from-export.json', mimeType: 'application/json', buffer: binary });
  await page.getByRole('button', { name: 'Открыть отдельную копию' }).click();
  await expect(page.getByRole('heading', { name: /Прямое подключение: две петли · копия/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Сравнение А и Б' })).toBeVisible();
  await expect(page.getByText('Сохранённых записей: 1')).toBeVisible();
});

test('failed_close_save_offers_retry_or_export without falsely acknowledging close', async ({ page }) => {
  await page.addInitScript(() => {
    const official = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function(name, version) {
      if (document.body?.dataset.testQuota === 'blocked' && name === 'educationsim-workspaces') throw new DOMException('Quota', 'QuotaExceededError');
      return official.call(this, name, version);
    };
    window.educationWorkspace = {
      onPrepareClose(handler) {
        const f = () => handler('test-request');
        window.addEventListener('test-close-request', f);
        return () => window.removeEventListener('test-close-request', f);
      },
      finishClose(token, ready) { document.body.dataset.closeResult = token + ':' + ready; },
      exportJson: () => Promise.resolve('cancelled'),
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Новый проект', exact: true }).click();
  await expect(page.getByText('Проект сохранён локально.')).toBeVisible();
  await page.evaluate(() => { document.body.dataset.testQuota = 'blocked'; });
  await page.getByRole('button', { name: 'Добавить комнату' }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('test-close-request')));
  await expect(page.locator('body')).toHaveAttribute('data-close-result', 'test-request:false');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Экспортировать и оставить окно' })).toBeVisible();
  await page.evaluate(() => { delete document.body.dataset.testQuota; });
  await page.getByRole('button', { name: 'Повторить и закрыть' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-close-result', 'test-request:true');
  await expect(page.getByText('Проект сохранён локально.')).toBeVisible();
});
