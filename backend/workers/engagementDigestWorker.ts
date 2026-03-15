/**
 * Engagement Digest Worker
 * Generates daily digest for each organization. Runs once per day.
 */

import { supabase } from '../db/supabaseClient';
import { generateDailyDigest } from '../services/engagementDigestService';
import { executeWithRetry } from '../services/workerRetryService';
import { getControls } from '../services/engagementGovernanceService';

export async function runEngagementDigestWorker(): Promise<{
  processed: number;
  errors: number;
}> {
  let processed = 0;
  let errors = 0;

  const { data: orgs, error: orgError } = await supabase
    .from('engagement_threads')
    .select('organization_id')
    .not('organization_id', 'is', null)
    .limit(500);

  if (orgError || !orgs?.length) {
    return { processed: 0, errors: 0 };
  }

  const orgIds = [...new Set((orgs ?? []).map((r: { organization_id: string }) => r.organization_id))];

  for (const organizationId of orgIds) {
    const controls = await getControls(organizationId);
    if (!controls.digest_generation_enabled) continue;

    try {
      await executeWithRetry(
        'engagementDigestWorker',
        { organization_id: organizationId },
        async () => {
          const digest = await generateDailyDigest(organizationId);
          if (!digest) throw new Error('generateDailyDigest returned null');
        }
      );
      processed++;
    } catch {
      errors++;
    }
  }

  return { processed, errors };
}
