import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireCampaignAccess } from '../../../backend/services/campaignAccessService';
import { computeDistributionStability } from '../../../lib/intelligence/distributionStability';
import type { DistributionStabilityResult } from '../../../lib/intelligence/distributionStability';

export interface DistributionDecisionTimelineItem {
  week_number: number;
  resolved_strategy: 'STAGGERED' | 'ALL_AT_ONCE';
  auto_detected: boolean;
  quality_override: boolean;
  slot_optimization_applied: boolean;
  created_at: string;
}

export interface DecisionTimelineResponse {
  campaign_id: string;
  total_weeks_logged: number;
  decisions: DistributionDecisionTimelineItem[];
  stability: DistributionStabilityResult;
}

const TABLE = 'campaign_distribution_decisions';

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

    let decisions: DistributionDecisionTimelineItem[] = [];
    try {
      const { data: rows, error } = await supabase
        .from(TABLE)
        .select('week_number, resolved_strategy, auto_detected, quality_override, slot_optimization_applied, created_at')
        .eq('campaign_id', access.campaignId)
        .order('week_number', { ascending: true });

      if (!error && Array.isArray(rows)) {
        decisions = rows.map((r: any) => ({
          week_number: Number(r?.week_number) ?? 0,
          resolved_strategy: String(r?.resolved_strategy ?? 'STAGGERED').trim().toUpperCase() === 'ALL_AT_ONCE' ? 'ALL_AT_ONCE' : 'STAGGERED',
          auto_detected: Boolean(r?.auto_detected),
          quality_override: Boolean(r?.quality_override),
          slot_optimization_applied: Boolean(r?.slot_optimization_applied),
          created_at: r?.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
        }));
      }
    } catch (_) {
      // table missing or query failed: keep empty
    }

    let stability: DistributionStabilityResult;
    try {
      stability = computeDistributionStability(decisions);
    } catch (_) {
      stability = { total_weeks: 0, strategy_switches: 0, volatility_score: 0, stability_level: 'STABLE' };
    }

    const response: DecisionTimelineResponse = {
      campaign_id: access.campaignId,
      total_weeks_logged: decisions.length,
      decisions,
      stability,
    };

    if (process.env.NODE_ENV === 'development') {
      console.log('[DecisionTimeline]', { campaignId: access.campaignId, count: decisions.length });
      console.log('[DistributionStability]', stability);
    }

    return res.status(200).json(response);
  } catch (err) {
    console.error('[DecisionTimeline]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
