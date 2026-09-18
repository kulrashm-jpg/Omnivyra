/**
 * Facebook reconciliation lookup — REAL implementation.
 *
 * Calls Facebook Graph API:
 *   GET https://graph.facebook.com/v22.0/<post-id>
 *       ?fields=id,permalink_url,created_time,from
 *       &access_token=<token>
 *
 * Classification: same shape as Instagram (both use the Graph API).
 *   200 with id          → exact_match
 *   400/code=100 or 404  → no_match
 *   401 / OAuthException → unverifiable (auth)
 *   429                  → unverifiable (rate limit)
 *   5xx                  → unverifiable (transient)
 *
 * Token: page-scoped access token (since FB posts are owned by a Page).
 *   `getToken(socialAccountId)` now delivers exactly that for Facebook rows:
 *   the OAuth callback stores the resolved Page's own token as the row's
 *   credential, alongside `linked_page_id` / `page_access_token`, instead of
 *   the USER token it used to store. This line previously described an intent
 *   the surrounding code could not satisfy; it now describes the contract.
 *
 * Graph API version: pinned to v22.0, the version every other Graph caller in
 * this repo uses (adapters, connectors, OAuth callbacks, analytics and
 * engagement ingestion). This module was left on v18.0 when the rest of the
 * repo moved — the same silent-drift failure the LinkedIn version pin hit.
 * backend/tests/unit/metaGraphApiVersionConsistency.test.ts now fails if any
 * Graph caller drifts again.
 *
 * Endpoint compatibility was checked before the string was changed: this is a
 * plain node read with a `fields` projection, the same call shape already
 * issued against v22.0 elsewhere in the repo — GET /v22.0/<post-id>/comments
 * (engagementIngestionService), GET /v22.0/<post-id>/insights
 * (platformAnalyticsIngester) and GET /v22.0/<container-id>?fields=status_code
 * (instagramAdapter). The version alone implies no parameter, field or
 * response-shape change, and none was made.
 *
 * UNTESTED against real Facebook Graph API at code-ship time.
 */

import { getToken } from '../../../auth/tokenStore';
import {
  registerProviderReconciliationLookup,
  type ProviderReconciliationLookup,
  type ReconciliationLookupResult,
} from '../types';

const GRAPH_BASE = 'https://graph.facebook.com/v22.0';

function unverifiable(diagnostic: string): ReconciliationLookupResult {
  return { confidence: 'unverifiable', diagnostic };
}

const facebookReconciliation: ProviderReconciliationLookup = {
  platform: 'facebook',
  name: 'Facebook',
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

    const postId = encodeURIComponent(platformPostId);
    const url = `${GRAPH_BASE}/${postId}?fields=id,permalink_url,created_time,from&access_token=${encodeURIComponent(token.access_token)}`;

    let r: Response;
    try {
      r = await fetch(url, { method: 'GET' });
    } catch (err) {
      return unverifiable(`network: ${(err as Error).message}`);
    }

    if (r.status === 404) {
      return {
        confidence: 'no_match',
        diagnostic: `Facebook Graph 404 for ${platformPostId}`,
        platformPostId,
      };
    }
    if (r.status === 429) {
      return unverifiable('Facebook Graph rate limit (429); reconciliation will retry');
    }

    let parsed: Record<string, any> = {};
    try {
      parsed = await r.json();
    } catch {
      return unverifiable('Facebook Graph response unparseable');
    }

    if (!r.ok) {
      const errInfo = parsed?.error;
      const type = String(errInfo?.type ?? '');
      const code = Number(errInfo?.code ?? 0);
      if (code === 100 || type === 'GraphMethodException') {
        return {
          confidence: 'no_match',
          diagnostic: `Facebook Graph ${r.status}/code=${code}: ${errInfo?.message ?? 'no such object'}`,
          platformPostId,
        };
      }
      if (type === 'OAuthException' || r.status === 401 || r.status === 403) {
        return unverifiable(`Facebook Graph auth (${r.status}/${type}): re-authorize`);
      }
      return unverifiable(`Facebook Graph ${r.status}: ${String(errInfo?.message ?? '').slice(0, 200)}`);
    }

    if (!parsed.id) return unverifiable('Facebook Graph 200 but missing id');

    const idsMatch = String(parsed.id) === platformPostId;
    const fromName = typeof parsed?.from?.name === 'string' ? parsed.from.name : undefined;
    const fromId = typeof parsed?.from?.id === 'string' ? parsed.from.id : undefined;
    return {
      confidence: idsMatch ? 'exact_match' : 'likely_match',
      platformPostId: String(parsed.id),
      postUrl: typeof parsed.permalink_url === 'string' ? parsed.permalink_url : undefined,
      publishedAt: typeof parsed.created_time === 'string' ? parsed.created_time : undefined,
      diagnostic: `Facebook Graph 200; from=${fromName ?? fromId ?? 'unknown'}, created_time=${parsed.created_time ?? 'unknown'}${idsMatch ? '' : `; id mismatch (db=${platformPostId} provider=${parsed.id})`}`,
    };
  },
};

registerProviderReconciliationLookup(facebookReconciliation);
