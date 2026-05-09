import { BrowserWindow, ipcMain, shell } from 'electron';
import type { LicenceState } from '../../shared/types';
import { ACCOUNT_URL } from './config';
import { licenceManager } from './manager';

export function registerLicenceIpc(getWindow: () => BrowserWindow | null): () => void {
  const send = (s: LicenceState) => {
    getWindow()?.webContents.send('app:licence:state', s);
  };
  const unsubscribe = licenceManager.subscribe(send);

  ipcMain.handle('app:licence:getState', (): LicenceState => licenceManager.getState());
  ipcMain.handle('app:licence:startActivation', async () => {
    void licenceManager.startActivation();
    return { ok: true };
  });
  ipcMain.handle('app:licence:cancelActivation', async () => {
    await licenceManager.cancelActivation();
    return { ok: true };
  });
  ipcMain.handle('app:licence:recheck', async () => {
    await licenceManager.recheck();
    return { ok: true };
  });
  ipcMain.handle('app:licence:signOut', async () => {
    await licenceManager.signOut();
    return { ok: true };
  });
  ipcMain.handle('app:licence:openAccountPage', async () => {
    await shell.openExternal(ACCOUNT_URL);
    return { ok: true };
  });

  return unsubscribe;
}
