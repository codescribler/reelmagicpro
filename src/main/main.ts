import { app, BrowserWindow } from 'electron';
import path from 'path';
import { registerIpc, abortAllExports } from './ipc';
import { registerLicenceIpc } from './licence/ipc';
import { licenceManager } from './licence/manager';
import { initAutoUpdater } from './updater';

let mainWindow: BrowserWindow | null = null;
let quitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    // dev path: dist-electron/main/main.js → ../../build/icon.png
    // packaged: electron-builder copies build/icon.png into resources/, and
    // app.getAppPath() lands at the asar root, so the same relative path works.
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
}

app.whenReady().then(() => {
  registerIpc(() => mainWindow);
  registerLicenceIpc(() => mainWindow);
  createWindow();
  initAutoUpdater(() => mainWindow);
  // Kick off the licence gate without blocking window creation. The renderer
  // shows an "initialising" splash until it gets the first state update.
  void licenceManager.init();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  licenceManager.dispose();
  abortAllExports().finally(() => app.exit(0));
});
