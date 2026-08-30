import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
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

  /*
   * OPPORTUNITIES-SEC-002 — operate on the company withRBAC AUTHORIZED.
   *
   * withRBAC resolves `req.query.companyId || req.body.companyId` — QUERY
   * FIRST. This handler read `req.body.companyId` only, so
   * `?companyId=<a company the caller legitimately admins>` with
   * `{ companyId: <victim> }` in the body authorized one company and operated
   * on another. Every sink below took the body value: fillOpportunitySlots
   * passes it to countActive, to the trend generator, and to
   * upsertOpportunities (a WRITE), and the response then returns the victim's
   * opportunity list and count to the caller.
   *
   * The body identifier is kept — the only caller sends it and no query param
   * (components/recommendations/tabs/useOpportunities), so for real traffic it
   * already equals the authorized company. But it must AGREE with that company
   * rather than override it, and the sinks now receive the authorized value.
   *
   * req.rbac.companyId is the company the wrapper actually authorized
   * (WITHRBAC-STRUCT-001). Checked before any read, generator run or upsert.
   *
   * GET is unchanged and needs no binding: it reads `req.query.companyId`,
   * which is the wrapper's own first precedence, so the two cannot diverge.
   */
  const authorizedCompanyId = (req as any)?.rbac?.companyId as string | undefined;
  if (!authorizedCompanyId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (String(companyId) !== authorizedCompanyId) {
    console.warn('OPPORTUNITIES_COMPANY_MISMATCH', {
      path: req.url,
      userId: (req as any)?.rbac?.userId,
      authorizedCompanyId,
    });
    return res.status(403).json({ error: 'Company does not match the authorized company' });
  }

  try {
    await fillOpportunitySlots(authorizedCompanyId, type, strategicPayload);
    const [opportunities, activeCount] = await Promise.all([
      listActiveOpportunities(authorizedCompanyId, type),
      countActive(authorizedCompanyId, type),
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

export default __createApiRoute(withRBAC(handler, [Role.COMPANY_ADMIN]), { route: '/api/opportunities' });
