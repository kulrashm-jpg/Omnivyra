
/**
 * POST /api/engagement/opportunity/resolve
 * Manually mark an engagement opportunity as resolved.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { enforceRole } from '../../../../backend/services/rbacService';
import { COMMUNITY_AI_CAPABILITIES } from '../../../../backend/services/rbac/communityAiCapabilities';
import { supabase } from '../../../../backend/db/supabaseClient';
import { resolveOpportunityManually } from '../../../../backend/services/engagementOpportunityResolutionService';

type ResolveBody = {
  opportunity_id?: string;
  organization_id?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as ResolveBody;
    const opportunityId = body.opportunity_id?.trim();
    const organizationId = (body.organization_id ?? user?.defaultCompanyId) as string | undefined;

    if (!opportunityId) {
      return res.status(400).json({ error: 'opportunity_id required' });
    }
    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const roleGate = await enforceRole({
      req,
      res,
      companyId: organizationId,
      allowedRoles: [...COMMUNITY_AI_CAPABILITIES.EXECUTE_ACTIONS],
    });
    if (!roleGate) return;

    const { data: opp, error: oppError } = await supabase
      .from('engagement_opportunities')
      .select('id, organization_id')
      .eq('id', opportunityId)
      .maybeSingle();

    if (oppError || !opp) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    if ((opp as { organization_id: string }).organization_id !== organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const ok = await resolveOpportunityManually(opportunityId, roleGate.userId);

    if (!ok) {
      return res.status(500).json({ error: 'Failed to resolve opportunity' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed to resolve opportunity';
    console.error('[engagement/opportunity/resolve]', msg);
    return res.status(500).json({ error: msg });
  }
}
