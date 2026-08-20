/**
 * Command Center — one subscription read per company, shared by both consumers.
 *
 * `/api/user/subscription?company_id=…` was requested twice on every load: once
 * inside the readiness wave (for buildSetupSignals' subscriptionTier) and once
 * by loadUserTier (for the `userTier` state). Same URL, same company, same
 * field — two raw fetches, so nothing deduplicated them.
 *
 * They are NOT merged into one consumer. Their gates, fallbacks and timing
 * differ and are load-bearing: loadUserTier resolves as soon as its own request
 * returns (~1-3s), while the readiness wave's value is only usable once all 17
 * of its requests settle (~11s in the measured load). Making either wait for
 * the other would trade a duplicate request for a slower one.
 *
 * Instead they share the in-flight request through the repository's existing
 * singleFlight helper — the same primitive CompanyContext already uses for the
 * company-profile list. Concurrent callers receive the same promise; whoever
 * asks first starts the request and both settle together.
 *
 * The result is the PARSED outcome, not the Response: a Response body can only
 * be read once, so sharing the Response itself would break the second caller.
 */
import { singleFlight } from '../lib/auth/singleFlightRefresh';

/**
 * Mirrors the outcomes the two call sites already distinguished, so each keeps
 * its own logging and fallback rather than collapsing to a single shape.
 */
export type SubscriptionFetchResult =
  | { outcome: 'ok'; json: unknown }
  | { outcome: 'non_ok' }
  | { outcome: 'error'; error: unknown };

export const subscriptionKey = (companyId: string): string => `user-subscription:${companyId}`;

export function fetchSubscriptionOnce(
  companyId: string,
  fetchImpl?: typeof fetch,
): Promise<SubscriptionFetchResult> {
  const doFetch = fetchImpl ?? fetch;
  return singleFlight<SubscriptionFetchResult>(subscriptionKey(companyId), async () => {
    try {
      const response = await doFetch(
        `/api/user/subscription?company_id=${encodeURIComponent(companyId)}`,
        { method: 'GET', headers: { 'Content-Type': 'application/json' } },
      );
      if (!response.ok) return { outcome: 'non_ok' };
      return { outcome: 'ok', json: await response.json() };
    } catch (error) {
      return { outcome: 'error', error };
    }
  });
}
