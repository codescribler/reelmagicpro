# ReelMagic Desktop App — Licence Server Integration

This is the complete contract the ReelMagic desktop app implements to talk to the licence server. It is self-contained: a developer working in the desktop-app codebase needs nothing else.

The licence server is treated as a black-box HTTP API. The desktop app never opens a Convex client, never knows a database schema, and never holds a server secret. It calls three endpoints, opens one URL in the user's browser, and stores two pieces of state.

---

## 1. Configuration

### 1.1 The one URL the app needs

| Name                  | Value                                            | Purpose                                                       |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| `LICENCE_API_BASE_URL` | `https://superb-chinchilla-299.eu-west-1.convex.site`   | All three HTTP endpoints below are served from this origin.   |

That is the live licence API. The desktop app only needs this one URL. Activation links the user follows in the browser are returned by the API itself (full URL — including the site origin `https://getreelmagic.co.uk`); the app never composes them.

### 1.2 Build-time constants (recommended app side)

```ts
// licence-config.ts (desktop app)
export const LICENCE_API_BASE_URL =
  'https://superb-chinchilla-299.eu-west-1.convex.site';

export const POLL_INTERVAL_MS = 2000;
export const POLL_TIMEOUT_MS = 16 * 60 * 1000; // 16 min — covers the server's 15-min code lifetime + slack
export const LICENCE_RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 day
```

### 1.3 What the app does **not** need

- No API key, bearer token, or any other server credential.
- No knowledge of Stripe, Resend, Convex, or any internal product names.
- No JWT signing key or JWKS endpoint. The app **never verifies** the licence token cryptographically. It treats the token as opaque, trusting whatever the server says about validity.

---

## 2. App-side state

The app persists exactly two values:

### 2.1 `deviceId` — UUIDv4, plain text

- Generated **once** the first time the app starts on this install.
- Stored in the per-user app-data directory as a plain file (e.g. `<userData>/deviceId.txt`).
- Never sent anywhere else, never displayed to the user.
- **Re-installing the app** generates a new `deviceId`. The user's old `deviceId` becomes "abandoned" on the server until they revoke it from the website's `/account` page (or it stays linked to their account harmlessly).
- Do **not** derive `deviceId` from hardware fingerprints. Random UUIDv4 only.

```ts
// pseudocode
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

async function getOrCreateDeviceId(userDataDir: string): Promise<string> {
  const file = path.join(userDataDir, 'deviceId.txt');
  try {
    return (await fs.readFile(file, 'utf8')).trim();
  } catch {
    const id = randomUUID();
    await fs.writeFile(file, id, 'utf8');
    return id;
  }
}
```

### 2.2 `licence` — the active licence record

Once the app is activated, it stores a small JSON record in the OS keychain (Electron: `safeStorage` for at-rest encryption, or `keytar`):

```ts
type StoredLicence = {
  /** Opaque JWT minted by the licence server. */
  token: string;
  /** Epoch milliseconds. After this time the app must hit /api/licence/check before continuing. */
  validUntil: number;
  /** "comp" | "active" | "past_due" — informational. The server is authoritative; the app never decides. */
  status: 'comp' | 'active' | 'past_due';
};
```

Both fields come **directly from the JSON response** of the licence server. The app **must not** decode the JWT to extract them — store the JSON response fields and ignore the JWT internals. The token is opaque to the app.

Suggested storage key: `reelmagic.licence`. One key per OS user. If the user has multiple OS accounts, each one activates separately.

---

## 3. The three endpoints

All three live at `${LICENCE_API_BASE_URL}/api/...`. Always use HTTPS. The server enforces:

- `Content-Type: application/json` on POST bodies.
- A 15-minute lifetime on every activation code.
- A 14-day `validUntil` window on every successfully-checked licence token.

### 3.1 `POST /api/activation/request`

Used at the **start** of activation, when the user first launches a fresh install (or after losing their licence).

**Request body:**

```json
{
  "deviceId": "9a3c4f1e-7b2d-4e8a-9c6f-12d34e5f6789",
  "deviceName": "Daniel's MacBook Pro",
  "platform": "mac",
  "appVersion": "0.1.4"
}
```

| Field        | Type                                 | Notes                                                                                                                            |
| ------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `deviceId`   | string (UUID)                        | The persisted UUID from §2.1.                                                                                                    |
| `deviceName` | string                               | Best-effort hostname. Shown to the user on the activation page so they can confirm "yes, this is the device I'm activating". |
| `platform`   | `"win"` \| `"mac"` \| `"linux"` | Anything else → 400.                                                                                                             |
| `appVersion` | string                               | Free-form. Recorded on the device row so support can debug version mismatches.                                                   |

**Success response (200):**

```json
{
  "code": "ABCD-1234",
  "activationUrl": "https://getreelmagic.co.uk/activate?code=ABCD-1234",
  "expiresAt": 1715250000000
}
```

| Field           | Type                | Notes                                                                                                |
| --------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| `code`          | string `XXXX-XXXX` | Eight chars from a no-lookalikes alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`) plus a hyphen. |
| `activationUrl` | string (URL)        | **Open this in the user's default browser.** Do not parse it; do not embed it in the app window. |
| `expiresAt`     | number (epoch ms)   | After this time, polling will return `expired`.                                                      |

**Error response (400):** `{ "error": "INVALID_BODY" }` or `{ "error": "INVALID_JSON" }`. Treat any non-200 as "request failed, show retry button". Do not begin polling.

**App behaviour after success:** open `activationUrl` in the user's default browser (`shell.openExternal(activationUrl)` on Electron) and immediately start polling (§3.2).

### 3.2 `GET /api/activation/poll?code=ABCD-1234`

Polled every 2 seconds after the user has been sent to the browser. The endpoint returns one of four statuses; only `pending` means "keep polling".

**Possible responses (always 200):**

```json
{ "status": "pending" }
```
The user has not yet clicked "Link this device" on the website. Keep polling.

```json
{ "status": "claimed", "licenceToken": "<jwt>" }
```
The user clicked confirm. The body **always includes** `licenceToken` on the first `claimed` response and on **no other response, ever**. Persist it immediately.

```json
{ "status": "consumed" }
```
A previous poll already consumed the token. Either:

- the app already stored the token in §2.2 → safe, treat as success;
- the app never received it (network drop between server send and app receipt) → treat as failure: discard any stored state and restart activation from §3.1. The user will need to confirm a fresh code on the website.

```json
{ "status": "expired" }
```
The 15-minute window elapsed, or the code is unknown. Stop polling. Show "Activation timed out" with a retry button that runs §3.1 again.

**App behaviour:**

```ts
async function pollUntilDone(code: string): Promise<StoredLicence | 'expired'> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${LICENCE_API_BASE_URL}/api/activation/poll?code=${encodeURIComponent(code)}`,
    );
    if (!res.ok) {
      // Treat network/server hiccups as transient — retry after the interval.
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    const body = (await res.json()) as { status: string; licenceToken?: string };
    if (body.status === 'pending') {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    if (body.status === 'claimed' && body.licenceToken) {
      // The validUntil and status come from /api/licence/check on the very
      // next call — see §3.3. Until then, store with a short validUntil so
      // the app re-checks immediately on next launch.
      return {
        token: body.licenceToken,
        // Don't trust the JWT — call /api/licence/check next to populate
        // these fields properly.
        validUntil: 0,
        status: 'comp',
      };
    }
    if (body.status === 'consumed' || body.status === 'expired') {
      return 'expired';
    }
    // Unknown status — treat as transient.
    await sleep(POLL_INTERVAL_MS);
  }
  return 'expired';
}
```

**Right after `claimed`:** call §3.3 once to get the proper `validUntil` and refreshed token, then store the result.

### 3.3 `POST /api/licence/check`

Called:

- Immediately after a successful `claimed` poll, to populate `validUntil`.
- On every app launch.
- Once a day if the app stays open for that long (`LICENCE_RECHECK_INTERVAL_MS`).
- After the OS wakes from sleep if a recheck is overdue.

**Request body:**

```json
{ "licenceToken": "<currently-stored token>" }
```

**Success response (200):**

```json
{
  "valid": true,
  "status": "comp",
  "validUntil": 1716461400000,
  "refreshedToken": "<new jwt>"
}
```

| Field            | Type                                                       | Notes                                                                                                                          |
| ---------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `valid`          | `true`                                                     | Always present. `true` here.                                                                                                 |
| `status`         | `"comp"` \| `"active"` \| `"past_due"` | Informational. The app shows a banner for `past_due`; otherwise no UI difference.                                       |
| `validUntil`     | number (epoch ms)                                          | "Now + 14 days". The app trusts the licence offline until this time.                                                           |
| `refreshedToken` | string (JWT)                                               | **Replace the stored token with this immediately.** Do not keep the old one. The old token is still cryptographically valid until its own expiry, but always prefer the freshest. |

After replacing, store the record:

```ts
storedLicence = {
  token: body.refreshedToken,
  validUntil: body.validUntil,
  status: body.status,
};
```

**Failure response (200, `valid: false`):**

```json
{ "valid": false, "reason": "<see table>" }
```

| `reason`                              | Meaning (for the app's mental model)                                              | App behaviour                                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `signature_invalid`                   | Token doesn't verify. Most common cause: the server's signing secret was rotated. | Discard token. Show "Please re-activate this device." Run §3.1 on user's request.                                   |
| `token_expired`                       | The JWT's `exp` claim has passed.                                                 | Discard token. Same UI as above.                                                                                    |
| `device_not_found`                    | The `deviceId` inside the token has no row on the server.                         | Discard token. Same UI as above.                                                                                    |
| `device_revoked`                      | The user revoked this device from the website's `/account` page.                  | Discard token. Show: "This device was unlinked from your ReelMagic account. Re-activate to keep using ReelMagic."   |
| `subscription_cancelled`              | The user's subscription is `cancelled`.                                           | Discard token. Show: "Your subscription was cancelled. Manage at getreelmagic.co.uk/account." Open `https://getreelmagic.co.uk/account` on click. |
| `subscription_past_due_grace_expired` | Stripe payment failed and the 7-day grace period elapsed.                         | Discard token. Show: "Payment failed and your grace period has elapsed. Update your card at getreelmagic.co.uk/account."        |

**The app must always discard the stored token on any `valid: false` response.** Do not retry with the same token; the server's answer will not change.

**Network failure (response not received):** treat as offline (see §4). Do not discard the stored token — only discard on an explicit `valid: false`.

---

## 4. Offline behaviour

The licence record's `validUntil` is the **only** thing the app uses to decide if it's allowed to run offline.

Decision tree at startup:

```
Has a stored licence?
├─ No  → Start activation flow (§3.1).
└─ Yes
   ├─ Is now() < validUntil?
   │  ├─ Yes → Unlock UI. Try /api/licence/check in the background.
   │  │       On success: replace token. On failure (valid:false): apply §3.3 failure
   │  │       behaviour. On network error: ignore — try again later.
   │  └─ No  → Try /api/licence/check synchronously, blocking the UI behind a spinner.
   │           ├─ Success → store new record, unlock.
   │           ├─ valid:false → discard, prompt re-activate.
   │           └─ Network error → show "Couldn't reach ReelMagic. Connect to the
   │                              internet to continue." Lock UI. Retry on reconnect.
```

**Background re-check while the app stays open:** every `LICENCE_RECHECK_INTERVAL_MS` (24 h), call §3.3. Same handling as above, except offline failure is silent: leave the user working until `validUntil` actually elapses.

**Wake-from-sleep:** if the system slept past `validUntil`, treat the next check as synchronous-blocking (same as the "now() ≥ validUntil" branch).

---

## 5. End-to-end happy path

```
[App] randomUUID → deviceId.txt
[App] POST /api/activation/request {deviceId, deviceName, platform, appVersion}
[Srv] → {code, activationUrl, expiresAt}
[App] shell.openExternal(activationUrl)
[App] every 2s: GET /api/activation/poll?code=...
[Usr] (on website) signs in / signs up → clicks "Link this device"
[Srv] poll returns {status:"claimed", licenceToken}
[App] safeStorage.encryptString(licenceToken) → temp record
[App] POST /api/licence/check {licenceToken}
[Srv] → {valid:true, status:"comp", validUntil, refreshedToken}
[App] safeStorage.encryptString(refreshedToken) → final record
[App] unlock UI

[…app launches every day…]
[App] read record from keychain
[App] if now() < validUntil: unlock immediately, recheck in background
[App] POST /api/licence/check {licenceToken: stored.token}
[Srv] → {valid:true, …, refreshedToken}
[App] replace stored token + validUntil
```

---

## 6. End-to-end failure cases

### 6.1 User cancels in the browser

Activation page closed without confirming. The poll stays `pending` until 15 minutes elapse, then flips to `expired`. The app shows "Activation timed out".

### 6.2 User clicks the link on a different device

The browser session is per-device. The user's session on whichever browser they used owns the click. If they sign in there, link the device, and close — the desktop app on the original machine will still receive the `claimed` poll response (the server stores the token against the activation code, not the browser).

### 6.3 User revokes the device from `/account`

The next `/api/licence/check` returns `device_revoked`. The app discards the token and prompts re-activation (§3.3).

### 6.4 Server signing secret rotated

Every device's next licence check returns `signature_invalid`. Every app discards its token and prompts re-activation. The user signs in to the website (their account is unchanged) and re-runs the activation flow. Their devices show up duplicated on `/account` until they manually revoke the old entries.

### 6.5 Clock skew / wrong system time

The JWT has an `exp` claim that the server verifies. Server clock is authoritative. If the user's machine clock is wildly wrong, expired tokens may look valid locally; the next `/api/licence/check` will return `token_expired` and force re-activation. There's no defence beyond that — instruct users with broken clocks to fix them.

### 6.6 No network during initial activation

`POST /api/activation/request` fails. Show a retry button; do not begin polling. Do not generate a code locally — the server is the only source of activation codes.

### 6.7 Network drops mid-poll

Treat as transient: keep polling at the normal interval. The server holds the activation code for 15 minutes regardless of whether the app is reachable. If the network is still down at expiry, the next poll returns `expired` and the user retries.

### 6.8 Token leaked

There is no in-band revocation push. The user must:

1. Sign in to the website.
2. Revoke the device from `/account`.
3. Wait up to 24 h for the leaker's next `/api/licence/check`, which will return `device_revoked`.

For faster invalidation, rotate `LICENCE_TOKEN_SECRET` on the server (forces all devices to re-activate).

---

## 7. Reference Electron implementation

Drop-in starting point. Adjust paths/imports for the actual codebase.

```ts
// licence-client.ts (desktop app)
import { app, safeStorage, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LICENCE_API_BASE_URL } from './licence-config';

const LICENCE_KEY_FILE = 'licence.bin'; // safeStorage-encrypted JSON record
const DEVICE_ID_FILE = 'deviceId.txt';

type StoredLicence = {
  token: string;
  validUntil: number;
  status: 'comp' | 'active' | 'past_due';
};

async function userDataPath(name: string): Promise<string> {
  const dir = app.getPath('userData');
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, name);
}

export async function getDeviceId(): Promise<string> {
  const file = await userDataPath(DEVICE_ID_FILE);
  try {
    return (await fs.readFile(file, 'utf8')).trim();
  } catch {
    const id = randomUUID();
    await fs.writeFile(file, id, 'utf8');
    return id;
  }
}

export async function readLicence(): Promise<StoredLicence | null> {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const file = await userDataPath(LICENCE_KEY_FILE);
  try {
    const buf = await fs.readFile(file);
    const json = safeStorage.decryptString(buf);
    return JSON.parse(json) as StoredLicence;
  } catch {
    return null;
  }
}

export async function writeLicence(record: StoredLicence): Promise<void> {
  const file = await userDataPath(LICENCE_KEY_FILE);
  const buf = safeStorage.encryptString(JSON.stringify(record));
  await fs.writeFile(file, buf);
}

export async function deleteLicence(): Promise<void> {
  const file = await userDataPath(LICENCE_KEY_FILE);
  await fs.rm(file, { force: true });
}

// --- HTTP helpers -----------------------------------------------------------

async function postJson<T>(pathname: string, body: unknown): Promise<T> {
  const res = await fetch(`${LICENCE_API_BASE_URL}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function getJson<T>(pathname: string): Promise<T> {
  const res = await fetch(`${LICENCE_API_BASE_URL}${pathname}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

// --- Activation -------------------------------------------------------------

export async function requestActivation(opts: {
  deviceName: string;
  platform: 'win' | 'mac' | 'linux';
  appVersion: string;
}): Promise<{ code: string; activationUrl: string; expiresAt: number }> {
  const deviceId = await getDeviceId();
  return await postJson('/api/activation/request', { deviceId, ...opts });
}

export type PollResult =
  | { kind: 'pending' }
  | { kind: 'claimed'; token: string }
  | { kind: 'expired' }
  | { kind: 'consumed' };

export async function pollOnce(code: string): Promise<PollResult> {
  const body = await getJson<{ status: string; licenceToken?: string }>(
    `/api/activation/poll?code=${encodeURIComponent(code)}`,
  );
  if (body.status === 'claimed' && body.licenceToken) {
    return { kind: 'claimed', token: body.licenceToken };
  }
  if (body.status === 'pending') return { kind: 'pending' };
  if (body.status === 'consumed') return { kind: 'consumed' };
  return { kind: 'expired' };
}

export async function activate(opts: {
  deviceName: string;
  platform: 'win' | 'mac' | 'linux';
  appVersion: string;
  onWaiting?: () => void;
  signal?: AbortSignal;
}): Promise<StoredLicence> {
  const { code, activationUrl, expiresAt } = await requestActivation(opts);
  await shell.openExternal(activationUrl);
  opts.onWaiting?.();

  while (Date.now() < expiresAt) {
    if (opts.signal?.aborted) throw new Error('cancelled');
    try {
      const result = await pollOnce(code);
      if (result.kind === 'claimed') {
        // Confirm validity + get refreshed token + validUntil.
        const checked = await checkLicence(result.token);
        if (checked.kind !== 'valid') throw new Error('activation_rejected');
        await writeLicence(checked.record);
        return checked.record;
      }
      if (result.kind === 'expired' || result.kind === 'consumed') {
        throw new Error(result.kind);
      }
    } catch (err) {
      // Network or transient — fall through to retry after interval.
      if (err instanceof Error && err.message === 'cancelled') throw err;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('expired');
}

// --- Licence check ----------------------------------------------------------

export type CheckResult =
  | { kind: 'valid'; record: StoredLicence }
  | { kind: 'invalid'; reason: string }
  | { kind: 'network_error' };

export async function checkLicence(token: string): Promise<CheckResult> {
  try {
    const body = await postJson<{
      valid: boolean;
      status?: 'comp' | 'active' | 'past_due';
      validUntil?: number;
      refreshedToken?: string;
      reason?: string;
    }>('/api/licence/check', { licenceToken: token });
    if (body.valid && body.refreshedToken && body.validUntil && body.status) {
      return {
        kind: 'valid',
        record: {
          token: body.refreshedToken,
          validUntil: body.validUntil,
          status: body.status,
        },
      };
    }
    return { kind: 'invalid', reason: body.reason ?? 'unknown' };
  } catch {
    return { kind: 'network_error' };
  }
}

// --- Startup gate -----------------------------------------------------------

export async function gateOnStartup(): Promise<
  | { kind: 'unlocked'; record: StoredLicence }
  | { kind: 'needs_activation' }
  | { kind: 'locked'; reason: string }
  | { kind: 'offline_locked' }
> {
  const stored = await readLicence();
  if (!stored) return { kind: 'needs_activation' };

  if (Date.now() < stored.validUntil) {
    // Trust offline; recheck in background.
    void backgroundRecheck(stored);
    return { kind: 'unlocked', record: stored };
  }

  // Expired locally — must check.
  const result = await checkLicence(stored.token);
  if (result.kind === 'valid') {
    await writeLicence(result.record);
    return { kind: 'unlocked', record: result.record };
  }
  if (result.kind === 'invalid') {
    await deleteLicence();
    return { kind: 'locked', reason: result.reason };
  }
  // Network error — keep token, but lock UI until reconnect.
  return { kind: 'offline_locked' };
}

async function backgroundRecheck(current: StoredLicence): Promise<void> {
  const result = await checkLicence(current.token);
  if (result.kind === 'valid') {
    await writeLicence(result.record);
  } else if (result.kind === 'invalid') {
    await deleteLicence();
    // Notify the app shell to lock the UI on the next render.
    // (Implementation: an EventEmitter the renderer subscribes to.)
  }
  // network_error: ignore — try again next interval.
}
```

---

## 8. Security and hygiene

- **Always HTTPS.** The server only accepts HTTPS; reject any setup that points the app at `http://`.
- **Never log the licence token** in plaintext. Truncate to first/last 4 chars when logging for support purposes.
- **Never decode the JWT yourself** to make a security decision. The token is opaque. The server is authoritative on every "is this licence valid right now?" question.
- **Never embed the activation page in a `BrowserView` or in-app webview.** Use the system browser via `shell.openExternal`. The user signs in with a password on the website; that password must never pass through the desktop app.
- **`safeStorage` only.** If `safeStorage.isEncryptionAvailable()` is false (some Linux desktop environments without a keyring), refuse to persist the licence and force the user to re-activate every launch. Don't silently fall back to plaintext.

---

## 9. Versioning and forward-compat

- The `appVersion` field is recorded server-side. Send semver or build-id; the server doesn't parse it.
- The endpoints versioning is handled by URL path. New versions, if needed, will live at `/api/v2/...`. The current paths (`/api/activation/...`, `/api/licence/...`) will not change behaviour without a path bump.
- Unknown `reason` strings in §3.3 should be treated as "discard token, prompt re-activation" by default — unknown reasons are always at least as bad as `signature_invalid`.
- Unknown `status` values from `/api/licence/check` (other than `comp`/`active`/`past_due`) should be treated as `active` for UI purposes. The server will only return new statuses if the desktop-app contract is updated first.

---

## 10. Quick reference — endpoints

| Method | Path                       | Purpose                | Body / Query                                | Response shape                                                                                                                                              |
| ------ | -------------------------- | ---------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/activation/request`  | Mint an activation code | `{deviceId, deviceName, platform, appVersion}` | 200 `{code, activationUrl, expiresAt}` · 400 `{error}`                                                                                                      |
| GET    | `/api/activation/poll`     | Poll for completion     | `?code=ABCD-1234`                           | 200 `{status:"pending"}` · `{status:"claimed", licenceToken}` · `{status:"consumed"}` · `{status:"expired"}`                                                |
| POST   | `/api/licence/check`       | Validate + refresh token | `{licenceToken}`                            | 200 `{valid:true, status, validUntil, refreshedToken}` · 200 `{valid:false, reason}`                                                                        |

That is the entire surface area between the desktop app and the licence server.
