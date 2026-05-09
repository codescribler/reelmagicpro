import type { LicencePlatform, LicenceStatus, StoredLicence } from '../../shared/types';
import { LICENCE_API_BASE_URL } from './config';

// All requests go through here so HTTPS is enforced in one place.
function url(pathname: string): string {
  return `${LICENCE_API_BASE_URL}${pathname}`;
}

interface ActivationRequestArgs {
  deviceId: string;
  deviceName: string;
  platform: LicencePlatform;
  appVersion: string;
}

export interface ActivationRequestResult {
  code: string;
  activationUrl: string;
  expiresAt: number;
}

export async function requestActivation(
  args: ActivationRequestArgs,
  signal?: AbortSignal,
): Promise<ActivationRequestResult> {
  let res: Response;
  try {
    res = await fetch(url('/api/activation/request'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args),
      signal,
    });
  } catch (err) {
    // Distinguish network failure (DNS, offline, TLS) from HTTP failure so the
    // surfaced error is useful.
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`network: ${message}`);
  }
  if (!res.ok) {
    let bodyText = '';
    try { bodyText = await res.text(); } catch { /* ignore */ }
    throw new Error(`server ${res.status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`);
  }
  const body = (await res.json()) as Partial<ActivationRequestResult>;
  if (
    typeof body.code !== 'string' ||
    typeof body.activationUrl !== 'string' ||
    typeof body.expiresAt !== 'number'
  ) {
    throw new Error('malformed response from server');
  }
  return { code: body.code, activationUrl: body.activationUrl, expiresAt: body.expiresAt };
}

export type PollResult =
  | { kind: 'pending' }
  | { kind: 'claimed'; token: string }
  | { kind: 'expired' }
  | { kind: 'consumed' };

export async function pollOnce(code: string, signal?: AbortSignal): Promise<PollResult> {
  const res = await fetch(
    url(`/api/activation/poll?code=${encodeURIComponent(code)}`),
    { signal },
  );
  if (!res.ok) throw new Error(`poll_failed_${res.status}`);
  const body = (await res.json()) as { status?: string; licenceToken?: string };
  if (body.status === 'claimed' && typeof body.licenceToken === 'string') {
    return { kind: 'claimed', token: body.licenceToken };
  }
  if (body.status === 'pending') return { kind: 'pending' };
  if (body.status === 'consumed') return { kind: 'consumed' };
  if (body.status === 'expired') return { kind: 'expired' };
  // Unknown status — the doc says treat as transient. Surface as a thrown
  // error so the caller's catch retries after the interval.
  throw new Error(`poll_unknown_status_${body.status}`);
}

export type CheckResult =
  | { kind: 'valid'; record: StoredLicence }
  | { kind: 'invalid'; reason: string }
  | { kind: 'network_error' };

export async function checkLicence(token: string, signal?: AbortSignal): Promise<CheckResult> {
  let res: Response;
  try {
    res = await fetch(url('/api/licence/check'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ licenceToken: token }),
      signal,
    });
  } catch {
    return { kind: 'network_error' };
  }
  if (!res.ok) return { kind: 'network_error' };
  let body: {
    valid?: boolean;
    status?: string;
    validUntil?: number;
    refreshedToken?: string;
    reason?: string;
  };
  try {
    body = await res.json();
  } catch {
    return { kind: 'network_error' };
  }
  if (
    body.valid === true &&
    typeof body.refreshedToken === 'string' &&
    typeof body.validUntil === 'number'
  ) {
    // §9: unknown statuses default to 'active' for UI purposes.
    const status: LicenceStatus =
      body.status === 'comp' || body.status === 'active' || body.status === 'past_due'
        ? body.status
        : 'active';
    return {
      kind: 'valid',
      record: { token: body.refreshedToken, validUntil: body.validUntil, status },
    };
  }
  return { kind: 'invalid', reason: typeof body.reason === 'string' ? body.reason : 'unknown' };
}
