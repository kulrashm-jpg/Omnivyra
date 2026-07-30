import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getCompanyInsights } from '../../../backend/services/companyIntelligenceService';
import { formatForUserOutput } from '../../../backend/utils/refineUserFacingResponse';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    // Explicit workspace param wins over the ambient default; enforceCompanyAccess
    // then denies any company the caller is not a member of (incl. the dev-shim's
    // global-latest fallback on auth error).
    const companyId = (req.query.companyId as string) || user?.defaultCompanyId;
    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }
    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;

    const windowHours = Math.min(168, Math.max(1, parseInt(String(req.query.windowHours ?? 24), 10) || 24));
    const skipCache = String(req.query.skipCache ?? '').toLowerCase() === 'true';

    const insights = await getCompanyInsights(companyId, { windowHours, skipCache });
    const refined = await formatForUserOutput({ insights });
    return res.status(200).json(refined);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch company insights';
    console.error('[company-intelligence/insights]', message);
    return res.status(500).json({ error: message });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/company-intelligence/insights' });
