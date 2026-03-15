/**
 * Influencer Learning Worker
 *
 * Runs every 30 minutes.
 * Aggregates authors from engagement_messages, computes metrics, and upserts influencer_intelligence.
 */

import { supabase } from '../db/supabaseClient';
import { calculateInfluencers } from '../services/influencerIntelligenceService';

export async function runInfluencerLearningWorker(): Promise<{
  organizations_processed: number;
  influencers_upserted: number;
  errors: number;
}> {
  let organizationsProcessed = 0;
  let influencersUpserted = 0;
  let errors = 0;

  const { data: orgRows } = await supabase
    .from('engagement_threads')
    .select('organization_id')
    .not('organization_id', 'is', null);

  const orgIds = [...new Set((orgRows ?? []).map((r: { organization_id: string }) => r.organization_id))];

  for (const orgId of orgIds) {
    try {
      const result = await calculateInfluencers(orgId);
      organizationsProcessed++;
      influencersUpserted += result.upserted;
      if (result.errors.length > 0) {
        errors += result.errors.length;
        result.errors.slice(0, 3).forEach((e) => console.warn('[influencerLearning]', e));
      }
    } catch (err) {
      errors++;
      console.warn('[influencerLearning] org error', (err as Error)?.message);
    }
  }

  return {
    organizations_processed: organizationsProcessed,
    influencers_upserted: influencersUpserted,
    errors,
  };
}
