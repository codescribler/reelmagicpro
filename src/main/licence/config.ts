// Single source of truth for the licence-server contract. All four constants
// come from docs/electron-app-integration.md §1.

export const LICENCE_API_BASE_URL = 'https://superb-chinchilla-299.eu-west-1.convex.site';

export const POLL_INTERVAL_MS = 2000;

// 16 min — covers the server's 15-min code lifetime + 1 min slack so a clock
// skew at the boundary doesn't end the loop right before the server responds
// `expired`.
export const POLL_TIMEOUT_MS = 16 * 60 * 1000;

export const LICENCE_RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const ACCOUNT_URL = 'https://getreelmagic.co.uk/account';
