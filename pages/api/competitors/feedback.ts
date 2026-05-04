import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';

import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { getProfile } from '../../../backend/services/companyProfileService';
import {
  buildCandidatesFromNames,
  extractCompetitiveContextFromProfile,
  getFinalCompetitors,
} from '../../../backend/services/competitorEngineService';
import {
  recordCompetitorFeedback,
  type CompetitorFeedbackType,
} from '../../../backend/services/competitorFeedbackService';

type Body = {
  company_id?: string;
  companyId?: string;
  competitor_name?: string;
  competitorName?: string;
  category?: string;
  feedback_type?: string;
  feedbackType?: string;
};

function readText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parseFeedbackType(value: unknown): CompetitorFeedbackType | null {
  const type = readText(value).toLowerCase();
  if (type === 'correct' || type === 'incorrect' || type === 'missing') return type;
  return null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body ?? {}) as Body;
    const companyId = readText(body.company_id ?? body.companyId ?? user?.defaultCompanyId);
    const competitorName = readText(body.competitor_name ?? body.competitorName);
    const feedbackType = parseFeedbackType(body.feedback_type ?? body.feedbackType);

    if (!companyId) return res.status(400).json({ error: 'company_id required' });
    if (!competitorName) return res.status(400).json({ error: 'competitor_name required' });
    if (!feedbackType) {
      return res.status(400).json({ error: "feedback_type must be 'correct', 'incorrect', or 'missing'" });
    }

    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;

    const profile = await getProfile(companyId, { autoRefine: false, languageRefine: false });
    const context = profile
      ? extractCompetitiveContextFromProfile(profile)
      : {
          marketFocus: readText(body.category) || null,
          primaryService: null,
          targetCustomer: null,
          idealCustomerProfile: null,
          brandPositioning: null,
          geography: null,
          teamSize: null,
          foundedYear: null,
          revenueRange: null,
          businessModel: null,
        };
    const feedback = await recordCompetitorFeedback({
      companyId,
      competitorName,
      category: readText(body.category) || profile?.category || profile?.industry || context.marketFocus,
      feedbackType,
    });

    const validatedCompetitors = feedbackType === 'missing'
      ? await getFinalCompetitors({
          candidates: buildCandidatesFromNames([competitorName], 'manual'),
          context,
          companyId,
          max: 1,
          useNetwork: true,
          useStoredCache: false,
        })
      : [];

    return res.status(200).json({
      success: true,
      feedback,
      validated_competitor: validatedCompetitors[0] ?? null,
      included_in_future_suggestions: feedbackType !== 'missing' || validatedCompetitors.length > 0,
    });
  } catch (error) {
    console.error('[competitors/feedback]', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to record competitor feedback' });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

