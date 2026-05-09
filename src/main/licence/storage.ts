import { app, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { StoredLicence } from '../../shared/types';

const DEVICE_ID_FILE = 'deviceId.txt';
const LICENCE_FILE = 'licence.bin';

async function userDataPath(name: string): Promise<string> {
  const dir = app.getPath('userData');
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, name);
}

export async function getDeviceId(): Promise<string> {
  const file = await userDataPath(DEVICE_ID_FILE);
  try {
    const existing = (await fs.readFile(file, 'utf8')).trim();
    if (existing) return existing;
  } catch {
    // fall through to write a fresh one
  }
  const id = randomUUID();
  await fs.writeFile(file, id, 'utf8');
  return id;
}

export function isStorageAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export async function readLicence(): Promise<StoredLicence | null> {
  if (!isStorageAvailable()) return null;
  const file = await userDataPath(LICENCE_FILE);
  let buf: Buffer;
  try {
    buf = await fs.readFile(file);
  } catch {
    return null;
  }
  try {
    const json = safeStorage.decryptString(buf);
    const parsed = JSON.parse(json) as StoredLicence;
    if (
      typeof parsed?.token === 'string' &&
      typeof parsed?.validUntil === 'number' &&
      (parsed.status === 'comp' || parsed.status === 'active' || parsed.status === 'past_due')
    ) {
      return parsed;
    }
    return null;
  } catch {
    // corrupt or undecryptable — best to discard
    await fs.rm(file, { force: true });
    return null;
  }
}

export async function writeLicence(record: StoredLicence): Promise<void> {
  if (!isStorageAvailable()) {
    throw new Error('safeStorage unavailable');
  }
  const file = await userDataPath(LICENCE_FILE);
  const buf = safeStorage.encryptString(JSON.stringify(record));
  await fs.writeFile(file, buf);
}

export async function deleteLicence(): Promise<void> {
  const file = await userDataPath(LICENCE_FILE);
  await fs.rm(file, { force: true });
}
