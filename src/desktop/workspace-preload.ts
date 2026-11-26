import { contextBridge, ipcRenderer } from 'electron';
import type { WorkspaceDesktop } from '../storage/desktop-api';

const bridge: WorkspaceDesktop = {
  onPrepareClose(listener) {
    if (typeof listener !== 'function') throw new TypeError('Expected a workspace close listener');
    const receive = (_event: Electron.IpcRendererEvent, token: unknown) => {
      if (typeof token === 'string') listener(token);
    };
    ipcRenderer.on('workspace:prepare-close', receive);
    return () => ipcRenderer.removeListener('workspace:prepare-close', receive);
  },
  finishClose(token, ready) {
    if (typeof token === 'string' && typeof ready === 'boolean') ipcRenderer.send('workspace:finish-close', token, ready);
  },
  async exportJson(text) {
    if (typeof text !== 'string' || text.length > 12 * 1024 * 1024) return 'failed';
    const result: unknown = await ipcRenderer.invoke('workspace:export', text);
    return result === 'saved' || result === 'cancelled' ? result : 'failed';
  },
};
contextBridge.exposeInMainWorld('educationWorkspace', bridge);
