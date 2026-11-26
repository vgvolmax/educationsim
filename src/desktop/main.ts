import { appendFileSync, mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { app, BrowserWindow, protocol, session, shell } from 'electron';
import { appUrl, isProductUrl } from './policy';
import { installAppProtocol } from './protocol';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

app.setName('EducationSim');
const testProfile = process.env.EDUCATIONSIM_TEST_PROFILE;
const useTestProfile = Boolean(testProfile && isAbsolute(testProfile));
const profile = useTestProfile && testProfile
  ? testProfile
  : join(app.getPath('appData'), app.isPackaged ? 'EducationSim' : 'EducationSim-dev');
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);
function log(event: string): void {
  try {
    appendFileSync(join(profile, 'startup.log'), JSON.stringify({
      at: new Date().toISOString(), version: app.getVersion(), event,
    }) + '\n');
  } catch (error) {
    console.error('EducationSim startup log unavailable', error);
  }
}

let window: BrowserWindow | undefined;
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on('window-all-closed', () => app.quit());

  void app.whenReady().then(async () => {
    log('start');
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    if (useTestProfile && process.env.EDUCATIONSIM_TEST_OFFLINE === '1') {
      // Block HTTP(S) before navigation. navigator.onLine reports network-interface
      // state and is not evidence that packaged resources can run without requests.
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['http://*/*', 'https://*/*'] },
        (_details, callback) => callback({ cancel: true }),
      );
    }

    const devUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL;
    if (!devUrl) installAppProtocol(join(__dirname, '../renderer', MAIN_WINDOW_VITE_NAME));

    window = new BrowserWindow({
      title: 'EducationSim', width: 1200, height: 800,
      backgroundColor: '#f5f1e8',
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    window.on('closed', () => { window = undefined; });
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-redirect', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isProductUrl(url)) void shell.openExternal(url).catch(() => log('external-link-failed'));
      return { action: 'deny' };
    });
    await window.loadURL(devUrl || appUrl);
    log('renderer-loaded');
  }).catch((error: unknown) => {
    log('startup-failed');
    console.error(error);
    app.exit(1);
  });
}
