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
