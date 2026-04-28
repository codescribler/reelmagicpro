import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'fs/promises';
import { probeVideo } from './ffmpeg/probe';
import { exportClip, exportSequence } from './ffmpeg/exporter';
import { saveProject, loadProject } from './project/io';
import type {
  OpenSourceVideoResult, SaveProjectArgs, SaveProjectResult,
  LoadProjectResult, ExportClipArgs, ExportSequenceArgs, ExportProgress,
} from '../shared/types';

// Maps runId → { ctrl, finished } — finished is the IPC handler's promise so we
// can await it on quit-time abort.
const activeRuns = new Map<string, { ctrl: AbortController; finished: Promise<unknown> }>();

export async function abortAllExports(): Promise<void> {
  const all = Array.from(activeRuns.values());
  for (const { ctrl } of all) ctrl.abort();
  await Promise.allSettled(all.map(r => r.finished));
  activeRuns.clear();
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const sendProgress = (p: ExportProgress) => getWindow()?.webContents.send('app:exportProgress', p);

  ipcMain.handle('app:openSourceVideo', async (): Promise<OpenSourceVideoResult> => {
    const win = getWindow();
    if (!win) return { source: null };
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { source: null };
    try {
      const source = await probeVideo(result.filePaths[0]);
      return { source };
    } catch (e: any) {
      return { source: null, error: e?.message ?? String(e) };
    }
  });

  ipcMain.handle('app:saveProject', async (_e, args: SaveProjectArgs): Promise<SaveProjectResult> => {
    const win = getWindow();
    let target = args.suggestedPath;
    if (!target) {
      if (!win) return { ok: false };
      const r = await dialog.showSaveDialog(win, {
        filters: [{ name: 'ReelMagic Project', extensions: ['rmproj'] }],
      });
      if (r.canceled || !r.filePath) return { ok: false };
      target = r.filePath;
    }
    try {
      await saveProject(args.project, target);
      return { ok: true, path: target };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  });

  ipcMain.handle('app:loadProject', async (): Promise<LoadProjectResult> => {
    const win = getWindow();
    if (!win) return { ok: false, error: 'No window' };
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'ReelMagic Project', extensions: ['rmproj', 'json'] }],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    try {
      const result = await loadProject(r.filePaths[0]);
      return {
        ok: true,
        path: r.filePaths[0],
        project: result.project,
        warnings: result.warnings,
        invalidClipIds: result.invalidClipIds,
      };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  });

  ipcMain.handle('app:exportClip', async (_e, args: ExportClipArgs) => {
    const ctrl = new AbortController();
    const work = (async () => {
      try {
        return await exportClip({
          runId: args.runId, clip: args.clip, source: args.source, outputPath: args.outputPath,
          onProgress: sendProgress, signal: ctrl.signal,
        });
      } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) };
      } finally {
        activeRuns.delete(args.runId);
      }
    })();
    activeRuns.set(args.runId, { ctrl, finished: work });
    return work;
  });

  ipcMain.handle('app:exportSequence', async (_e, args: ExportSequenceArgs) => {
    const ctrl = new AbortController();
    const work = (async () => {
      try {
        return await exportSequence({
          runId: args.runId, clips: args.clips, sequence: args.sequence,
          source: args.source, outputPath: args.outputPath,
          onProgress: sendProgress, signal: ctrl.signal,
        });
      } catch (e: any) {
        return { ok: false, error: e?.message ?? String(e) };
      } finally {
        activeRuns.delete(args.runId);
      }
    })();
    activeRuns.set(args.runId, { ctrl, finished: work });
    return work;
  });

  ipcMain.handle('app:cancelExport', async (_e, runId: string) => {
    const entry = activeRuns.get(runId);
    if (entry) entry.ctrl.abort();
    return { ok: true };
  });

  ipcMain.handle('app:checkPath', async (_e, p: string) => {
    try { await fs.access(p); return { exists: true }; }
    catch { return { exists: false }; }
  });

  ipcMain.handle('app:chooseExportPath', async (_e, suggestedName: string) => {
    const win = getWindow();
    if (!win) return { ok: false };
    const r = await dialog.showSaveDialog(win, {
      defaultPath: suggestedName,
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false };
    return { ok: true, path: r.filePath };
  });
}
