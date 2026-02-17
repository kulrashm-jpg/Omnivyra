/**
 * Stage 37 — Auto-Optimization Background Job.
 * Runs after scheduler cycle. Non-blocking. Never throws.
 */

import { supabase } from '../db/supabaseClient';
import { runAutoOptimization } from '../services/CampaignAutoOptimizationService';

/**
 * Run auto-optimization for all campaigns with auto_optimize_enabled = true.
 * Non-blocking. Never throws.
 */
export async function runAutoOptimizationForEligibleCampaigns(): Promise<void> {
  try {
    const { data: campaigns, error } = await supabase
      .from('campaigns')
      .select('id')
      .eq('auto_optimize_enabled', true);

    if (error || !campaigns?.length) {
      if (campaigns?.length === 0) {
        console.log('AutoOptimizationJob: no campaigns with auto_optimize_enabled');
      }
      return;
    }

    let applied = 0;
    for (const c of campaigns) {
      const campaignId = (c as { id: string }).id;
      if (!campaignId) continue;
      try {
        const result = await runAutoOptimization(campaignId);
        if (result.applied) applied++;
      } catch {
        // Non-blocking. Never throws.
      }
    }

    if (applied > 0) {
      console.log(`✅ Auto-optimization: applied to ${applied} campaign(s)`);
    }
  } catch (err) {
    console.error('AutoOptimizationJob: run failed', err);
  }
}
