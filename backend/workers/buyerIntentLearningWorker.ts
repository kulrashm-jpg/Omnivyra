/**
 * Buyer Intent Learning Worker
 *
 * Runs every 30 minutes. Aggregates engagement_opportunities by author + platform.
 */

import { supabase } from '../db/supabaseClient';
import { calculateBuyerIntentAccounts } from '../services/buyerIntentIntelligenceService';

export async function runBuyerIntentLearningWorker(): Promise<{
  organizations_processed: number;
  accounts_upserted: number;
  errors: number;
}> {
  let organizationsProcessed = 0;
  let accountsUpserted = 0;
  let errors = 0;

  const { data: orgRows } = await supabase
    .from('engagement_opportunities')
    .select('organization_id')
    .not('organization_id', 'is', null);

  const orgIds = [...new Set((orgRows ?? []).map((r: { organization_id: string }) => r.organization_id))];

  for (const orgId of orgIds) {
    try {
      const result = await calculateBuyerIntentAccounts(orgId);
      organizationsProcessed++;
      accountsUpserted += result.upserted;
      if (result.errors.length > 0) {
        errors += result.errors.length;
        result.errors.slice(0, 2).forEach((e) => console.warn('[buyerIntentLearning]', e));
      }
    } catch (err) {
      errors++;
      console.warn('[buyerIntentLearning] org error', (err as Error)?.message);
    }
  }

  return {
    organizations_processed: organizationsProcessed,
    accounts_upserted: accountsUpserted,
    errors,
  };
}
