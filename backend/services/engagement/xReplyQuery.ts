/**
 * The one definition of "how do we retrieve replies to an X post".
 *
 * WHY THIS EXISTS
 * ---------------
 * There were two copies of this call — one in `twitterAdapter.ts`, one in
 * `engagementIngestionService.ts` — and BOTH used `/2/tweets/{id}/replies`,
 * which is not an endpoint the X API v2 has ever exposed. Every request 404'd,
 * so reply ingestion never worked, and the adapter/legacy fallback meant each
 * post produced two 404s per cycle.
 *
 * Duplication is what let a wrong URL survive: fixing one copy would have left
 * the other quietly answering 404s. So the URL now exists exactly once, and
 * both call sites import it.
 *
 * X v2 retrieves replies by searching the conversation the post started:
 *   GET /2/tweets/search/recent?query=conversation_id:{id}
 */

/**
 * Recent search only indexes the last 7 days. This is a hard limit of the
 * standard endpoint, NOT a tuning parameter — replies to an older post are not
 * retrievable this way at any page size. Callers must not present results from
 * this path as a complete reply history.
 */
export const X_RECENT_SEARCH_WINDOW_DAYS = 7;

/** X caps `max_results` at 100 for recent search. */
export const X_RECENT_SEARCH_MAX_RESULTS = 100;

/**
 * True when a post is old enough that recent search cannot see its replies.
 * Lets callers skip a request that is guaranteed to return nothing useful.
 */
export function isOutsideXRecentSearchWindow(
  publishedAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!publishedAt) return false; // unknown age — attempt rather than assume
  const t = new Date(publishedAt).getTime();
  if (!Number.isFinite(t)) return false;
  return now - t > X_RECENT_SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Build the conversation-search URL for a post's replies.
 *
 * `conversation_id` is the id of the post that started the thread, which for
 * our own published posts is the platform_post_id we stored.
 */
export function buildXConversationSearchUrl(apiBase: string, conversationId: string): string {
  const params = new URLSearchParams({
    query: `conversation_id:${conversationId}`,
    'tweet.fields': 'created_at,author_id,conversation_id,in_reply_to_user_id',
    max_results: String(X_RECENT_SEARCH_MAX_RESULTS),
  });
  return `${apiBase.replace(/\/$/, '')}/tweets/search/recent?${params.toString()}`;
}
