/**
 * Connection health status (publish flow — social_accounts).
 * Computed from token_expires_at; no DB column.
 */

export type ConnectionStatus = 'active' | 'expiring_soon' | 'expired' | 'no_token';

const MS_PER_HOUR = 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * MS_PER_HOUR;

/**
 * Derive connection_status from token_expires_at (and optionally access_token presence).
 * Server-side time (Date.now()).
 */
export function getConnectionStatus(
  tokenExpiresAt: string | null | undefined,
  hasAccessToken?: boolean
): ConnectionStatus {
  if (tokenExpiresAt == null || tokenExpiresAt === '' || hasAccessToken === false) {
    return 'no_token';
  }
  const now = Date.now();
  const expiresAt = new Date(tokenExpiresAt).getTime();
  if (Number.isNaN(expiresAt)) return 'no_token';
  if (expiresAt <= now) return 'expired';
  if (expiresAt <= now + TWENTY_FOUR_HOURS_MS) return 'expiring_soon';
  return 'active';
}
