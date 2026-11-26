import { dialog, ipcMain } from 'electron';
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const limit = 12 * 1024 * 1024;
export function attachWorkspaceBridge(window: BrowserWindow, rendererUrl: string) {
  const allowed = new URL(rendererUrl).href;
  const isRenderer = (event: IpcMainEvent | IpcMainInvokeEvent) => event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === allowed;
  let allowClose = false, pending = '', waiting: ReturnType<typeof setTimeout> | undefined;
  function done() { allowClose = true; pending = ''; clearTimeout(waiting); window.close(); }
  function receive(event: IpcMainEvent, token: unknown, ready: unknown) {
    if (!isRenderer(event) || token !== pending || !pending || typeof ready !== 'boolean') return;
    clearTimeout(waiting); waiting = undefined;
    if (ready) done();
  }
  ipcMain.on('workspace:finish-close', receive);
  ipcMain.handle('workspace:export', async (event, text: unknown) => {
    if (!isRenderer(event) || typeof text !== 'string' || text.length > limit || Buffer.byteLength(text) > limit) return 'failed';
    const answer = await dialog.showSaveDialog(window, { defaultPath: 'EducationSim-проект.json',
      filters: [{ name: 'Проект EducationSim', extensions: ['json'] }] });
    if (answer.canceled || !answer.filePath) return 'cancelled';
    const tmp = join(dirname(answer.filePath), '.' + basename(answer.filePath) + '-' + randomUUID() + '.tmp');
    try {
      await writeFile(tmp, text, { encoding: 'utf8', flag: 'wx' });
      await rename(tmp, answer.filePath);
      return 'saved';
    } catch { await unlink(tmp).catch(() => {}); return 'failed'; }
  });
  window.on('close', (event) => {
    if (allowClose || window.webContents.isDestroyed()) return;
    event.preventDefault();
    if (waiting) return;
    const token = randomUUID();
    pending = token;
    waiting = setTimeout(() => {
      void dialog.showMessageBox(window, { type: 'warning', title: 'EducationSim',
        message: 'Не удалось получить подтверждение сохранения.',
        detail: 'Редактор может сохранить не все изменения. Можно оставить окно и повторить.',
        buttons: ['Оставить окно', 'Закрыть без сохранения'], defaultId: 0, cancelId: 0 })
        .then(({ response }) => {
          if (pending !== token || window.isDestroyed()) return;
          waiting = undefined;
          if (response === 1) done();
        }).catch(() => { waiting = undefined; });
    }, 8000);
    window.webContents.send('workspace:prepare-close', token);
  });
  window.on('closed', () => {
    clearTimeout(waiting); ipcMain.removeListener('workspace:finish-close', receive);
    ipcMain.removeHandler('workspace:export');
  });
}
