import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * GET /api/bolt/available-platforms?companyId=...
 *
 * Returns social platforms the company has actually connected (active rows in
 * social_accounts â€” i.e., OAuth-completed at the company admin level), sorted
 * by priority and (for the default 'text' mode) filtered to BOLT-text-eligible
 * platforms. Pass ?mode=all to skip the text filter.
 *
 * Used by the BOLT Text strategy builder so users can pick which of the
 * company's connected platforms a given campaign should target.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getConnectedPlatformsForCompany } from '../../../backend/utils/platformEligibility';
import { getPostablePlatformsForContentType } from '../../../backend/utils/contentTypePostability';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId.trim() : null;
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  try {
    const mode = typeof req.query.mode === 'string' ? req.query.mode.toLowerCase() : 'text';
    if (mode === 'all') {
      const connected = await getConnectedPlatformsForCompany(companyId);
      return res.status(200).json({ platforms: connected });
    }
    // BOLT is text-only. Delegate to the shared postability helper (which
    // composes getConnectedPlatformsForCompany with the same text-platform
    // exclusion set BOLT used to apply locally) so the BOLT picker, the post
    // result chips, and the multi-platform scheduler can never disagree.
    const postable = await getPostablePlatformsForContentType({ companyId, contentType: 'post' });
    return res.status(200).json({ platforms: postable.map((p) => p.platform_key) });
  } catch (err) {
    console.error('[bolt/available-platforms]', err);
    return res.status(500).json({ error: 'Failed to load available platforms' });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

