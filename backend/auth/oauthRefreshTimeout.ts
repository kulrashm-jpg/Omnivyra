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

/** axios timeout (ECONNABORTED / "timeout of Nms exceeded") or a TCP connect timeout. */
export function isRefreshTimeoutError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code ?? '');
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return true;
  return /timeout of \d+ms exceeded/i.test(String(e?.message ?? ''));
}

/** The persisted error text of a refresh failure that was a timeout. */
export function isRefreshTimeoutText(text: string | null | undefined): boolean {
  const t = String(text ?? '').toLowerCase();
  return t.startsWith(REFRESH_TIMEOUT_ERROR) || t.includes('econnaborted') || /timeout of \d+ms exceeded/.test(t);
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
