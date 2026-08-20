import type { CardSuggestions } from './types';

/**
 * P1.8 — brief-suggestion chip fetching.
 *
 * Previously this ran as `for (…) { await fetch(…) }` inside the hook: N
 * AI-backed round-trips strictly one after another, so the chips for the last
 * card waited on every card before it. The requests are independent, so they
 * now run concurrently.
 *
 * Deliberately unchanged: the endpoint, the request body (and therefore the
 * prompt), the billing semantics, the number of cards, and the rule that one
 * failing card must never fail the page.
 *
 * Results are keyed by the card's ORIGINAL index rather than by completion
 * order, so card ordering is unaffected by which response lands first.
 */

export const BRIEF_SUGGESTIONS_ENDPOINT = '/api/company/blog/brief-suggestions';

export type BriefSuggestionRequest = {
  /** Position in the cards array — the key the UI reads chips back by. */
  index: number;
  /** Request body, built by the caller so this helper owns no prompt shape. */
  body: unknown;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

export async function fetchCardSuggestions(
  requests: BriefSuggestionRequest[],
  fetchImpl?: FetchLike,
): Promise<Record<number, CardSuggestions>> {
  const doFetch = (fetchImpl ?? (fetch as unknown as FetchLike));

  const settled = await Promise.all(
    requests.map(async ({ index, body }) => {
      try {
        const response = await doFetch(BRIEF_SUGGESTIONS_ENDPOINT, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) return null;
        return { index, data: (await response.json()) as CardSuggestions };
      } catch {
        // Isolated per card: this one goes without chips, the rest still render.
        return null;
      }
    }),
  );

  const results: Record<number, CardSuggestions> = {};
  for (const entry of settled) {
    if (entry) results[entry.index] = entry.data;
  }
  return results;
}
