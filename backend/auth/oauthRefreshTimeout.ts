/**
 * Per-request timeout for OAuth token-refresh calls (ms).
 *
 * axios waits forever by default (timeout 0). A refresh runs inside
 * recentPublishedPostsIngest (ingestComments refreshes an expiring or rejected
 * token), whose timer re-arms only after its body returns while its lease keeps
 * renewing - so one OAuth endpoint that never answered froze comment ingestion for
 * every tenant. With this timeout a hung refresh becomes an ordinary failed refresh,
 * which every caller already handles. Timeout only: no refresh logic changes.
 */
export const OAUTH_REFRESH_TIMEOUT_MS = 15_000;

/**
 * D2 policy (virality-e9, option B): a refresh TIMEOUT says nothing about whether the
 * token is valid, so it must never consume the reauth ceiling (RETRY_CEILING in
 * recordRefreshOutcome). A 5xx or any other transient failure still does.
 */
export const REFRESH_TIMEOUT_ERROR = 'refresh_timeout';

/**
 * STRUCTURAL only (GOV-SECURITY, virality-83): the axios error CODE of a request that
 * timed out (ECONNABORTED; ETIMEDOUT for a TCP connect timeout). Never the message or
 * the provider's response body - provider-influenced text must not be able to mark a
 * failure as a timeout and so escape the reauth ceiling.
 */
export function isRefreshTimeoutError(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '');
  return code === 'ECONNABORTED' || code === 'ETIMEDOUT';
}

/**
 * The persisted error is EXACTLY the constant, which only this codebase writes, and
 * only after isRefreshTimeoutError. No substring match: an X provider description
 * that merely contains "timeout" or "ECONNABORTED" is NOT a timeout and still counts
 * (that loop once reached refresh_retry_count 4104).
 */
export function isRefreshTimeoutText(text: string | null | undefined): boolean {
  return String(text ?? '').trim() === REFRESH_TIMEOUT_ERROR;
}

/**
 * The per-platform refreshers swallow their error and return null, so the wrapper
 * (refreshPlatformToken) cannot see WHY a refresh failed. Each refresher's catch
 * notes a timeout here; the wrapper takes the note for that account once. Process-
 * local and keyed by account: the refresh of one account is a single awaited call.
 */
const timedOutAccounts = new Set<string>();
export function noteRefreshFailure(accountId: string, error: unknown): void {
  if (isRefreshTimeoutError(error)) timedOutAccounts.add(accountId);
}
export function takeRefreshTimedOut(accountId: string): boolean {
  const had = timedOutAccounts.has(accountId);
  timedOutAccounts.delete(accountId);
  return had;
}
