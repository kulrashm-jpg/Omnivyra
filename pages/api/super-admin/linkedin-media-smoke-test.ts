/**
 * POST /api/super-admin/linkedin-media-smoke-test
 *
 * Operator validation surface for the LinkedIn media upload pipeline.
 * Exercises the FULL upload chain (register → PUT binary → finalize video →
 * poll → write URN cache) against a real LinkedIn account WITHOUT a
 * `POST /rest/posts` publish at the end.
 *
 * Used during the LinkedIn media activation soak (Step 2 of the runbook).
 * After Step 2 succeeds end-to-end against a real LinkedIn sandbox account,
 * the operator flips `ADAPTER_CAN_PUBLISH_MEDIA[linkedin]=true` in
 * publishReadinessValidator.ts and proceeds to full scheduler dispatch.
 *
 * Behavior:
 *   - Resolves the scheduled_posts row's user/social_account_id
 *   - Loads the OAuth token via getToken
 *   - Calls getOrUploadLinkedInAsset for the given sourceUrl + mimeType
 *   - Returns the upload outcome + the URN cache state after the call
 *
 * Note: the asset uploaded to LinkedIn ends up in the account's asset library
 * but is NOT published to the feed (no Posts API call). LinkedIn cleans up
 * unused assets server-side over time. Re-running the same smoke test on the
 * same sourceUrl reuses the cached URN — no duplicate upload.
 *
 * Strict rules respected:
 *   - No publish to LinkedIn feed (operator-controlled validation)
 *   - LINKEDIN_MEDIA_UPLOAD_ENABLED is the activation gate the adapter checks
 *     in its publish path; this endpoint bypasses that env check by calling
 *     the helper directly — INTENTIONAL for smoke testing. The endpoint
 *     itself is capability-gated to super-admin so unauthorized callers
 *     cannot trigger uploads.
 *   - No row mutation other than the URN cache write that getOrUploadLinkedInAsset
 *     already performs (additive JSONB sub-key).
 *
 * Auth: requireCapability(CONTENT_PUBLISH).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSocialAccount } from '../../../backend/db/queries';
import { getToken } from '../../../backend/auth/tokenStore';
import { requireCapability } from '../../../backend/security/requireCapability';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { CONTENT_PUBLISH } from '../../../shared/contracts/security/SecurityCapabilities';
import {
  getOrUploadLinkedInAsset,
  inferLinkedInMediaKind,
} from '../../../backend/adapters/linkedin/linkedinMediaUpload';
import {
  insertAuditLogStrict,
  SYSTEM_USER_ID,
} from '../../../backend/services/auditActorService';

interface SmokeTestBody {
  scheduledPostId?: string;
  socialAccountId?: string;
  sourceUrl?: string;
  mimeType?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:linkedin-smoke', 10, 60))) return;

  const guard = await requireCapability(req, res, {
    capability: CONTENT_PUBLISH,
    reason: 'operator smoke-tests LinkedIn media upload pipeline',
  });
  if (guard.ok !== true) return;
  const actorUserId = guard.principal.userId || SYSTEM_USER_ID;

  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}) as SmokeTestBody;
  const scheduledPostId = String(body.scheduledPostId ?? '').trim();
  const socialAccountId = String(body.socialAccountId ?? '').trim();
  const sourceUrl = String(body.sourceUrl ?? '').trim();
  const mimeType = typeof body.mimeType === 'string' && body.mimeType.trim() ? body.mimeType.trim() : undefined;

  if (!scheduledPostId) return res.status(400).json({ error: 'scheduledPostId required (existing row id for URN cache write)' });
  if (!socialAccountId) return res.status(400).json({ error: 'socialAccountId required' });
  if (!sourceUrl) return res.status(400).json({ error: 'sourceUrl required (https URL fetchable by the worker)' });

  const inferredKind = inferLinkedInMediaKind(mimeType || sourceUrl);
  if (!inferredKind) {
    return res.status(400).json({
      error: 'Cannot infer media kind from mimeType/sourceUrl. Pass an explicit mimeType (e.g. image/jpeg).',
    });
  }

  const account = await getSocialAccount(socialAccountId);
  if (!account) return res.status(404).json({ error: 'Social account not found' });
  if (account.platform !== 'linkedin') {
    return res.status(400).json({ error: `Social account is "${account.platform}", expected "linkedin"` });
  }
  if (!account.platform_user_id) {
    return res.status(400).json({ error: 'LinkedIn account is missing platform_user_id; reconnect the account' });
  }

  const token = await getToken(socialAccountId);
  if (!token?.access_token) {
    return res.status(400).json({ error: 'No access_token on social account; reconnect or refresh' });
  }

  const authorUrn = `urn:li:person:${account.platform_user_id}`;
  const startedAtMs = Date.now();

  const outcome = await getOrUploadLinkedInAsset({
    scheduledPostId,
    sourceUrl,
    mimeType,
    auth: { accessToken: token.access_token, authorUrn },
  });
  const outcomeKind = outcome.ok === true ? outcome.result.kind : null;
  const outcomeFromCache = outcome.ok === true ? outcome.result.fromCache : null;
  const outcomeErrorCode = outcome.ok === false ? outcome.error.code : null;

  // Read back the URN cache state for verification (Step 2.D).
  const { data: row } = await supabase
    .from('scheduled_posts')
    .select('creator_attachment_metadata')
    .eq('id', scheduledPostId)
    .maybeSingle();
  const metadata = (row as { creator_attachment_metadata?: unknown } | null)?.creator_attachment_metadata ?? null;
  const cacheState = pickLinkedInCacheState(metadata);

  await insertAuditLogStrict({
    actorUserId,
    action: 'SUPER_ADMIN_LINKEDIN_SMOKE_TEST',
    targetUserId: null,
    companyId: null,
    metadata: {
      capability: CONTENT_PUBLISH,
      scheduled_post_id: scheduledPostId,
      social_account_id: socialAccountId,
      source_url_host: extractHost(sourceUrl),
      mime_type: mimeType ?? null,
      inferred_kind: inferredKind,
      outcome_ok: outcome.ok,
      outcome_kind: outcomeKind,
      outcome_from_cache: outcomeFromCache,
      outcome_error_code: outcomeErrorCode,
      latency_ms: Date.now() - startedAtMs,
    },
  });

  return res.status(200).json({
    scheduled_post_id: scheduledPostId,
    inferred_kind: inferredKind,
    latency_ms: Date.now() - startedAtMs,
    outcome,
    cache_state: cacheState,
  });
}

function pickLinkedInCacheState(metadata: unknown): { entries: number; urls: string[] } {
  if (!metadata || typeof metadata !== 'object') return { entries: 0, urls: [] };
  const providerCache = (metadata as Record<string, unknown>).provider_asset_urns;
  if (!providerCache || typeof providerCache !== 'object') return { entries: 0, urls: [] };
  const linkedinCache = (providerCache as Record<string, unknown>).linkedin;
  if (!linkedinCache || typeof linkedinCache !== 'object') return { entries: 0, urls: [] };
  const urls = Object.keys(linkedinCache as object);
  return { entries: urls.length, urls };
}

function extractHost(url: string): string {
  try { return new URL(url).host; } catch { return '<invalid>'; }
}
