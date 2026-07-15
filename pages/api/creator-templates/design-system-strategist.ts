import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { recommendDesignSystems } from '../../../backend/services/creator/designSystemStrategistService';
import { familyForCreatorType } from '../../../lib/creator-templates';

/**
 * POST /api/creator-templates/design-system-strategist
 *   { company_id, objective?, campaign_type?, audience?, platform_mix?, industry?,
 *     visual_style?, required_families?, limit? }
 *   → { recommendations: [{ collection, score, reasons, matchedFamilies }] }
 *
 * Deterministic Collection recommendations for a campaign. Reasons come from the
 * scoring rules — never an LLM.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });

  const body = (req.body || {}) as Record<string, unknown>;
  const companyId = String((body.company_id ?? user.defaultCompanyId) || '').trim();
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const requiredFamilies = Array.isArray(body.required_families)
    ? body.required_families.map((f) => (typeof f === 'string' ? familyForCreatorType(f) : null)).filter((f): f is NonNullable<typeof f> => !!f)
    : undefined;

  const recommendations = await recommendDesignSystems({
    companyId,
    limit: typeof body.limit === 'number' ? body.limit : 0,
    strategy: {
      objective: typeof body.objective === 'string' ? body.objective : undefined,
      campaignType: typeof body.campaign_type === 'string' ? body.campaign_type : undefined,
      audience: typeof body.audience === 'string' ? body.audience : undefined,
      platformMix: Array.isArray(body.platform_mix) ? body.platform_mix.filter((x): x is string => typeof x === 'string') : undefined,
      industry: typeof body.industry === 'string' ? body.industry : undefined,
      visualStyle: typeof body.visual_style === 'string' ? body.visual_style : undefined,
      requiredFamilies,
    },
  });

  return res.status(200).json({ recommendations });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/creator-templates/design-system-strategist' });
