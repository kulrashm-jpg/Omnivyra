import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { refineUserFacingResponse } from '@/backend/utils/refineUserFacingResponse';
import { buildStrategicMemoryProfile } from '../../../lib/intelligence/strategicMemory';
import type { StrategistAction } from '../../../lib/intelligence/strategicMemory';
import { getActiveGenerationBiasFlags } from '../../../lib/intelligence/generationBias';

export interface CampaignIntelligenceSummary {
  campaign_id: string;
  total_feedback_events: number;
  action_acceptance_rate: Record<string, number>;
  platform_confidence_average: Record<string, number>;
  strategist_trigger_counts: { NONE: number; SUGGEST: number; AUTO_ELIGIBLE: number };
  distribution_strategy_counts: { STAGGERED: number; ALL_AT_ONCE: number };
  slot_optimization_applied_count: number;
  active_generation_bias: { cta_bias: boolean; discoverability_bias: boolean; hook_softening_bias: boolean };
}

const ALL_ACTIONS: StrategistAction[] = ['IMPROVE_CTA', 'IMPROVE_HOOK', 'ADD_DISCOVERABILITY'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const campaignId = typeof req.query.campaignId === 'string' ? req.query.campaignId.trim() : '';
    if (!campaignId) {
      return res.status(400).json({ error: 'campaignId query required' });
    }

    const access = await requireCampaignAccess(req, res, campaignId);
    if (!access) return;

    const { data: rows, error } = await supabase
      .from('campaign_strategic_memory')
      .select('action, platform, accepted, confidence_score, created_at')
      .eq('campaign_id', access.campaignId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[CampaignIntelligenceSummary] fetch error', error);
      return res.status(500).json({ error: 'Failed to fetch strategic memory' });
    }

    const events = (rows || []).map((r: any) => ({
      campaign_id: access.campaignId,
      execution_id: '',
      platform: r.platform ?? undefined,
      action: r.action as StrategistAction,
      accepted: Boolean(r.accepted),
      timestamp: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
    }));

    const confidenceHistory: Array<{ platform: string; confidence: number }> = [];
    for (const r of rows || []) {
      if (r.confidence_score != null && Number.isFinite(r.confidence_score) && r.platform) {
        confidenceHistory.push({
          platform: String(r.platform).trim().toLowerCase(),
          confidence: Math.max(0, Math.min(100, Number(r.confidence_score))),
        });
      }
    }

    const profile = buildStrategicMemoryProfile(events, confidenceHistory);
    const action_acceptance_rate: Record<string, number> = {};
    for (const a of ALL_ACTIONS) {
      action_acceptance_rate[a] = profile.action_acceptance_rate[a] ?? 0;
    }

    let distribution_strategy_counts = { STAGGERED: 0, ALL_AT_ONCE: 0 };
    let slot_optimization_applied_count = 0;
    try {
      const { data: decisionRows } = await supabase
        .from('campaign_distribution_decisions')
        .select('resolved_strategy, slot_optimization_applied')
        .eq('campaign_id', access.campaignId);
      if (Array.isArray(decisionRows)) {
        for (const row of decisionRows) {
          const s = String(row?.resolved_strategy ?? '').trim().toUpperCase();
          if (s === 'STAGGERED') distribution_strategy_counts.STAGGERED += 1;
          else if (s === 'ALL_AT_ONCE') distribution_strategy_counts.ALL_AT_ONCE += 1;
          if (row?.slot_optimization_applied === true) slot_optimization_applied_count += 1;
        }
      }
    } catch (_) {
      // table missing or query failed: keep zeros
    }

    const summary: CampaignIntelligenceSummary = {
      campaign_id: access.campaignId,
      total_feedback_events: profile.total_events,
      action_acceptance_rate,
      platform_confidence_average: profile.platform_confidence_average ?? {},
      strategist_trigger_counts: { NONE: 0, SUGGEST: 0, AUTO_ELIGIBLE: 0 },
      distribution_strategy_counts,
      slot_optimization_applied_count,
      active_generation_bias: getActiveGenerationBiasFlags(profile),
    };

    if (process.env.NODE_ENV === 'development') {
      console.log('[CampaignIntelligenceSummary]', summary);
    }

    const refinedSummary = await refineUserFacingResponse(summary);
    return res.status(200).json(refinedSummary);
  } catch (err) {
    console.error('[CampaignIntelligenceSummary]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
