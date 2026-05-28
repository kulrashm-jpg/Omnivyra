/**
 * LinkedIn reconciliation lookup — REAL implementation.
 *
 * Calls `GET /rest/posts/<urn-encoded-post-urn>` to verify whether the
 * platform_post_id (a `urn:li:share:*` / `urn:li:ugcPost:*` / `urn:li:post:*`
 * URN stored from the publish step) still corresponds to a live LinkedIn post.
 *
 * Classification:
 *   200      → exact_match (with timestamp + author + permalink in result)
 *   404      → no_match (deleted or never existed)
 *   401/403  → unverifiable (auth expired / scope missing)
 *   426      → unverifiable (LinkedIn-Version expired — operator must bump)
 *   429/5xx  → unverifiable (transient; reconciliation will re-try later)
 *
 * Token is loaded via `getToken(socialAccountId)`. No token refresh attempted
 * here — if 401 fires, operator can re-run reconciliation after the next
 * publish-path refresh OR re-authorize the account.
 *
 * UNTESTED against real LinkedIn API at code-ship time. Operator MUST validate
 * end-to-end against a real LinkedIn account before relying on the telemetry
 * signal. Foundation contract preserved: any error path returns `unverifiable`
 * so reconciliation stays observation-only.
 */

import { getToken } from '../../../auth/tokenStore';
import {
  registerProviderReconciliationLookup,
  type ProviderReconciliationLookup,
  type ReconciliationLookupResult,
} from '../types';

const LINKEDIN_API_VERSION = '202507';
const LINKEDIN_BASE = 'https://api.linkedin.com/rest';

function unverifiable(diagnostic: string): ReconciliationLookupResult {
  return { confidence: 'unverifiable', diagnostic };
}

const linkedinReconciliation: ProviderReconciliationLookup = {
  platform: 'linkedin',
  name: 'LinkedIn',
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

    const urlEncodedUrn = encodeURIComponent(platformPostId);
    let r: Response;
    try {
      r = await fetch(`${LINKEDIN_BASE}/posts/${urlEncodedUrn}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          'LinkedIn-Version': LINKEDIN_API_VERSION,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      });
    } catch (err) {
      return unverifiable(`network: ${(err as Error).message}`);
    }

    if (r.status === 404) {
      return {
        confidence: 'no_match',
        diagnostic: `LinkedIn 404 for ${platformPostId}; post is deleted or was never visible at this URN`,
        platformPostId,
      };
    }
    if (r.status === 401 || r.status === 403) {
      return unverifiable(`LinkedIn auth (${r.status}); re-authorize the account or refresh the token`);
    }
    if (r.status === 426) {
      return unverifiable(`LinkedIn API version ${LINKEDIN_API_VERSION} expired (426); bump LINKEDIN_API_VERSION`);
    }
    if (r.status === 429) {
      return unverifiable('LinkedIn rate limit (429); reconciliation will retry on the next pass');
    }
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return unverifiable(`LinkedIn ${r.status}: ${body.slice(0, 200)}`);
    }

    let parsed: Record<string, unknown> = {};
    try {
      parsed = (await r.json()) as Record<string, unknown>;
    } catch {
      return unverifiable('LinkedIn 200 with unparseable body');
    }

    const author = typeof parsed.author === 'string' ? parsed.author : undefined;
    const createdAtRaw = parsed.createdAt;
    const createdAtIso = typeof createdAtRaw === 'number'
      ? new Date(createdAtRaw).toISOString()
      : typeof createdAtRaw === 'string' ? createdAtRaw : undefined;
    const permalink = `https://www.linkedin.com/feed/update/${encodeURIComponent(platformPostId)}`;

    return {
      confidence: 'exact_match',
      platformPostId,
      postUrl: permalink,
      publishedAt: createdAtIso,
      diagnostic: `LinkedIn 200; author=${author ?? 'unknown'}, createdAt=${createdAtIso ?? 'unknown'}`,
    };
  },
};

registerProviderReconciliationLookup(linkedinReconciliation);
