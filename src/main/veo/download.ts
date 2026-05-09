import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { extractVeoVideoUrl, extractPageTitle, sanitizeFilename, stripSiteSuffix } from './parse';
import { probeVideo } from '../ffmpeg/probe';
import type { VeoDownloadProgress, VeoDownloadResult } from '../../shared/types';

// Two-phase fetch: GET the page, regex out the .mp4 URL, then stream the
// video to ~/Downloads with periodic progress events. The whole flow is
// cancellable via the AbortSignal — both the page fetch and the video
// stream are torn down when it fires.
export async function downloadVeoVideo(opts: {
  runId: string;
  url: string;
  onProgress: (p: VeoDownloadProgress) => void;
  signal: AbortSignal;
}): Promise<VeoDownloadResult> {
  const { runId, url, onProgress, signal } = opts;

  const emit = (p: Partial<VeoDownloadProgress> & Pick<VeoDownloadProgress, 'phase'>) =>
    onProgress({
      runId,
      bytesDownloaded: 0,
      totalBytes: null,
      percent: 0,
      ...p,
    });

  try {
    emit({ phase: 'fetching-page' });
    const html = await fetchText(url, signal);
    if (signal.aborted) return { ok: false, error: 'cancelled' };

    const videoUrl = extractVeoVideoUrl(html);
    if (!videoUrl) {
      return {
        ok: false,
        error:
          'Could not find a video URL on this page. Is this a public Veo match link with a downloadable recording?',
      };
    }

    const titleRaw = extractPageTitle(html);
    const cleaned = titleRaw ? sanitizeFilename(stripSiteSuffix(titleRaw)) : '';
    const baseName = cleaned.length > 0 ? cleaned : `veo-${Date.now()}`;
    const downloadsDir = app.getPath('downloads');
    const targetPath = uniqueFilename(path.join(downloadsDir, `${baseName}.mp4`));

    emit({ phase: 'downloading' });
    await downloadToFile(videoUrl, targetPath, signal, (loaded, total) => {
      const percent = total ? Math.round((loaded / total) * 100) : 0;
      emit({ phase: 'downloading', bytesDownloaded: loaded, totalBytes: total, percent });
    });
    if (signal.aborted) {
      // downloadToFile cleans up on abort; nothing more to do.
      return { ok: false, error: 'cancelled' };
    }

    emit({ phase: 'probing', percent: 100 });
    const source = await probeVideo(targetPath);
    return { ok: true, source, path: targetPath };
  } catch (e: any) {
    if (signal.aborted) return { ok: false, error: 'cancelled' };
    return { ok: false, error: e?.message ?? String(e) };
  }
}

function fetchText(url: string, signal: AbortSignal, redirects = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      { headers: { 'user-agent': 'Mozilla/5.0 ReelMagic' } },
      res => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          fetchText(next, signal, redirects - 1).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`HTTP ${status} fetching page`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    const onAbort = () => req.destroy(new Error('cancelled'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

function downloadToFile(
  url: string,
  target: string,
  signal: AbortSignal,
  onProgress: (loaded: number, total: number | null) => void,
  redirects = 5,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    let file: fs.WriteStream | null = null;
    let cleanedUp = false;
    const cleanup = (err?: Error) => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (file) file.destroy();
      fs.promises.unlink(target).catch(() => {});
      if (err) reject(err);
    };

    const req = lib.get(
      url,
      { headers: { 'user-agent': 'Mozilla/5.0 ReelMagic' } },
      res => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          downloadToFile(next, target, signal, onProgress, redirects - 1).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`HTTP ${status} downloading video`));
          return;
        }

        const total = res.headers['content-length']
          ? Number(res.headers['content-length'])
          : null;
        let loaded = 0;
        file = fs.createWriteStream(target);

        res.on('data', c => {
          loaded += c.length;
          onProgress(loaded, total);
        });
        res.on('error', err => cleanup(err));
        file.on('error', err => cleanup(err));
        file.on('finish', () => {
          if (cleanedUp) return;
          cleanedUp = true;
          resolve();
        });
        res.pipe(file);
      },
    );
    req.on('error', err => cleanup(err));

    const onAbort = () => {
      req.destroy(new Error('cancelled'));
      cleanup(new Error('cancelled'));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

function uniqueFilename(p: string): string {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p);
  const base = p.slice(0, p.length - ext.length);
  for (let i = 2; i < 1000; i++) {
    const cand = `${base} (${i})${ext}`;
    if (!fs.existsSync(cand)) return cand;
  }
  return p;
}
