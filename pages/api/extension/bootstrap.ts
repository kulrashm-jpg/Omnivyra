import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * POST /api/extension/bootstrap
 *
 * Called by the web app (with the user's authenticated cookie-based
 * Supabase session). Creates a short-lived single-use claim code bound to
 * the current user + organization. The web app forwards ONLY this code to
 * the extension via postMessage â€” never the session token itself.
 *
 * The extension service worker then calls POST /api/extension/redeem with
 * the claim code to fetch the real session token + HMAC secret.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { createClaimCode } from '@/backend/services/extensionClaimCodeService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const body = (req.body || {}) as { organization_id?: string; organizationId?: string; companyId?: string };
  const organizationId = (body.organization_id ?? body.organizationId ?? body.companyId ?? '').toString().trim();
  if (!organizationId) {
    return res.status(400).json({ success: false, error: 'organization_id required' });
  }

  try {
    const access = await enforceCompanyAccess({ req, res, companyId: organizationId, requireCampaignId: false });
    if (!access) return;

    const claim = createClaimCode(access.userId, organizationId);
    return res.status(200).json({
      success: true,
      data: {
        claim_code: claim.code,
        expires_at: claim.expiresAt,
        ttl_ms: claim.expiresAt - claim.createdAt,
      },
    });
  } catch (error) {
    console.error('[extension/bootstrap]', error);
    return res.status(500).json({ success: false, error: (error as Error)?.message || 'bootstrap failed' });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

