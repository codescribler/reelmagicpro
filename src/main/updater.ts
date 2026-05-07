import { app, dialog, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

export function initAutoUpdater(getWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err?.message ?? err);
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update-available', info?.version);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] up to date');
  });

  autoUpdater.on('download-progress', (p) => {
    const win = getWindow();
    if (win) win.setProgressBar(p.percent / 100);
  });

  autoUpdater.on('update-downloaded', async (info) => {
    const win = getWindow();
    if (win) win.setProgressBar(-1);
    const { response } = await dialog.showMessageBox(win ?? undefined as never, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `ReelMagic ${info.version} has been downloaded.`,
      detail: 'Restart the app to finish installing the update.',
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[updater] check failed:', err?.message ?? err);
  });
}
