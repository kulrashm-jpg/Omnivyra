import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * Performance Insights API
 * GET /api/campaigns/performance-insights?campaignId=...
 *
 * Fetches daily_content_plans slots for a campaign, derives performance
 * signals from actual_metrics + status, and returns PerformanceInsight.
 *
 * Also persists the computed insight to campaign_context.performance_insights
 * so it can be injected into the next campaign's planning prompt.
 *
 * No external APIs. No real-time tracking. Deterministic rule engine.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import {
  analyzeCampaignPerformance,
  type SlotMetrics,
  type PerformanceExpectation,
  type PlatformBaseline,
} from '../../../lib/performance/performanceAnalyzer';
import {
  getCampaignContext,
  updateCampaignMemory,
} from '../../../backend/services/campaignContextService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user, error: authError } = await getSupabaseUserFromRequest(req);
    if (authError || !user) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }

    const { campaignId } = req.query;
    if (!campaignId || typeof campaignId !== 'string') {
      return res.status(400).json({ error: 'campaignId is required' });
    }

    /*
     * CAMPAIGN-RESOURCE-AUTHZ-SEC-001 — authorization, before the first read.
     *
     * The check above proves *a* user is signed in. It never proved this user
     * may see THIS campaign, and `campaignId` is caller-supplied, so without
     * this gate any authenticated account could read another company's content
     * calendar and overwrite its planner memory by naming their campaign id.
     *
     * This must stay ahead of the `daily_content_plans` read below: that query
     * is keyed on campaign_id alone, against the service-role client, so it has
     * no tenant predicate of its own to fall back on.
     */
    const access = await requireCampaignAccess(req, res, campaignId);
    if (!access) return;

    // ── Fetch slots ──────────────────────────────────────────────────────────
    const { data: slots, error: slotsError } = await supabase
      .from('daily_content_plans')
      .select('platform, status, week_number, content_type, actual_metrics')
      .eq('campaign_id', campaignId)
      .order('week_number', { ascending: true });

    if (slotsError) {
      console.error('[PLANNER][PERFORMANCE][ERROR] Slots fetch failed:', slotsError.message);
      return res.status(500).json({ error: 'Failed to fetch campaign slots' });
    }

    // ── Pull platform baselines + validation expectations from campaign_context ─
    let platformBaselines: PlatformBaseline[] = [];
    let expectation: PerformanceExpectation = { platformBaselines };

    const campaignCtx = await getCampaignContext(campaignId);
    if (campaignCtx) {
      // Platform baselines from stored account_context
      if (campaignCtx.account_context?.platforms) {
        platformBaselines = campaignCtx.account_context.platforms
          .filter((p) => p?.platform)
          .map((p) => ({
            platform: p.platform.toLowerCase(),
            avgReach: p.avgReach ?? 0,
            engagementRate: p.engagementRate ?? 0,
          }));
      }

      // Qualitative expectations from stored validation
      const outcome = campaignCtx.validation?.expectedOutcome;
      if (outcome) {
        expectation = {
          platformBaselines,
          reachEstimate: outcome.reachEstimate ?? null,
          engagementEstimate: outcome.engagementEstimate ?? null,
          leadsEstimate: outcome.leadsEstimate ?? null,
        };
      } else {
        expectation = { platformBaselines };
      }
    } else {
      console.warn('[PLANNER][PERFORMANCE][WARN] Campaign context missing; using absolute thresholds');
    }

    // ── Normalize slot data ──────────────────────────────────────────────────
    const normalizedSlots: SlotMetrics[] = (slots ?? []).map((row) => ({
      platform: String(row?.platform ?? 'unknown').toLowerCase(),
      status: String(row?.status ?? 'planned'),
      week_number: Number(row?.week_number) || 1,
      content_type: typeof row?.content_type === 'string' ? row.content_type : null,
      actual_metrics: row?.actual_metrics && typeof row.actual_metrics === 'object'
        ? row.actual_metrics as SlotMetrics['actual_metrics']
        : null,
    }));

    // ── Run analysis ─────────────────────────────────────────────────────────
    const insight = analyzeCampaignPerformance({
      campaignId,
      slots: normalizedSlots,
      expectation,
    });

    // ── Persist to campaign memory (non-fatal) ────────────────────────────────
    /*
     * The write is stamped with the company the caller was AUTHORIZED for, not
     * one re-derived from the campaign row. Deriving it again would reintroduce
     * the defect: the previous `campaignCtx?.company_id ?? resolveCompanyId()`
     * read the target campaign's owning company and wrote under it, so a member
     * of company A upserted into company B's campaign_context — a row keyed
     * `onConflict: 'campaign_id'`, so B's stored planner memory was overwritten.
     */
    const companyIdForMemory = access.companyId;
    if (companyIdForMemory) {
      void updateCampaignMemory(campaignId, companyIdForMemory, insight).catch((err) => {
        console.warn('[PLANNER][PERFORMANCE][WARN] Memory persist failed (non-fatal):', err?.message ?? err);
      });
    }

    return res.status(200).json({
      campaignId,
      insight,
      meta: {
        totalSlots: normalizedSlots.length,
        publishedSlots: normalizedSlots.filter((s) => s.status === 'published').length,
        analysedAt: new Date().toISOString(),
        memoryPersisted: Boolean(companyIdForMemory),
      },
    });
  } catch (err) {
    console.error('[PLANNER][PERFORMANCE][ERROR] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/*
 * The bespoke `resolveCompanyId` helper that stood here is deliberately gone.
 * It resolved campaign_versions.company_id for a caller-supplied campaignId and
 * that value was used as the tenant for a write — a resource's company_id
 * treated as an authorization oracle. requireCampaignAccess performs the same
 * resolution AND proves the caller may act on it, so a second unguarded
 * resolver is exactly the thing this fix removes.
 */

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/performance-insights' });
