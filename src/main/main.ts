import { app, BrowserWindow } from 'electron';
import path from 'path';
import { registerIpc, abortAllExports } from './ipc';

let mainWindow: BrowserWindow | null = null;
let quitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
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
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  abortAllExports().finally(() => app.exit(0));
});
