/**
 * Opportunity Learning Worker
 * Aggregates engagement_content_opportunities into opportunity_learning_metrics.
 * Runs every 30 minutes.
 */

import { supabase } from '../db/supabaseClient';
import { aggregateOpportunityLearning } from '../services/opportunityLearningService';

export async function runOpportunityLearningWorker(): Promise<{
  processed: number;
  errors: number;
}> {
  let processed = 0;
  let errors = 0;

  const { data: orgs, error: orgError } = await supabase
    .from('engagement_content_opportunities')
    .select('organization_id')
    .not('organization_id', 'is', null);

  if (orgError) {
    return { processed: 0, errors: 1 };
  }

  const orgIds = [...new Set((orgs ?? []).map((r: { organization_id: string }) => r.organization_id))];

  for (const organizationId of orgIds) {
    try {
      await aggregateOpportunityLearning(organizationId);
      processed++;
    } catch {
      errors++;
    }
  }

  return { processed, errors };
}
