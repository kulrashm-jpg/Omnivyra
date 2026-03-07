import { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../backend/services/userContextService';
import {
  resolveOrganizationPlanLimits,
  ABSOLUTE_MAX_DURATION_WEEKS,
} from '../../backend/services/planResolutionService';

/**
 * GET /api/company-plan-duration-limit?companyId=...
 * Returns plan_key and max_campaign_duration_weeks for the company (companyId used as organization_id).
 * Used by AI chat to show plan-appropriate duration options and validate user input.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = (req.query.companyId ?? req.query.company_id) as string | undefined;
  const access = await enforceCompanyAccess({ req, res, companyId: companyId ?? null });
  if (!access) return;

  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  try {
    const resolved = await resolveOrganizationPlanLimits(companyId);
    const max = resolved.max_campaign_duration_weeks ?? ABSOLUTE_MAX_DURATION_WEEKS;
    return res.status(200).json({
      plan_key: resolved.plan_key,
      max_campaign_duration_weeks: Math.min(max, ABSOLUTE_MAX_DURATION_WEEKS),
      absolute_max: ABSOLUTE_MAX_DURATION_WEEKS,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return res.status(500).json({ error: message });
  }
}
