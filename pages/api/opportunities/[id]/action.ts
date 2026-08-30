import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { withRBAC } from '../../../../backend/middleware/withRBAC';
import { Role } from '../../../../backend/services/rbacService';
import { supabase } from '../../../../backend/db/supabaseClient';
import {
  takeAction,
  setOpportunityReviewed,
  promoteToCampaign,
  fillOpportunitySlots,
  type TakeActionType,
} from '../../../../backend/services/opportunityService';

const CLOSING_ACTIONS: TakeActionType[] = ['SCHEDULED', 'ARCHIVED', 'DISMISSED'];

type OpportunityRow = {
  id: string;
  company_id: string;
  type: string;
  title: string;
  summary: string | null;
  problem_domain: string | null;
  region_tags: string[] | null;
  source_refs: unknown;
  conversion_score: number | null;
  status: string;
  slot_state: string;
  action_taken: string | null;
  scheduled_for: string | null;
  first_seen_at: string;
  last_seen_at: string;
  payload: unknown;
  created_at: string;
  updated_at: string;
};

async function getOpportunity(id: string): Promise<OpportunityRow | null> {
  const { data, error } = await supabase
    .from('opportunity_items')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !data) return null;
  return data as OpportunityRow;
}

/**
 * POST /api/opportunities/[id]/action
 * Body: { action: 'PROMOTED' | 'SCHEDULED' | 'ARCHIVED' | 'DISMISSED' | 'REVIEWED', scheduled_for?, companyId }
 * Returns updated opportunity state (or { campaignId } for PROMOTED).
 */
async function actionHandler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id) {
    return res.status(400).json({ error: 'Opportunity id is required' });
  }

  const body = req.body || {};
  const action = typeof body.action === 'string' ? body.action : '';
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  const scheduled_for = typeof body.scheduled_for === 'string' ? body.scheduled_for : undefined;

  if (!action) {
    return res.status(400).json({ error: 'action is required' });
  }

  const opportunity = await getOpportunity(id);
  if (!opportunity) {
    return res.status(404).json({ error: 'Opportunity not found' });
  }

  const rowCompanyId = String(opportunity.company_id);

  /*
   * OPPORTUNITIES-SEC-001 — compare the opportunity's owner against the company
   * withRBAC ACTUALLY authorized, and do it unconditionally.
   *
   * withRBAC resolves its company from `req.query.companyId || req.body.companyId`
   * — QUERY FIRST. This handler read `body.companyId` alone, and the ownership
   * comparison was guarded by that value's truthiness. So a request carrying
   * companyId ONLY in the query string satisfied the wrapper while leaving the
   * handler's `companyId` empty — and an empty value skipped the comparison
   * entirely.
   *
   * A COMPANY_ADMIN of any company could therefore
   * `POST /api/opportunities/<victim opportunity id>/action?companyId=<their own
   * company>` with no companyId in the body: the wrapper authorized their own
   * company, the ownership check was skipped, and `resolvedCompanyId` fell back
   * to the VICTIM's company id — which was then handed to the sinks. Every
   * action is a write: takeAction and setOpportunityReviewed UPDATE
   * opportunity_items by id with no tenant predicate, promoteToCampaign INSERTs
   * a campaign into the victim's company, and fillOpportunitySlots generates and
   * upserts opportunities there.
   *
   * The fix resolves the authorized company exactly as the wrapper does, then
   * requires it to equal the opportunity's server-owned company_id. No truthiness
   * guard, so an absent identifier is a denial rather than a bypass. The sinks
   * now receive rowCompanyId — server-owned data — never a caller-supplied value.
   *
   * The 403 and its message are unchanged; legitimate callers send companyId in
   * the body (hooks/useRecommendationsState) and are unaffected. Platform
   * super-admins keep their bypass through withRBAC and still act on any tenant
   * by naming that tenant's id, which is the path they already used.
   */
  const authorizedCompanyId =
    (typeof req.query.companyId === 'string' ? req.query.companyId : '') || companyId;
  if (!authorizedCompanyId || authorizedCompanyId !== rowCompanyId) {
    return res.status(403).json({ error: 'Company does not match opportunity' });
  }
  const resolvedCompanyId = rowCompanyId;

  const userId = (req as any)?.rbac?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'User not identified' });
  }

  try {
    if (action === 'PROMOTED') {
      const campaignId = await promoteToCampaign(id, resolvedCompanyId, userId);
      return res.status(200).json({ campaignId });
    }

    if (action === 'REVIEWED') {
      await setOpportunityReviewed(id);
      const updated = await getOpportunity(id);
      return res.status(200).json({ opportunity: updated ?? opportunity });
    }

    if (!CLOSING_ACTIONS.includes(action as TakeActionType)) {
      return res.status(400).json({
        error: `action must be one of: PROMOTED, REVIEWED, ${CLOSING_ACTIONS.join(', ')}`,
      });
    }

    await takeAction(id, action as TakeActionType, { scheduled_for });
    await fillOpportunitySlots(resolvedCompanyId, opportunity.type);
    const updated = await getOpportunity(id);
    return res.status(200).json({ opportunity: updated ?? opportunity });
  } catch (e) {
    console.error('Opportunity action', e);
    return res.status(500).json({ error: (e as Error).message });
  }
}

export default __createApiRoute(withRBAC(actionHandler, [Role.COMPANY_ADMIN]), { route: '/api/opportunities/:id/action' });
