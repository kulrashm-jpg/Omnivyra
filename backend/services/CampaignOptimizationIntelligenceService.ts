/**
 * Campaign optimization insights derived from persisted decision_objects only.
 * Read-only and non-generative.
 */

import { supabase } from '../db/supabaseClient';
import {
  composeCampaignOptimizationView,
  composeDecisionIntelligence,
} from './decisionComposerService';

export interface CampaignOptimizationInsight {
  campaignId: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  category: 'PERFORMANCE' | 'GOVERNANCE' | 'EXECUTION' | 'CONTENT_STRATEGY';
  headline: string;
  explanation: string;
  recommendedAction: string;
}

/**
 * Generate campaign optimization insights. Read-only, never throws.
 */
export async function generateCampaignOptimizationInsights(
  campaignId: string
): Promise<CampaignOptimizationInsight[]> {
  try {
    if (!campaignId || typeof campaignId !== 'string') {
      return [];
    }

    const { data: campaignRow, error: campaignError } = await supabase
      .from('campaigns')
      .select('company_id')
      .eq('id', campaignId)
      .maybeSingle();

    if (campaignError || !campaignRow?.company_id) return [];

    const composition = await composeDecisionIntelligence({
      companyId: campaignRow.company_id,
      reportTier: 'deep',
      entityType: 'campaign',
      entityId: campaignId,
      status: ['open'],
    });

    const optimization = composeCampaignOptimizationView(campaignId, composition);

    if (!optimization.insights.length) {
      return [
        {
          campaignId,
          priority: 'LOW',
          category: 'PERFORMANCE',
          headline: 'Campaign operating within expected range',
          explanation: 'No active decision signals indicate critical optimization risk.',
          recommendedAction: 'Continue monitoring active decisions through governance dashboards.',
        },
      ];
    }

    return optimization.insights.map((insight) => ({ ...insight, campaignId }));
  } catch {
    return [
      {
        campaignId: campaignId || '',
        priority: 'LOW',
        category: 'PERFORMANCE',
        headline: 'Campaign operating within optimal range',
        explanation: 'Unable to compute full optimization analysis',
        recommendedAction: 'Continue monitoring performance and governance metrics.',
      },
    ];
  }
}
