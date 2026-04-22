/**
 * POST /api/intelligence/recommendation-feedback
 *
 * Records the outcome of a recommendation that was previously shown
 * via /api/intelligence/context. Idempotent — replaying with the
 * same (organization_id, pattern_type, target_id) is safe because
 * the service only flips rows whose accepted_at AND rejected_at are
 * both null.
 *
 * Body:
 *   {
 *     platform?:                 string,
 *     action_type?:              string,
 *     pattern_type:              string,       // from the shown recommendation
 *     target_id?:                string,
 *     outcome:                   'accepted' | 'rejected',
 *     execution_correlation_id?: string,       // when acceptance drove an execution
 *     organization_id?:          string
 *   }
 *
 * Response: { success, updated, row_id?, error? }
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { recordRecommendationOutcome } from '../../../backend/services/intelligence/intelligenceRecommendationService';

type Body = {
  organization_id?: string;
  platform?: string;
  action_type?: string;
  pattern_type?: string;
  target_id?: string;
  outcome?: string;
  execution_correlation_id?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as Body;

    const organizationId = (body.organization_id ?? user?.defaultCompanyId) as string | undefined;
    const patternType = (body.pattern_type ?? '').toString().trim();
    const outcomeRaw = (body.outcome ?? '').toString().trim().toLowerCase();
    const outcome = outcomeRaw === 'accepted' || outcomeRaw === 'rejected' ? outcomeRaw : null;

    if (!organizationId) return res.status(400).json({ error: 'organization_id required' });
    if (!patternType)    return res.status(400).json({ error: 'pattern_type required' });
    if (!outcome)        return res.status(400).json({ error: "outcome must be 'accepted' or 'rejected'" });

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const result = await recordRecommendationOutcome({
      organization_id: organizationId,
      pattern_type: patternType,
      target_id: body.target_id ?? null,
      outcome,
      execution_correlation_id: body.execution_correlation_id ?? null,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('[intelligence/recommendation-feedback]', err);
    return res.status(500).json({ error: (err as Error)?.message || 'Failed to record outcome' });
  }
}
