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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
      // Fallback: try account_contexts table for platform baselines
      try {
        const { data: acData } = await supabase
          .from('account_contexts')
          .select('platforms')
          .eq('user_id', user.id)
          .order('last_updated', { ascending: false })
          .limit(1)
          .single();

        if (acData?.platforms && Array.isArray(acData.platforms)) {
          platformBaselines = (acData.platforms as Array<Record<string, unknown>>)
            .filter((p) => p?.platform && typeof p.platform === 'string')
            .map((p) => ({
              platform: String(p.platform).toLowerCase(),
              avgReach: Number(p.avgReach) || 0,
              engagementRate: Number(p.engagementRate) || 0,
            }));
          expectation = { platformBaselines };
        }
      } catch {
        console.warn('[PLANNER][PERFORMANCE][WARN] Could not load account baselines — using absolute thresholds');
      }
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
    // Resolve companyId: use stored context if available, else look up from campaigns table
    const companyIdForMemory = campaignCtx?.company_id ?? await resolveCompanyId(campaignId);
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

// ---------------------------------------------------------------------------
// Helper: resolve companyId for a campaignId (for memory upsert)
// ---------------------------------------------------------------------------

async function resolveCompanyId(campaignId: string): Promise<string | null> {
  try {
    // campaign_versions stores company_id alongside campaign_id
    const { data } = await supabase
      .from('campaign_versions')
      .select('company_id')
      .eq('campaign_id', campaignId)
      .limit(1)
      .single();
    return typeof data?.company_id === 'string' ? data.company_id : null;
  } catch {
    return null;
  }
}
