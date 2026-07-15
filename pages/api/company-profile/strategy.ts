import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  deriveAndStoreStrategyProfile,
  getCompanyProfileReviewStatus,
  saveStrategyProfileOverride,
} from '../../../backend/services/companyProfileService';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
    const companyId =
      (req.query.companyId as string | undefined) ||
      (body.companyId as string | undefined) ||
      (body.company_id as string | undefined);
    const action = String(body.action || '').trim().toLowerCase();

    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }

    const access = await resolveCompanyAccess(req, res, companyId);
    if (!access) return;

    if (action === 'save_override') {
      const strategyProfile = (body.strategyProfile || null) as Parameters<typeof saveStrategyProfileOverride>[1];
      const profile = await saveStrategyProfileOverride(companyId, strategyProfile, { source: 'user' });
      return res.status(200).json({
        profile,
        company_profile_review: getCompanyProfileReviewStatus(profile),
      });
    }

    if (action === 'regenerate') {
      const profile = await deriveAndStoreStrategyProfile(companyId, { forceOverride: Boolean(body.forceOverride) });
      if (!profile) {
        return res.status(404).json({ error: 'Company profile not found' });
      }
      return res.status(200).json({
        profile,
        company_profile_review: getCompanyProfileReviewStatus(profile),
      });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error: any) {
    console.error('Error handling company strategy profile action:', error);
    return res.status(500).json({
      error: error?.message || 'Failed to handle strategy profile action',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/company-profile/strategy' });
