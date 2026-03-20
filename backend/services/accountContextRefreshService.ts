/**
 * Account Context Refresh Service
 *
 * Busts the 12-hour in-memory cache on /api/account-context/analyze
 * before every campaign planning cycle so authority score, engagement
 * trends, and follower growth are always current.
 */

export type AccountContextRefreshResult = {
  account_id: string;
  refreshed: boolean;
  error?: string;
};

/**
 * Trigger a cache-busting refresh of the account context for the given company.
 * Calls the internal API route with `?refresh=1`.
 */
export async function refreshAccountContext(accountId: string): Promise<AccountContextRefreshResult> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const url = `${baseUrl}/api/account-context/analyze?companyId=${encodeURIComponent(accountId)}&refresh=1`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'x-internal-refresh': '1' },
    });

    if (!response.ok) {
      return {
        account_id: accountId,
        refreshed: false,
        error: `HTTP ${response.status}`,
      };
    }

    return { account_id: accountId, refreshed: true };
  } catch (err: unknown) {
    return {
      account_id: accountId,
      refreshed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
