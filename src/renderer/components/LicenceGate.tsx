import React from 'react';
import logoUrl from '../assets/reelmagic.png';
import type { LicenceState } from '../../shared/types';

// Full-screen lock that replaces the editor whenever the licence isn't
// `unlocked`. The contract in docs/electron-app-integration.md is strict:
// the activation page is only ever opened in the system browser via
// shell.openExternal — never embedded — so this component just shows the
// code and an "Open browser" button.

export function LicenceGate({ state }: { state: LicenceState }) {
  return (
    <div className="empty-state licence-gate">
      <div className="empty-state-inner">
        <img src={logoUrl} alt="ReelMagic" className="empty-state-logo" />
        {renderForState(state)}
      </div>
    </div>
  );
}

function renderForState(state: LicenceState): React.ReactNode {
  switch (state.kind) {
    case 'initialising':
      return (
        <p className="empty-state-tagline">Checking your licence…</p>
      );

    case 'needs_activation':
      return (
        <>
          <p className="empty-state-tagline">
            Activate ReelMagic to start editing.
          </p>
          <button
            className="primary empty-state-cta"
            onClick={() => window.reelmagic.licence.startActivation()}
            autoFocus
          >
            Activate this device
          </button>
          {state.error && (
            <p className="empty-state-tagline" style={{ color: 'var(--danger)', fontSize: 12 }}>
              Last attempt failed: {state.error}
            </p>
          )}
        </>
      );

    case 'requesting_activation':
      return (
        <p className="empty-state-tagline">Requesting activation code…</p>
      );

    case 'activating':
      return <ActivatingView state={state} />;

    case 'locked':
      return <LockedView reason={state.reason} />;

    case 'offline_locked':
      return (
        <>
          <p className="empty-state-tagline">
            Couldn't reach ReelMagic. Connect to the internet to continue.
          </p>
          <button
            className="primary empty-state-cta"
            onClick={() => window.reelmagic.licence.recheck()}
            autoFocus
          >
            Try again
          </button>
        </>
      );

    case 'unsupported':
      return (
        <>
          <p className="empty-state-tagline">
            ReelMagic couldn't access a secure credential store on this
            system. On Linux, install and unlock a desktop keyring (gnome-
            keyring, KWallet) and relaunch.
          </p>
        </>
      );

    case 'unlocked':
      // Defensive — the gate component shouldn't render in the unlocked
      // state (App.tsx swaps to the editor), but keep this branch so the
      // discriminated union is exhaustive without `default`.
      return null;
  }
}

function ActivatingView({
  state,
}: {
  state: Extract<LicenceState, { kind: 'activating' }>;
}) {
  return (
    <>
      <p className="empty-state-tagline">
        We've opened the activation page in your browser. Sign in there and
        confirm to link this device.
      </p>
      <div className="licence-code" aria-label="Activation code">
        {state.code}
      </div>
      <p className="empty-state-tagline" style={{ fontSize: 13 }}>
        Waiting for you to confirm…
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          onClick={() => window.reelmagic.licence.startActivation()}
          title="Open the activation page in your browser again"
        >
          Reopen browser
        </button>
        <button
          className="empty-state-secondary"
          onClick={() => window.reelmagic.licence.cancelActivation()}
        >
          Cancel
        </button>
      </div>
    </>
  );
}

function LockedView({ reason }: { reason: string }) {
  const copy = lockedCopy(reason);
  const showAccount =
    reason === 'subscription_cancelled' ||
    reason === 'subscription_past_due_grace_expired';
  return (
    <>
      <p className="empty-state-tagline">{copy}</p>
      <button
        className="primary empty-state-cta"
        onClick={() => window.reelmagic.licence.startActivation()}
        autoFocus
      >
        Re-activate this device
      </button>
      {showAccount && (
        <button
          className="empty-state-secondary"
          onClick={() => window.reelmagic.licence.openAccountPage()}
        >
          Manage account
        </button>
      )}
    </>
  );
}

function lockedCopy(reason: string): string {
  switch (reason) {
    case 'device_revoked':
      return 'This device was unlinked from your ReelMagic account. Re-activate to keep using ReelMagic.';
    case 'subscription_cancelled':
      return 'Your subscription was cancelled. Manage at getreelmagic.co.uk/account.';
    case 'subscription_past_due_grace_expired':
      return 'Payment failed and your grace period has elapsed. Update your card at getreelmagic.co.uk/account.';
    case 'signature_invalid':
    case 'token_expired':
    case 'device_not_found':
    default:
      return 'Please re-activate this device.';
  }
}
