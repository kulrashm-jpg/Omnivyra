/**
 * Opportunity Activation Metrics — Phase-1 Read-Only
 * Query: campaign_versions (metadata.source = 'trend_opportunity')
 * Query: theme_company_relevance
 * SELECT only, no writes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface OpportunityActivationResult {
  campaignsFromOpportunities: number;
  availableOpportunities: number;
}

export async function getOpportunityActivationMetrics(
  supabase: SupabaseClient,
  companyId: string
): Promise<OpportunityActivationResult> {
  const empty: OpportunityActivationResult = {
    campaignsFromOpportunities: 0,
    availableOpportunities: 0,
  };

  try {
    const [versionsResult, relevanceResult] = await Promise.all([
      supabase
        .from('campaign_versions')
        .select('campaign_snapshot')
        .eq('company_id', companyId),

      supabase
        .from('theme_company_relevance')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId),
    ]);

    let campaignsFromOpportunities = 0;
    const versions = versionsResult.data ?? [];
    for (const row of versions as Array<{ campaign_snapshot?: { metadata?: { source?: string } } }>) {
      const source = row?.campaign_snapshot?.metadata?.source;
      if (String(source || '').toLowerCase() === 'trend_opportunity') {
        campaignsFromOpportunities += 1;
      }
    }

    const availableOpportunities = relevanceResult.count ?? 0;

    return {
      campaignsFromOpportunities,
      availableOpportunities,
    };
  } catch {
    return empty;
  }
}
