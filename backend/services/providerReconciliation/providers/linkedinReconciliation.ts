/**
 * LinkedIn reconciliation lookup — REAL implementation.
 *
 * Calls `GET /rest/posts/<urn-encoded-post-urn>` to verify whether the
 * platform_post_id (a `urn:li:share:*` / `urn:li:ugcPost:*` / `urn:li:post:*`
 * URN stored from the publish step) still corresponds to a live LinkedIn post.
 *
 * Classification:
 *   non-URN id → unverifiable (a synthetic fallback id from a publish whose
 *              response carried no URN; looking it up yields a 404 that would
 *              otherwise be misreported as 'no_match')
 *   200      → exact_match (with timestamp + author + permalink in result)
 *   404      → no_match (deleted or never existed)
 *   426, or any status whose body says the requested version is not active
 *            → unverifiable (LinkedIn-Version expired — operator must bump).
 *              Checked BEFORE 401/403: a sunset version can surface on those
 *              statuses too, and reporting it as an auth failure sends the
 *              operator to reconnect accounts that are perfectly healthy.
 *   401/403  → unverifiable (auth expired / scope missing)
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
import { isLinkedInVersionSunsetSignal } from '../../../adapters/linkedin/linkedinVersionSignal';
import {
  registerProviderReconciliationLookup,
  type ProviderReconciliationLookup,
  type ReconciliationLookupResult,
} from '../types';

// Bumped 2026-09-16 with backend/adapters/linkedinAdapter.ts and
// backend/adapters/linkedin/linkedinMediaUpload.ts — see the note there.
const LINKEDIN_API_VERSION = '202608';
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

    // The stored id must actually be a LinkedIn URN before it is worth a
    // lookup. linkedinAdapter falls back to `linkedin_<Date.now()}` when a
    // 2xx publish carries no x-restli-id header and no id in the body — the
    // post IS live, but its real URN was never captured. Sending that
    // synthetic id to GET /rest/posts/<id> produced a 404, which this module
    // classifies as 'no_match' — "deleted or never existed" — about a post
    // that was genuinely published. That is a fabricated verdict, and it is a
    // worse outcome than admitting the id is unusable.
    //
    // This module's own contract (see the header) is that anything it cannot
    // verify returns 'unverifiable' and stays observation-only; a
    // non-URN id is exactly that case.
    if (!platformPostId.startsWith('urn:li:')) {
      return unverifiable(
        `platform_post_id "${platformPostId}" is not a LinkedIn URN, so it cannot be looked up. ` +
          `The publish succeeded without LinkedIn returning a post URN (no x-restli-id header and no id ` +
          `in the body), and the adapter stored a synthetic id. Verify the post manually; nothing here ` +
          `can confirm or deny it.`,
      );
    }

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
    if (r.status === 429) {
      return unverifiable('LinkedIn rate limit (429); reconciliation will retry on the next pass');
    }
    if (!r.ok) {
      // Read the body ONCE, before classifying: the sunset-version signal
      // lives in it and the response stream can only be consumed a single
      // time. The version check runs ahead of 401/403 deliberately — a sunset
      // LinkedIn-Version can come back on those statuses, and calling it an
      // auth failure sends the operator to reconnect healthy accounts.
      const body = await r.text().catch(() => '');
      if (r.status === 426 || isLinkedInVersionSunsetSignal(body)) {
        return unverifiable(
          `LinkedIn API version ${LINKEDIN_API_VERSION} is not active (HTTP ${r.status}); bump LINKEDIN_API_VERSION in linkedinAdapter.ts, linkedin/linkedinMediaUpload.ts and this file`,
        );
      }
      if (r.status === 401 || r.status === 403) {
        return unverifiable(`LinkedIn auth (${r.status}); re-authorize the account or refresh the token`);
      }
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
