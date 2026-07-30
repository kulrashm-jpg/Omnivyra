import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getRecentCompanySignals } from '../../../backend/services/companyIntelligenceService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    // Explicit workspace param wins over the ambient default (the previous
    // `default ?? query` order let the user's default company override an
    // explicitly-requested one, and served the global-latest company on auth
    // failure). enforceCompanyAccess then denies any company the caller is not a
    // member of — including the dev-shim's global-latest fallback on auth error.
    const companyId = (req.query.companyId as string) || user?.defaultCompanyId;
    if (!companyId) {
      return res.status(400).json({ error: 'companyId required' });
    }
    const access = await enforceCompanyAccess({ req, res, companyId });
    if (!access) return;

    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? 50), 10) || 50));
    const windowHours = Math.min(168, Math.max(1, parseInt(String(req.query.windowHours ?? 24), 10) || 24));

    const signals = await getRecentCompanySignals(companyId, { limit, windowHours });
    return res.status(200).json({ signals });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch company signals';
    console.error('[company-intelligence/signals]', message);
    return res.status(500).json({ error: message });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/company-intelligence/signals' });
