import { app, shell } from 'electron';
import os from 'node:os';
import type { LicenceState, LicencePlatform, StoredLicence } from '../../shared/types';
import { LICENCE_RECHECK_INTERVAL_MS, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from './config';
import { checkLicence, pollOnce, requestActivation } from './api';
import {
  deleteLicence,
  getDeviceId,
  isStorageAvailable,
  readLicence,
  writeLicence,
} from './storage';

type Subscriber = (s: LicenceState) => void;

function detectPlatform(): LicencePlatform {
  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'win32') return 'win';
  return 'linux';
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('cancelled'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error('cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

class LicenceManager {
  private state: LicenceState = { kind: 'initialising' };
  private subscribers = new Set<Subscriber>();
  private activationAbort: AbortController | null = null;
  private recheckTimer: NodeJS.Timeout | null = null;
  private recheckInFlight = false;

  getState(): LicenceState {
    return this.state;
  }

  subscribe(cb: Subscriber): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  private setState(next: LicenceState): void {
    this.state = next;
    for (const cb of this.subscribers) {
      try {
        cb(next);
      } catch {
        // swallow — a bad subscriber must not break others
      }
    }
  }

  async init(): Promise<void> {
    if (!isStorageAvailable()) {
      this.setState({ kind: 'unsupported' });
      return;
    }
    const stored = await readLicence();
    if (!stored) {
      this.setState({ kind: 'needs_activation' });
      return;
    }
    if (Date.now() < stored.validUntil) {
      this.unlock(stored);
      void this.backgroundRecheck(stored);
      this.startRecheckTimer();
      return;
    }
    // Locally expired — must check synchronously.
    const result = await checkLicence(stored.token);
    if (result.kind === 'valid') {
      await writeLicence(result.record);
      this.unlock(result.record);
      this.startRecheckTimer();
      return;
    }
    if (result.kind === 'invalid') {
      await deleteLicence();
      this.setState({ kind: 'locked', reason: result.reason });
      return;
    }
    // network_error: keep stored token (it may still be valid once we're back
    // online), lock the UI in the meantime.
    this.setState({ kind: 'offline_locked' });
  }

  async startActivation(): Promise<void> {
    // Already activating? No-op — the renderer's existing state has the code.
    if (this.state.kind === 'activating') return;
    if (!isStorageAvailable()) {
      this.setState({ kind: 'unsupported' });
      return;
    }

    this.activationAbort?.abort();
    const ctrl = new AbortController();
    this.activationAbort = ctrl;

    // Show feedback immediately — fetching the activation code can take a
    // second or two and the user has just clicked a button.
    this.setState({ kind: 'requesting_activation' });

    let started: { code: string; activationUrl: string; expiresAt: number };
    try {
      const deviceId = await getDeviceId();
      started = await requestActivation(
        {
          deviceId,
          deviceName: os.hostname() || 'Unknown device',
          platform: detectPlatform(),
          appVersion: app.getVersion(),
        },
        ctrl.signal,
      );
    } catch (err) {
      // §6.6: don't begin polling on a failed request. Drop back to the
      // needs_activation state with the error surfaced so the user (and
      // support) can see what went wrong.
      const message = err instanceof Error ? err.message : String(err);
      console.error('[licence] activation request failed:', message);
      this.setState({ kind: 'needs_activation', error: message });
      this.activationAbort = null;
      return;
    }

    void shell.openExternal(started.activationUrl).catch(() => {
      // best effort — the user can paste the URL manually if needed
    });
    this.setState({
      kind: 'activating',
      code: started.code,
      activationUrl: started.activationUrl,
      expiresAt: started.expiresAt,
    });

    try {
      const record = await this.runPollLoop(started.code, started.expiresAt, ctrl.signal);
      await writeLicence(record);
      this.unlock(record);
      this.startRecheckTimer();
    } catch {
      // Any failure from the poll loop (cancelled / expired / consumed /
      // unexpected) drops the user back on the activation screen. The doc's
      // §6.1 / §6.7 / §3.2 all converge on "show retry, run §3.1 again".
      this.setState({ kind: 'needs_activation' });
    } finally {
      if (this.activationAbort === ctrl) this.activationAbort = null;
    }
  }

  private async runPollLoop(
    code: string,
    serverExpiresAt: number,
    signal: AbortSignal,
  ): Promise<StoredLicence> {
    const deadline = Math.min(Date.now() + POLL_TIMEOUT_MS, serverExpiresAt);
    while (Date.now() < deadline) {
      if (signal.aborted) throw new Error('cancelled');
      try {
        const result = await pollOnce(code, signal);
        if (result.kind === 'claimed') {
          // Confirm validity + get refreshed token + validUntil.
          const checked = await checkLicence(result.token, signal);
          if (checked.kind === 'valid') return checked.record;
          if (checked.kind === 'invalid') throw new Error('expired');
          // network_error: fall through and retry the poll (server already
          // marked claim as consumed; next poll will say `consumed`, treated
          // as failure → restart). Doc §3.2 second bullet handles this.
        }
        if (result.kind === 'expired' || result.kind === 'consumed') {
          throw new Error('expired');
        }
        // pending — wait and retry
      } catch (err) {
        const msg = (err as Error)?.message;
        if (msg === 'cancelled' || msg === 'expired') throw err;
        // Network or transient — fall through to retry after the interval.
      }
      await sleep(POLL_INTERVAL_MS, signal);
    }
    throw new Error('expired');
  }

  async cancelActivation(): Promise<void> {
    this.activationAbort?.abort();
    this.activationAbort = null;
    if (this.state.kind === 'activating' || this.state.kind === 'requesting_activation') {
      this.setState({ kind: 'needs_activation' });
    }
  }

  async recheck(): Promise<void> {
    const stored = await readLicence();
    if (!stored) {
      this.setState({ kind: 'needs_activation' });
      return;
    }
    await this.backgroundRecheck(stored);
  }

  async signOut(): Promise<void> {
    this.activationAbort?.abort();
    this.activationAbort = null;
    this.stopRecheckTimer();
    await deleteLicence();
    this.setState({ kind: 'needs_activation' });
  }

  private unlock(record: StoredLicence): void {
    this.setState({
      kind: 'unlocked',
      status: record.status,
      validUntil: record.validUntil,
    });
  }

  private async backgroundRecheck(current: StoredLicence): Promise<void> {
    if (this.recheckInFlight) return;
    this.recheckInFlight = true;
    try {
      const result = await checkLicence(current.token);
      if (result.kind === 'valid') {
        await writeLicence(result.record);
        this.unlock(result.record);
      } else if (result.kind === 'invalid') {
        await deleteLicence();
        this.setState({ kind: 'locked', reason: result.reason });
        this.stopRecheckTimer();
      }
      // network_error: ignore — try again next interval.
    } finally {
      this.recheckInFlight = false;
    }
  }

  private startRecheckTimer(): void {
    if (this.recheckTimer) return;
    this.recheckTimer = setInterval(() => {
      void (async () => {
        const stored = await readLicence();
        if (stored) await this.backgroundRecheck(stored);
      })();
    }, LICENCE_RECHECK_INTERVAL_MS);
    // Don't keep the event loop alive just for the timer.
    this.recheckTimer.unref?.();
  }

  private stopRecheckTimer(): void {
    if (this.recheckTimer) {
      clearInterval(this.recheckTimer);
      this.recheckTimer = null;
    }
  }

  dispose(): void {
    this.activationAbort?.abort();
    this.activationAbort = null;
    this.stopRecheckTimer();
    this.subscribers.clear();
  }
}

export const licenceManager = new LicenceManager();
