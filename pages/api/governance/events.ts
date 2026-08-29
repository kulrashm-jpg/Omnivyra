import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * GET /api/governance/events
 * Governance Events Timeline — read-only. Stage 10 Phase 4.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { requireCompanyAccess } from '../../../backend/middleware/authMiddleware';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  /*
   * GOVERNANCE-SEC-001 — this route had NO authentication and NO authorization.
   *
   * `companyId` arrived in the query string and went straight into
   * `.eq('company_id', companyId)` on a service-role client that bypasses RLS,
   * so an ANONYMOUS caller who knew a company uuid could read that tenant's
   * governance event timeline — event types, statuses, campaign ids and the
   * raw `metadata` payload of every event. Confirmed live against production
   * (200, not 401) before this fix.
   *
   * Its RBAC'd siblings (company-drift, replay-event, simulate-policy) prove
   * the cluster's intent, but they gate on COMPANY_ADMIN. This route is read
   * by ORDINARY members on the campaign-details page, so requiring an admin
   * role would break legitimate use. Membership is the correct boundary here:
   * requireCompanyAccess delegates to TenantGuard.assertTenantAccess, so
   * soft-deleted orgs and stale memberships are rejected centrally and
   * platform super-admins keep their bypass. Nothing is queried before it
   * returns true.
   */
  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const companyId = (req.query.companyId as string)?.trim?.();
  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  if (!(await requireCompanyAccess(user.id, companyId, res))) return;

  const campaignId = (req.query.campaignId as string)?.trim?.() || undefined;
  const eventType = (req.query.eventType as string)?.trim?.() || undefined;
  const limitParam = req.query.limit;
  const limit = limitParam != null ? Math.min(Math.max(1, Number(limitParam) || 50), 200) : 50;

  try {
    let query = supabase
      .from('campaign_governance_events')
      .select('id, campaign_id, event_type, event_status, metadata, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    }
    if (eventType) {
      query = query.eq('event_type', eventType);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[governance/events]', error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Internal server error',
      });
    }

    const events = (data ?? []).map((row: any) => ({
      id: row.id,
      campaignId: row.campaign_id,
      eventType: row.event_type,
      eventStatus: row.event_status,
      metadata: (row.metadata as Record<string, any>) ?? {},
      createdAt: row.created_at,
    }));

    return res.status(200).json({ events });
  } catch (err) {
    console.error('[governance/events]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/governance/events' });
