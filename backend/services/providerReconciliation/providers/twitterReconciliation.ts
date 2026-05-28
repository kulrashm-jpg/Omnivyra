/**
 * X/Twitter reconciliation lookup — REAL implementation.
 *
 * Calls `GET https://api.twitter.com/2/tweets/<id>?tweet.fields=id,text,author_id,created_at`
 *
 * Classification:
 *   200 with data        → exact_match
 *   200 with errors[]
 *     containing "deleted" or "not found" → no_match
 *   404                  → no_match
 *   401/403              → unverifiable (auth)
 *   429                  → unverifiable (rate limited; reconciliation retries)
 *   5xx                  → unverifiable (transient)
 *
 * Token: uses the account's bearer access_token from getToken(socialAccountId).
 * No token refresh attempted here — the publish-path refresh dance (which
 * involves OAuth 2 PKCE for X) is too invasive to duplicate in a read-only
 * reconciliation lookup. 401 → reconciliation comes back next pass after
 * publish path refreshes.
 *
 * UNTESTED against real X API at code-ship time. Foundation contract
 * preserved: any error path returns `unverifiable`.
 */

import { getToken } from '../../../auth/tokenStore';
import {
  registerProviderReconciliationLookup,
  type ProviderReconciliationLookup,
  type ReconciliationLookupResult,
} from '../types';

function unverifiable(diagnostic: string): ReconciliationLookupResult {
  return { confidence: 'unverifiable', diagnostic };
}

const TWITTER_BASE = 'https://api.twitter.com/2';

const twitterReconciliation: ProviderReconciliationLookup = {
  platform: 'twitter',
  name: 'X / Twitter',
  async lookup({ row, socialAccountId }): Promise<ReconciliationLookupResult> {
    const platformPostId = (row as { platform_post_id?: string | null }).platform_post_id;
    if (!platformPostId) return unverifiable('Row has no platform_post_id');

    let token;
    try {
      token = await getToken(socialAccountId);
    } catch (err) {
      return unverifiable(`getToken threw: ${(err as Error).message}`);
    }
    if (!token?.access_token) return unverifiable('No access token for socialAccount');

    const tweetId = encodeURIComponent(platformPostId);
    const url = `${TWITTER_BASE}/tweets/${tweetId}?tweet.fields=id,text,author_id,created_at`;

    let r: Response;
    try {
      r = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
    } catch (err) {
      return unverifiable(`network: ${(err as Error).message}`);
    }

    if (r.status === 404) {
      return {
        confidence: 'no_match',
        diagnostic: `X 404 for tweet ${platformPostId}; deleted or never existed`,
        platformPostId,
      };
    }
    if (r.status === 401 || r.status === 403) {
      return unverifiable(`X auth (${r.status}); re-authorize or refresh token`);
    }
    if (r.status === 429) {
      return unverifiable('X rate limit (429); reconciliation will retry');
    }
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return unverifiable(`X ${r.status}: ${body.slice(0, 200)}`);
    }

    let parsed: { data?: { id?: string; text?: string; author_id?: string; created_at?: string }; errors?: Array<{ title?: string; detail?: string; type?: string }> } = {};
    try {
      parsed = (await r.json()) as typeof parsed;
    } catch {
      return unverifiable('X 200 with unparseable body');
    }

    // X returns 200 with errors[] when the tweet was deleted or is otherwise unavailable.
    if (!parsed.data && Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      const err = parsed.errors[0];
      const text = `${err.title ?? ''} ${err.detail ?? ''}`.toLowerCase();
      if (text.includes('not found') || text.includes('deleted') || text.includes('does not exist')) {
        return {
          confidence: 'no_match',
          diagnostic: `X 200/errors for ${platformPostId}: ${err.title ?? err.detail ?? 'unknown'}`,
          platformPostId,
        };
      }
      return unverifiable(`X 200/errors not classifiable: ${err.title ?? err.detail ?? 'unknown'}`);
    }

    if (!parsed.data?.id) {
      return unverifiable('X 200 but no data.id and no errors[]');
    }

    const idsMatch = parsed.data.id === platformPostId;
    const permalink = `https://twitter.com/i/web/status/${encodeURIComponent(parsed.data.id)}`;
    return {
      confidence: idsMatch ? 'exact_match' : 'likely_match',
      platformPostId: parsed.data.id,
      postUrl: permalink,
      publishedAt: parsed.data.created_at,
      diagnostic: `X 200; author_id=${parsed.data.author_id ?? 'unknown'}, created_at=${parsed.data.created_at ?? 'unknown'}${idsMatch ? '' : `; id mismatch (db=${platformPostId} provider=${parsed.data.id})`}`,
    };
  },
};

registerProviderReconciliationLookup(twitterReconciliation);
