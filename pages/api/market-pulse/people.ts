import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { isContentArchitectSession, resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import { listMarketPulseAssignablePeople } from '../../../backend/services/marketPulseProductionHardeningService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });
  const access = isContentArchitectSession(req)
    ? { userId: 'content_architect', role: 'CONTENT_ARCHITECT' }
    : await resolveCompanyAccess(req, res, companyId);
  if (!access) return;
  const people = await listMarketPulseAssignablePeople(
    companyId,
    typeof req.query.search === 'string' ? req.query.search : null
  );
  return res.status(200).json({ people });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/market-pulse/people' });
