import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
import {
  getResolvedCampaignPlanContext,
  PrePlanningRequiredError,
} from '../../../backend/services/campaignBlueprintService';
import { getTrendSnapshots, syncCampaignVersionStage } from '../../../backend/db/campaignVersionStore';
import {
  buildPlatformExecutionPlan,
} from '../../../backend/services/platformIntelligenceService';
import {
  getLatestPlatformExecutionPlan,
  savePlatformExecutionPlan,
} from '../../../backend/db/platformExecutionStore';
import { validateCampaignHealth } from '../../../backend/services/campaignHealthService';
import { listAssetsWithLatestContent } from '../../../backend/db/contentAssetStore';
import { ALL_ROLES } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { requireCampaignTenantAccess } from '../../../backend/security/TenantGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, campaignId, weekNumber, force } = req.body || {};
    if (!companyId || !weekNumber) {
      return res.status(400).json({ error: 'companyId and weekNumber are required' });
    }

    /*
     * PLATFORM-PLAN-SEC-001 — this route had NO authorization at all.
     *
     * Its only wrapper was createApiRoute, which is pass-through observability,
     * not authentication. `companyId` and `campaignId` came straight from the
     * request body and flowed, unchecked, into the service-role client: the
     * company profile read, the cached-plan read, the resolved plan context,
     * the trend snapshots, the platform_execution_plans INSERT, the `campaigns`
     * stage UPDATE keyed on the caller's id alone, and syncCampaignVersionStage.
     * So an unauthenticated POST could write a plan into any tenant and advance
     * any tenant's campaign to the schedule stage.
     *
     * The fix is the repo's existing two-part pattern, both halves required:
     *
     *  1. withRBAC (below the handler) authenticates the caller and authorizes
     *     `query.companyId || body.companyId` — QUERY FIRST. Because the wrapper
     *     prefers the query, a handler that reads the body only can be split:
     *     `?companyId=<own>` authorizes one company while `{companyId:<victim>}`
     *     operates on another (OPPORTUNITIES-SEC-002). `req.rbac.companyId` is
     *     the company the wrapper ACTUALLY authorized (WITHRBAC-STRUCT-001), so
     *     the body identifier must AGREE with it rather than override it. The
     *     body value is kept, not removed: the only caller
     *     (components/campaign-ai/useCampaignAiOps) already sends the company it
     *     is authorized for and sends no query parameter.
     *
     *  2. requireCampaignTenantAccess resolves the campaign's SERVER-OWNED
     *     company_id from the `campaigns` row and asserts tenant access against
     *     it (WITHRBAC-SEC-001). Without this, a caller authorized for their own
     *     company could still pass another tenant's campaignId — a guessable
     *     UUID — and drive the stage UPDATE and the plan INSERT against it.
     *
     * Every downstream read and write below now takes `operativeCompanyId`,
     * which is derived from the campaign row and cross-checked against the
     * authorized company; the caller-supplied value is never trusted as a
     * selector. Both checks run BEFORE any tenant read or write.
     *
     * Super-admin semantics are preserved: enforceRole grants SUPER_ADMIN for
     * any company, and requireCampaignTenantAccess honours the platform bypass,
     * so a super admin operating on a company and that company's own campaign
     * passes all three comparisons.
     */
    const authorizedCompanyId = (req as any)?.rbac?.companyId as string | undefined;
    if (!authorizedCompanyId) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' });
    }
    if (String(companyId) !== authorizedCompanyId) {
      return res.status(403).json({
        error: 'COMPANY_SCOPE_VIOLATION',
        code: 'COMPANY_SCOPE_VIOLATION',
      });
    }

    const campaignAccess = await requireCampaignTenantAccess(
      req,
      res,
      campaignId ? String(campaignId) : null
    );
    if (!campaignAccess) return;
    /*
     * The campaign's OWN company must be the company the caller was authorized
     * for. requireCampaignTenantAccess only proves the caller may reach the
     * campaign's tenant AT ALL -- for a principal with standing in two tenants
     * (a dual member, or a super admin, who passes it for either) that is not
     * enough: they could pair company A in the body with company B's campaign
     * and drive B's plan write and stage UPDATE while the request claimed A.
     * Requiring the pair to be coherent is what closes that.
     */
    if (campaignAccess.organizationId !== authorizedCompanyId) {
      return res.status(403).json({
        error: 'Campaign does not belong to the authorized company',
        code: 'CAMPAIGN_NOT_IN_COMPANY',
      });
    }
    // The SERVER-OWNED company, read off the campaign row by the guard above --
    // never the caller's value, so the sinks stay correct even if the checks
    // above are ever reordered.
    const operativeCompanyId = campaignAccess.organizationId;

    const profile = await getProfile(operativeCompanyId, { autoRefine: false, languageRefine: true });
    if (!profile) {
      return res.status(404).json({ error: 'Company profile not found' });
    }

    if (!force) {
      const cached = await getLatestPlatformExecutionPlan({
        companyId: operativeCompanyId,
        campaignId,
        weekNumber: Number(weekNumber),
      });
      if (cached?.plan_json) {
        return res.status(200).json({ plan: cached.plan_json });
      }
    }

    const resolved = await getResolvedCampaignPlanContext(operativeCompanyId, campaignId, true);
    if (!resolved) {
      return res.status(404).json({ error: 'Campaign plan not found' });
    }
    const weeklyPlan = resolved.weekly_plan.find(
      (week: any) => week.week_number === Number(weekNumber)
    );
    if (!weeklyPlan) {
      return res.status(404).json({ error: 'Week plan not found' });
    }
    const trendSnapshots = await getTrendSnapshots(operativeCompanyId, campaignId);
    const trends = trendSnapshots
      .flatMap((snap) => snap.snapshot?.emerging_trends ?? [])
      .map((trend: any) => trend?.topic)
      .filter(Boolean);
    const plan = buildPlatformExecutionPlan({
      companyProfile: profile,
      campaign: resolved.campaign,
      weekPlan: weeklyPlan,
      trends,
    });

    console.log('PLATFORM EXECUTION PLAN BUILT', {
      companyId: operativeCompanyId,
      campaignId,
      weekNumber,
    });

    await savePlatformExecutionPlan({
      companyId: operativeCompanyId,
      campaignId,
      weekNumber: Number(weekNumber),
      planJson: plan,
    });

    /*
     * PLATFORM-PLAN-SEC-001 — the stage UPDATE was keyed on the caller-supplied
     * campaign id ALONE, so any id advanced any tenant's campaign to 'schedule'.
     * requireCampaignTenantAccess above already proved this campaign belongs to
     * the authorized company; the `company_id` predicate here is defence in
     * depth so the write cannot address a foreign row even if that check were
     * ever bypassed or reordered.
     */
    if (campaignId) {
      const { data: camp } = await supabase
        .from('campaigns')
        .select('current_stage')
        .eq('id', campaignId)
        .eq('company_id', operativeCompanyId)
        .single();
      const stage = (camp as { current_stage?: string })?.current_stage;
      if (stage && stage !== 'schedule') {
        await supabase
          .from('campaigns')
          .update({ current_stage: 'schedule', updated_at: new Date().toISOString() })
          .eq('id', campaignId)
          .eq('company_id', operativeCompanyId);
        void syncCampaignVersionStage(campaignId, 'schedule', operativeCompanyId).catch(() => {});
      }
    }

    const healthReport = validateCampaignHealth({
      companyProfile: profile,
      trends,
      campaign: resolved.campaign,
      weeklyPlans: resolved.weekly_plan,
      dailyPlans: resolved.daily_plan,
      expectedDurationWeeks: resolved.duration_weeks,
      platformExecutionPlan: plan,
      contentAssets: await listAssetsWithLatestContent({ campaignId }),
    });

    return res.status(200).json({ plan, healthReport });
  } catch (error: any) {
    if (error instanceof PrePlanningRequiredError || error?.code === 'PRE_PLANNING_REQUIRED') {
      return res.status(412).json({ code: 'PRE_PLANNING_REQUIRED', message: error?.message });
    }
    return res.status(500).json({ error: error?.message || 'Failed to build platform plan' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
//
// PLATFORM-PLAN-SEC-001 — createApiRoute is observability ONLY; it authenticates
// nothing. withRBAC is the authentication/authorization wrapper. ALL_ROLES matches
// the closest sibling, campaigns/health-report: building or reading a week's
// platform plan is available to every role the UI exposes it to, so a narrower set
// would deny legitimate members. Tenant binding — not the role list — is what
// closes the cross-tenant hole, and it is enforced inside the handler.
export default __createApiRoute(withRBAC(handler, ALL_ROLES), {
  route: '/api/campaigns/platform-plan',
});
