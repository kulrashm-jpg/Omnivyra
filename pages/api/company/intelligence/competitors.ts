/**
 * Company Intelligence Competitors API
 * Phase-3: Company Intelligence Configuration
 * GET, POST, PUT, PATCH for company_intelligence_competitors
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../../backend/middleware/withRBAC';
import { Role } from '../../../../backend/services/rbacService';
import { requireCompanyContext } from '../../../../backend/services/companyContextGuardService';
import {
  getCompanyCompetitors,
  createCompetitor,
  updateCompetitor,
  setCompetitorEnabled,
  PLAN_LIMIT_EXCEEDED,
} from '../../../../backend/services/companyIntelligenceConfigService';

const ALLOWED_ROLES = [
  Role.COMPANY_ADMIN,
  Role.ADMIN,
  Role.SUPER_ADMIN,
  Role.CONTENT_CREATOR,
  Role.CONTENT_PLANNER,
];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId = (req.query.companyId as string) || (req.body?.companyId as string);
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  try {
    const companyContext = await requireCompanyContext({ req, res, companyId: companyId.trim() });
    if (!companyContext) return;

    switch (req.method) {
      case 'GET': {
        const competitors = await getCompanyCompetitors(companyContext.companyId);
        return res.status(200).json({ competitors });
      }
      case 'POST': {
        const body = req.body as { competitor_name: string };
        if (!body?.competitor_name?.trim()) {
          return res.status(400).json({ error: 'competitor_name is required' });
        }
        const competitor = await createCompetitor(companyContext.companyId, body.competitor_name);
        return res.status(201).json({ competitor });
      }
      case 'PUT': {
        const { id, competitor_name } = req.body as { id: string; competitor_name: string };
        if (!id || !competitor_name?.trim()) {
          return res.status(400).json({ error: 'id and competitor_name are required' });
        }
        const updated = await updateCompetitor(id, competitor_name);
        return res.status(200).json({ competitor: updated });
      }
      case 'PATCH': {
        const { id, enabled } = req.body as { id: string; enabled: boolean };
        if (!id || typeof enabled !== 'boolean') {
          return res.status(400).json({ error: 'id and enabled (boolean) are required' });
        }
        const updated = await setCompetitorEnabled(id, enabled);
        return res.status(200).json({ competitor: updated });
      }
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    const message = (err as Error)?.message ?? '';
    if (message === PLAN_LIMIT_EXCEEDED) {
      return res.status(403).json({ error: PLAN_LIMIT_EXCEEDED });
    }
    return res.status(500).json({ error: message || 'Internal server error' });
  }
}

export default withRBAC(handler, ALLOWED_ROLES);
