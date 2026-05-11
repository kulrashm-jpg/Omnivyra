/**
 * Canonical provider-connection lifecycle state.
 *
 * Authority: ALL state derivations route through `deriveConnectionState`
 * here. UI components MUST NOT compute states from raw token timestamps —
 * they read `connection_state` (or the result of `deriveConnectionState`
 * for legacy rows whose column hasn't been backfilled).
 *
 * Phase B scope: define the type, the transition rules, and a pure
 * derivation helper. The persistence column (`connection_state`) is added
 * by 20260625_integration_connection_state.sql and is the single field
 * the scheduler writes. Live-check telemetry uses the sibling columns
 * `last_live_check_at` / `last_live_check_status` / `last_provider_error`.
 */

/** The 9-state enum that replaces the ad-hoc "Awaiting account" strings. */
export type ConnectionState =
  | 'CONFIGURED'              // platform creds saved; no tenant binding yet
  | 'CONNECTED'               // tokens stored, not expired
  | 'LIVE_VERIFIED'           // CONNECTED AND last_live_check_at < 24h ok
  | 'TOKEN_REFRESH_REQUIRED'  // within refresh buffer of expiry
  | 'TOKEN_EXPIRED'           // past expiry, refresh not yet attempted
  | 'PROVIDER_REAUTH_REQUIRED'// refresh attempts exhausted or invalid_grant
  | 'RATE_LIMITED'            // provider 429 — auto-clears after backoff
  | 'DEGRADED'                // live-check 5xx — transient provider issue
  | 'DISCONNECTED';           // explicitly revoked

export const CONNECTION_STATES: ReadonlyArray<ConnectionState> = [
  'CONFIGURED',
  'CONNECTED',
  'LIVE_VERIFIED',
  'TOKEN_REFRESH_REQUIRED',
  'TOKEN_EXPIRED',
  'PROVIDER_REAUTH_REQUIRED',
  'RATE_LIMITED',
  'DEGRADED',
  'DISCONNECTED',
];

/** Minimum-staleness window for LIVE_VERIFIED → CONNECTED demotion. */
export const LIVE_VERIFIED_FRESHNESS_MS = 24 * 60 * 60 * 1000;

/**
 * Refresh window. Tokens with `expires_at` within this many ms of `now`
 * are eligible for proactive refresh; the scheduler's tick cadence must
 * be tighter than this number or short-lived tokens (X access = 2h)
 * will slip through.
 */
export const REFRESH_BUFFER_MS = 30 * 60 * 1000;

/** Max consecutive refresh failures before quarantining as REAUTH_REQUIRED. */
export const REFRESH_FAILURE_CEILING = 4;

export interface ConnectionStateInputs {
  /** Token expiry timestamp; null if the provider doesn't expire (Reddit permanent). */
  tokenExpiresAt: Date | null;
  /** True if the row is explicitly revoked by user/admin. */
  isExplicitlyDisconnected: boolean;
  /** Most recent refresh attempt status, if known. */
  lastRefreshStatus?: 'success' | 'failed' | 'requires_reconnect' | null;
  /** Count of consecutive refresh failures since the last success. */
  consecutiveRefreshFailures?: number;
  /** Last live-check result, if known. */
  lastLiveCheckStatus?: 'ok' | 'unauthorised' | 'forbidden' | 'rate_limited' | 'server_error' | null;
  /** When the last live-check ran. */
  lastLiveCheckAt?: Date | null;
  /** Current refresh-token presence — without it, expired = reauth-required. */
  hasRefreshToken: boolean;
  /** True if the row carries a non-null backing token (access_token present). */
  hasAccessToken: boolean;
  /** Now, injectable for testing. Defaults to Date.now(). */
  now?: Date;
}

/**
 * Pure derivation. Given the persisted facts about a connection, return
 * the canonical state. Single source of truth — every read path that
 * surfaces a status (super-admin tab, tenant integrations UI, status
 * badge) goes through this OR reads the persisted `connection_state`
 * column written by the scheduler from this function.
 *
 * Priority order (top wins): DISCONNECTED > PROVIDER_REAUTH_REQUIRED >
 * RATE_LIMITED > TOKEN_EXPIRED > TOKEN_REFRESH_REQUIRED > DEGRADED >
 * LIVE_VERIFIED > CONNECTED > CONFIGURED.
 */
export function deriveConnectionState(input: ConnectionStateInputs): ConnectionState {
  const now = input.now ?? new Date();

  if (input.isExplicitlyDisconnected) return 'DISCONNECTED';

  // No usable token at all = either nothing has connected yet, or a
  // tombstone we missed. CONFIGURED is the safe pre-bind state.
  if (!input.hasAccessToken) return 'CONFIGURED';

  // Refresh-token-exhausted or provider-rejected invalid_grant.
  if (input.lastRefreshStatus === 'requires_reconnect') return 'PROVIDER_REAUTH_REQUIRED';
  if ((input.consecutiveRefreshFailures ?? 0) >= REFRESH_FAILURE_CEILING) {
    return 'PROVIDER_REAUTH_REQUIRED';
  }

  if (input.lastLiveCheckStatus === 'unauthorised' || input.lastLiveCheckStatus === 'forbidden') {
    return 'PROVIDER_REAUTH_REQUIRED';
  }

  if (input.lastLiveCheckStatus === 'rate_limited') return 'RATE_LIMITED';

  // Token expiry handling: distinguish "expired with no refresh path"
  // from "expired but the next scheduler tick will rotate it".
  if (input.tokenExpiresAt) {
    const expMs = input.tokenExpiresAt.getTime();
    if (expMs <= now.getTime()) {
      return input.hasRefreshToken ? 'TOKEN_EXPIRED' : 'PROVIDER_REAUTH_REQUIRED';
    }
    if (expMs <= now.getTime() + REFRESH_BUFFER_MS) return 'TOKEN_REFRESH_REQUIRED';
  }

  if (input.lastLiveCheckStatus === 'server_error') return 'DEGRADED';

  // Healthy. Was the live check recent enough to upgrade to LIVE_VERIFIED?
  if (
    input.lastLiveCheckStatus === 'ok' &&
    input.lastLiveCheckAt &&
    now.getTime() - input.lastLiveCheckAt.getTime() <= LIVE_VERIFIED_FRESHNESS_MS
  ) {
    return 'LIVE_VERIFIED';
  }

  return 'CONNECTED';
}

/**
 * Bag of state predicates UIs commonly need, so views don't keep
 * reinventing classifications.
 */
export function isReauthRequired(state: ConnectionState): boolean {
  return state === 'PROVIDER_REAUTH_REQUIRED';
}
export function isHealthy(state: ConnectionState): boolean {
  return state === 'CONNECTED' || state === 'LIVE_VERIFIED';
}
export function isTransient(state: ConnectionState): boolean {
  return state === 'TOKEN_REFRESH_REQUIRED'
      || state === 'RATE_LIMITED'
      || state === 'DEGRADED';
}
export function needsScheduledRefresh(state: ConnectionState): boolean {
  return state === 'TOKEN_REFRESH_REQUIRED' || state === 'TOKEN_EXPIRED';
}

/**
 * UI-friendly label and tone. Used by the SUPER_ADMIN health tab and
 * tenant Integrations page. Tone is the visual category, not styling —
 * callers map it to their own design tokens.
 */
export function labelForState(state: ConnectionState): { label: string; tone: 'ok' | 'warn' | 'error' | 'info' | 'neutral' } {
  switch (state) {
    case 'LIVE_VERIFIED':            return { label: 'Live & verified',     tone: 'ok' };
    case 'CONNECTED':                return { label: 'Connected',           tone: 'ok' };
    case 'TOKEN_REFRESH_REQUIRED':   return { label: 'Refreshing soon',     tone: 'info' };
    case 'TOKEN_EXPIRED':            return { label: 'Refresh pending',     tone: 'warn' };
    case 'RATE_LIMITED':             return { label: 'Rate-limited',        tone: 'warn' };
    case 'DEGRADED':                 return { label: 'Provider issues',     tone: 'warn' };
    case 'PROVIDER_REAUTH_REQUIRED': return { label: 'Reconnect required',  tone: 'error' };
    case 'DISCONNECTED':             return { label: 'Disconnected',        tone: 'neutral' };
    case 'CONFIGURED':               return { label: 'Awaiting account',    tone: 'neutral' };
  }
}
