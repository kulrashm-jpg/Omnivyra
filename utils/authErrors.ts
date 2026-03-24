/**
 * Centralized auth error utilities.
 *
 * All ACCOUNT_DELETED responses from the API use the uniform contract:
 *   { error: 'ACCOUNT_DELETED', code: 'AUTH_001' }
 *
 * Use these helpers on the client side to detect and handle auth errors
 * consistently across all fetch call sites.
 */

/** Returns true when an API response signals that the account has been deleted. */
export function isAccountDeleted(res: Response, data: unknown): boolean {
  return (
    (res.status === 401 || res.status === 403) &&
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>).code === 'AUTH_001'
  );
}

/** Returns true when an API response signals an invalid or expired auth token. */
export function isAuthError(res: Response): boolean {
  return res.status === 401 || res.status === 403;
}

/**
 * Parses a fetch Response and throws a structured error if the account is deleted.
 * Useful as a one-liner in fetch chains.
 *
 * @example
 *   const data = await res.json();
 *   assertNotDeleted(res, data);          // throws if AUTH_001
 *   processData(data);
 */
export function assertNotDeleted(res: Response, data: unknown): void {
  if (isAccountDeleted(res, data)) {
    throw Object.assign(new Error('ACCOUNT_DELETED'), { code: 'AUTH_001' });
  }
}
