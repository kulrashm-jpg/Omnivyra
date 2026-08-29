import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getLatestApprovedCampaignVersion } from '../../../backend/db/campaignApprovedVersionStore';
import { supabase } from '../../../backend/db/supabaseClient';
import { computeAnalytics } from '../../../backend/services/analyticsService';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { requireCompanyAccess } from '../../../backend/middleware/authMiddleware';
import { requireCampaignTenantAccess } from '../../../backend/security/TenantGuard';

const resolvePlaybookReferenceId = (snapshot: any): string | null =>
  snapshot?.virality_playbook_id ?? snapshot?.campaign?.virality_playbook_id ?? null;

const fetchPlaybookContext = async (companyId: string, playbookId: string | null) => {
  if (!playbookId) return null;
  const { data, error } = await supabase
    .from('virality_playbooks')
    .select('id, name, objective, company_id')
    .eq('id', playbookId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error || !data) return null;
  return { id: data.id, name: data.name, objective: data.objective };
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    /*
     * ANALYTICS-SEC-001 — this route had NO authentication at all.
     *
     * An anonymous POST supplying any companyId reached computeAnalytics and
     * returned that tenant's analytics; confirmed live against production
     * before this fix (200, not 401). Worse, computeAnalytics ends in
     * saveAnalyticsReport, which INSERTS an analytics_reports row keyed on the
     * caller-supplied company_id and campaign_id — so an unauthenticated
     * caller could also write rows into another tenant's analytics.
     *
     * Three separate boundaries were missing, and all three are restored here
     * using primitives already in the codebase:
     */

    // 1. Prove WHO the caller is. AUTH-CTX-001 semantics: a failed
    //    authentication is a 401, never a tenancy answer.
    const { user, error: authError } = await getSupabaseUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { companyId, campaignId, timeframe } = req.body || {};
    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    // 2. Prove the caller may act for THIS company. Same guard the sibling
    //    force-sync route uses; it answers 400/404/403 itself.
    if (!(await requireCompanyAccess(user.id, companyId, res))) return;

    /*
     * 3. Prove the CAMPAIGN belongs to that company.
     *
     * Authorizing companyId alone is not enough. listPerformanceMetrics
     * selects content_performance_metrics by campaign_id ALONE — no tenant
     * predicate — so a caller could pair their OWN company (which passes step
     * 2) with ANOTHER tenant's campaignId and read that campaign's metrics,
     * then have them written into an analytics_reports row under their own
     * company. That is the "nested resource selected by ID alone" pattern this
     * programme keeps finding.
     *
     * requireCampaignTenantAccess resolves the campaign's server-owned
     * company_id and asserts tenant access against it — a caller-supplied
     * campaign id is an identifier to authorize, never proof of authority. The
     * equality check then rejects the mismatched pairing: the campaign must
     * belong to the very company being reported on.
     */
    let authorizedCampaignId: string | undefined;
    if (campaignId) {
      const campaignAccess = await requireCampaignTenantAccess(req, res, campaignId);
      if (!campaignAccess) return;
      if (campaignAccess.organizationId !== companyId) {
        console.warn('ANALYTICS_CAMPAIGN_COMPANY_MISMATCH', {
          path: req.url,
          userId: user.id,
          requestedCompanyId: companyId,
        });
        return res.status(404).json({ error: 'Campaign not found' });
      }
      authorizedCampaignId = campaignId;
    }

    const report = await computeAnalytics({ companyId, campaignId: authorizedCampaignId, timeframe });
    const campaignVersion = authorizedCampaignId
      ? await getLatestApprovedCampaignVersion(companyId, authorizedCampaignId)
      : null;
    if (authorizedCampaignId) {
      console.debug('Approved strategy used for analytics', {
        campaignId: authorizedCampaignId,
        companyId,
        versionId: campaignVersion?.id,
        status: campaignVersion?.status,
      });
    }
    const playbookReferenceId = resolvePlaybookReferenceId(campaignVersion?.campaign_snapshot);
    const playbookContext = await fetchPlaybookContext(companyId, playbookReferenceId);
    return res.status(200).json({
      ...report,
      // Playbook fields are for interpretation/reporting only.
      // Campaign KPIs are evaluated independently.
      // No downstream system should infer execution behavior from playbook data.
      playbook_id: playbookContext?.id ?? playbookReferenceId ?? null,
      playbook_name: playbookContext?.name ?? null,
      playbook_objective: playbookContext?.objective ?? null,
    });
  } catch (error: any) {
    // Do not surface the internal message — it has carried Postgres/PostgREST
    // detail (table and column names) straight to the caller.
    console.error('[analytics/report] compute failed:', error?.message);
    return res.status(500).json({ error: 'Failed to compute analytics' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/analytics/report' });
