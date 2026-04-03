/**
 * Campaign ROI intelligence derived from persisted decision_objects only.
 * Read-only and non-generative.
 */

import { supabase } from '../db/supabaseClient';
import {
  composeCampaignOptimizationView,
  composeDecisionIntelligence,
} from './decisionComposerService';

export interface CampaignRoiIntelligence {
  campaignId: string;
  roiScore: number;
  performanceScore: number;
  governanceStabilityScore: number;
  executionReliabilityScore: number;
  optimizationSignal: 'STABLE' | 'AT_RISK' | 'HIGH_POTENTIAL';
  recommendation?: string;
}

const DEFAULT_INTELLIGENCE: Omit<CampaignRoiIntelligence, 'campaignId'> = {
  roiScore: 50,
  performanceScore: 50,
  governanceStabilityScore: 80,
  executionReliabilityScore: 80,
  optimizationSignal: 'STABLE',
  recommendation: 'Insufficient data to assess ROI. Add performance metrics and governance events.',
}

export async function getCampaignRoiIntelligence(
  campaignId: string,
  _govAnalyticsPrecomputed?: unknown
): Promise<CampaignRoiIntelligence> {
  try {
    if (!campaignId || typeof campaignId !== 'string') {
      return { campaignId: campaignId || '', ...DEFAULT_INTELLIGENCE };
    }

    const { data: campaignRow, error: campaignError } = await supabase
      .from('campaigns')
      .select('company_id')
      .eq('id', campaignId)
      .maybeSingle();

    if (campaignError || !campaignRow?.company_id) {
      return { campaignId, ...DEFAULT_INTELLIGENCE };
    }

    const composition = await composeDecisionIntelligence({
      companyId: campaignRow.company_id,
      reportTier: 'deep',
      entityType: 'campaign',
      entityId: campaignId,
      status: ['open'],
    });

    const optimization = composeCampaignOptimizationView(campaignId, composition);

    if (optimization.insights.length === 0) {
      return { campaignId, ...DEFAULT_INTELLIGENCE };
    }

    return {
      campaignId,
      roiScore: optimization.roi.roiScore,
      performanceScore: optimization.roi.performanceScore,
      governanceStabilityScore: optimization.roi.governanceStabilityScore,
      executionReliabilityScore: optimization.roi.executionReliabilityScore,
      optimizationSignal: optimization.roi.optimizationSignal,
      recommendation: optimization.roi.recommendation,
    };
  } catch {
    return {
      campaignId: campaignId || '',
      ...DEFAULT_INTELLIGENCE,
    };
  }
}
