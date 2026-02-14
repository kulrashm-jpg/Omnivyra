import { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { Role } from '../../../backend/services/rbacService';
import {
  listActiveOpportunities,
  countActive,
  fillOpportunitySlots,
  type OpportunityItem,
} from '../../../backend/services/opportunityService';

export type OpportunitiesListResponse = {
  opportunities: OpportunityItem[];
  activeCount: number;
};

/**
 * GET /api/opportunities?companyId=&type=
 * Query: companyId (required), type (required)
 * Returns opportunity_items where company_id = companyId, type = type, slot_state = 'ACTIVE',
 * ordered by conversion_score desc, first_seen_at desc.
 */
async function getHandler(req: NextApiRequest, res: NextApiResponse) {
  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : '';
  const type = typeof req.query.type === 'string' ? req.query.type : '';

  if (!companyId || !type) {
    return res.status(400).json({ error: 'companyId and type are required' });
  }

  try {
    const [opportunities, activeCount] = await Promise.all([
      listActiveOpportunities(companyId, type),
      countActive(companyId, type),
    ]);
    return res.status(200).json({ opportunities, activeCount } as OpportunitiesListResponse);
  } catch (e) {
    console.error('GET /api/opportunities', e);
    return res.status(500).json({ error: (e as Error).message });
  }
}

/**
 * POST /api/opportunities
 * Body: { companyId, type, strategicPayload? }
 * Calls fillOpportunitySlots(companyId, type, strategicPayload), then returns updated ACTIVE list.
 */
async function postHandler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { companyId, type, strategicPayload } = req.body || {};
  if (!companyId || !type) {
    return res.status(400).json({ error: 'companyId and type are required' });
  }

  try {
    await fillOpportunitySlots(companyId, type, strategicPayload);
    const [opportunities, activeCount] = await Promise.all([
      listActiveOpportunities(companyId, type),
      countActive(companyId, type),
    ]);
    return res.status(200).json({ opportunities, activeCount } as OpportunitiesListResponse);
  } catch (e) {
    console.error('POST /api/opportunities', e);
    return res.status(500).json({ error: (e as Error).message });
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return getHandler(req, res);
  if (req.method === 'POST') return postHandler(req, res);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

export default withRBAC(handler, [Role.COMPANY_ADMIN]);
