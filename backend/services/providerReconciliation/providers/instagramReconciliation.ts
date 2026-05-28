/**
 * Instagram reconciliation lookup — REAL implementation.
 *
 * Calls Instagram Graph API:
 *   GET https://graph.facebook.com/v18.0/<ig-media-id>
 *       ?fields=id,permalink,timestamp,owner,media_type
 *       &access_token=<token>
 *
 * Classification:
 *   200 with id              → exact_match
 *   404 or 400/100 (Graph)   → no_match (Instagram returns 400 for missing media)
 *   401 / OAuthException     → unverifiable (auth)
 *   429                      → unverifiable (rate limit)
 *   5xx                      → unverifiable (transient)
 *
 * Token: from getToken(socialAccountId). For IG Business accounts this is
 * typically the long-lived Page-scoped access token (since IG Business is
 * connected through a Facebook Page).
 *
 * UNTESTED against real Instagram Graph API at code-ship time.
 */

import { getToken } from '../../../auth/tokenStore';
import {
  registerProviderReconciliationLookup,
  type ProviderReconciliationLookup,
  type ReconciliationLookupResult,
} from '../types';

const GRAPH_BASE = 'https://graph.facebook.com/v18.0';

function unverifiable(diagnostic: string): ReconciliationLookupResult {
  return { confidence: 'unverifiable', diagnostic };
}

const instagramReconciliation: ProviderReconciliationLookup = {
  platform: 'instagram',
  name: 'Instagram',
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

    const mediaId = encodeURIComponent(platformPostId);
    const url = `${GRAPH_BASE}/${mediaId}?fields=id,permalink,timestamp,owner,media_type&access_token=${encodeURIComponent(token.access_token)}`;

    let r: Response;
    try {
      r = await fetch(url, { method: 'GET' });
    } catch (err) {
      return unverifiable(`network: ${(err as Error).message}`);
    }

    if (r.status === 404) {
      return {
        confidence: 'no_match',
        diagnostic: `Instagram Graph 404 for ${platformPostId}`,
        platformPostId,
      };
    }
    if (r.status === 429) {
      return unverifiable('Instagram Graph rate limit (429); reconciliation will retry');
    }

    let parsed: Record<string, any> = {};
    try {
      parsed = await r.json();
    } catch {
      return unverifiable('Instagram Graph response unparseable');
    }

    // Graph API often returns 400 + { error: { type: 'OAuthException' | 'GraphMethodException', ... } }
    if (!r.ok) {
      const errInfo = parsed?.error;
      const type = String(errInfo?.type ?? '');
      const code = Number(errInfo?.code ?? 0);
      // Code 100 is "no such object exists" — treat as no_match
      if (code === 100 || type === 'GraphMethodException') {
        return {
          confidence: 'no_match',
          diagnostic: `Instagram Graph ${r.status}/code=${code}: ${errInfo?.message ?? 'no such object'}`,
          platformPostId,
        };
      }
      if (type === 'OAuthException' || r.status === 401 || r.status === 403) {
        return unverifiable(`Instagram Graph auth (${r.status}/${type}): re-authorize`);
      }
      return unverifiable(`Instagram Graph ${r.status}: ${String(errInfo?.message ?? '').slice(0, 200)}`);
    }

    if (!parsed.id) return unverifiable('Instagram Graph 200 but missing id');

    const idsMatch = String(parsed.id) === platformPostId;
    const permalink = typeof parsed.permalink === 'string' ? parsed.permalink : undefined;
    const ownerId = typeof parsed?.owner?.id === 'string' ? parsed.owner.id : undefined;
    const mediaType = typeof parsed.media_type === 'string' ? parsed.media_type : undefined;

    return {
      confidence: idsMatch ? 'exact_match' : 'likely_match',
      platformPostId: String(parsed.id),
      postUrl: permalink,
      publishedAt: typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined,
      diagnostic: `Instagram Graph 200; owner=${ownerId ?? 'unknown'}, media_type=${mediaType ?? 'unknown'}${idsMatch ? '' : `; id mismatch (db=${platformPostId} provider=${parsed.id})`}`,
    };
  },
};

registerProviderReconciliationLookup(instagramReconciliation);
