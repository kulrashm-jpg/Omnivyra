/**
 * Insight Learning Worker
 *
 * Runs every 6 hours. Generates engagement insights (trend analysis).
 */

import { supabase } from '../db/supabaseClient';
import { generateInsights } from '../services/insightIntelligenceService';

export async function runInsightLearningWorker(): Promise<{
  organizations_processed: number;
  insights_created: number;
  errors: number;
}> {
  let organizationsProcessed = 0;
  let insightsCreated = 0;
  let errors = 0;

  const { data: orgRows } = await supabase
    .from('engagement_opportunities')
    .select('organization_id')
    .not('organization_id', 'is', null);

  const orgIds = [...new Set((orgRows ?? []).map((r: { organization_id: string }) => r.organization_id))];

  for (const orgId of orgIds) {
    try {
      const result = await generateInsights(orgId);
      organizationsProcessed++;
      insightsCreated += result.created;
      if (result.errors.length > 0) {
        errors += result.errors.length;
        result.errors.slice(0, 2).forEach((e) => console.warn('[insightLearning]', e));
      }
    } catch (err) {
      errors++;
      console.warn('[insightLearning] org error', (err as Error)?.message);
    }
  }

  return {
    organizations_processed: organizationsProcessed,
    insights_created: insightsCreated,
    errors,
  };
}
