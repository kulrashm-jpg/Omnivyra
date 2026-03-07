/**
 * Company Intelligence Regions API
 * Phase-3: Company Intelligence Configuration
 * GET, POST, PUT, PATCH for company_intelligence_regions
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../../backend/middleware/withRBAC';
import { Role } from '../../../../backend/services/rbacService';
import {
  getCompanyRegions,
  createRegion,
  updateRegion,
  setRegionEnabled,
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
    switch (req.method) {
      case 'GET': {
        const regions = await getCompanyRegions(companyId);
        return res.status(200).json({ regions });
      }
      case 'POST': {
        const body = req.body as { region: string };
        if (!body?.region?.trim()) {
          return res.status(400).json({ error: 'region is required' });
        }
        const region = await createRegion(companyId, body.region);
        return res.status(201).json({ region });
      }
      case 'PUT': {
        const { id, region } = req.body as { id: string; region: string };
        if (!id || !region?.trim()) {
          return res.status(400).json({ error: 'id and region are required' });
        }
        const updated = await updateRegion(id, region);
        return res.status(200).json({ region: updated });
      }
      case 'PATCH': {
        const { id, enabled } = req.body as { id: string; enabled: boolean };
        if (!id || typeof enabled !== 'boolean') {
          return res.status(400).json({ error: 'id and enabled (boolean) are required' });
        }
        const updated = await setRegionEnabled(id, enabled);
        return res.status(200).json({ region: updated });
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
