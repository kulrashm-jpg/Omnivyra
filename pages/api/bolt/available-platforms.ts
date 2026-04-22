/**
 * GET /api/bolt/available-platforms?companyId=...
 *
 * Returns social platforms the company has actually connected (active rows in
 * social_accounts — i.e., OAuth-completed at the company admin level), sorted
 * by priority and (for the default 'text' mode) filtered to BOLT-text-eligible
 * platforms. Pass ?mode=all to skip the text filter.
 *
 * Used by the BOLT Text strategy builder so users can pick which of the
 * company's connected platforms a given campaign should target.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getProfile } from '../../../backend/services/companyProfileService';
import { getConnectedPlatformsForCompany } from '../../../backend/utils/platformEligibility';
import { filterBoltPlatforms } from '../../../backend/utils/boltTextContentConfig';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId.trim() : null;
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  try {
    const profile = await getProfile(companyId, { autoRefine: false, languageRefine: false }).catch(() => null);
    const connected = await getConnectedPlatformsForCompany(companyId, profile);
    const mode = typeof req.query.mode === 'string' ? req.query.mode.toLowerCase() : 'text';
    const platforms = mode === 'all' ? connected : filterBoltPlatforms(connected);
    return res.status(200).json({ platforms });
  } catch (err) {
    console.error('[bolt/available-platforms]', err);
    return res.status(500).json({ error: 'Failed to load available platforms' });
  }
}
