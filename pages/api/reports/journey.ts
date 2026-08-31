import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/reports/journey  (BETA-EVIDENCE-EXEC-003)
 *
 * The single canonical "where am I in the scan → evidence → report journey, and what do I do next?" surface.
 * Read-only. Composes existing signals via getReportJourney; NEVER triggers a scan or a report build.
 *
 * Every dashboard / company / website / report entry point can call this same endpoint, so guidance is
 * consistent by construction across the product.
 *
 * Auth: Supabase access token (mirrors /api/reports/readiness).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getReportJourney } from '../../../backend/services/canonicalReport/reportJourneyOrchestrator';
import { resolveCompanyId } from '../../../backend/services/reportsCompanyAccessService';


async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  try {
    const companyId = await resolveCompanyId(user.id, req.query.companyId as string | undefined);
    if (!companyId) {
      return res.status(403).json({ error: 'Access denied', code: 'ACCESS_DENIED' });
    }

    const journey = await getReportJourney({ companyId });
    return res.status(200).json(journey);
  } catch (error) {
    console.error('[reports/journey] error:', error);
    return res.status(500).json({ error: 'Failed to load report journey', code: 'SERVER_ERROR' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/reports/journey' });
