import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * GET /api/social-accounts/postable-platforms?companyId=...&contentType=post
 *
 * Returns the social platforms a company can publish a piece of content of
 * the requested type to RIGHT NOW. "Right now" = OAuth-active row in
 * `social_accounts` AND token not expired AND the platform supports the
 * requested content type (text, video, image).
 *
 * Single source of truth for the post-result chip filter, the multi-platform
 * scheduler picker, and BOLT's available-platforms endpoint. All three flows
 * call this so they can never disagree.
 *
 * Implementation lives in `backend/utils/contentTypePostability.ts` â€” that
 * module composes `getConnectedPlatformsForCompany` (from platformEligibility)
 * with the per-content-type eligibility rules.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { refreshExpiringSocialAccountsForCompany } from '../../../backend/auth/tokenRefresh';
import { getPostablePlatformsForContentType } from '../../../backend/utils/contentTypePostability';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId.trim() : '';
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const contentType = typeof req.query.contentType === 'string' && req.query.contentType.trim()
    ? req.query.contentType.trim()
    : 'post';

  // Proactively refresh any tokens nearing expiry before reading status.
  // /api/social-accounts/status does the same; mirror it here so consumers
  // calling THIS endpoint (instead of /status) still benefit from the
  // pre-flight refresh and don't see a platform spuriously dropped because
  // its token is 1 minute past expiry.
  try {
    await refreshExpiringSocialAccountsForCompany(companyId);
  } catch (err: any) {
    // Non-fatal â€” fall through and report whatever state we have.
    console.warn('[postable-platforms] proactive token refresh failed:', err?.message);
  }

  try {
    const platforms = await getPostablePlatformsForContentType({ companyId, contentType });
    return res.status(200).json({ platforms });
  } catch (err) {
    console.error('[postable-platforms] failed:', err);
    return res.status(500).json({ error: 'Failed to load postable platforms' });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

