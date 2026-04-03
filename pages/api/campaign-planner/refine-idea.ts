
/**
 * POST /api/campaign-planner/refine-idea
 * Refines a campaign idea using AI.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getProfile } from '../../../backend/services/companyProfileService';
import { refineCampaignIdea } from '../../../backend/services/ideaRefinementService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user, error: authError } = await getSupabaseUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }

    const body = req.body || {};
    const ideaText = typeof body.idea_text === 'string' ? body.idea_text.trim() : '';
    const companyId = typeof body.companyId === 'string' ? body.companyId.trim() : null;
    const recommendationContext =
      body.recommendation_context && typeof body.recommendation_context === 'object'
        ? body.recommendation_context
        : null;
    const opportunityContext =
      body.opportunity_context && typeof body.opportunity_context === 'object'
        ? body.opportunity_context
        : null;

    if (!ideaText) {
      return res.status(400).json({ error: 'Campaign idea cannot be empty.' });
    }

    let companyProfile: Record<string, unknown> | null = null;
    if (companyId) {
      const profile = await getProfile(companyId, { autoRefine: false, languageRefine: false });
      if (profile) {
        companyProfile = profile as unknown as Record<string, unknown>;
      }
    }

    const result = await refineCampaignIdea({
      idea_text: ideaText,
      company_profile: companyProfile,
      recommendation_context: recommendationContext,
      opportunity_context: opportunityContext,
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error('Refine idea error:', err);
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return res.status(500).json({ error: msg });
  }
}
