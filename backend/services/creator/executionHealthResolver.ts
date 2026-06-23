/**
 * PHASE CAMPAIGN-HEALTH-BOLT-ALIGNMENT — DB-backed execution-health resolver.
 *
 * Thin, additive, read-only. Reads the campaign's BOLT execution rows
 * (daily_content_plans.content_status, scheduled_posts.status) plus the creator
 * schedule write-drift (the reconciler) and feeds them into the PURE
 * `computeExecutionHealth` authority. Mutates nothing; makes no scheduling or
 * publishing decision. A future API/consumer can call this to overlay the
 * execution truth on the Activity-board health via `combineHealthColor`.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { computeExecutionHealth, type ExecutionHealth } from '../../../lib/shared/executionHealth';
import { detectCreatorScheduleDrift } from './creatorScheduleReconciler';

/**
 * Resolve execution-health for one campaign. Read-only; never throws on empty
 * data (returns a green/healthy result).
 */
export async function resolveCampaignExecutionHealth(campaignId: string): Promise<ExecutionHealth> {
  const [{ data: dpRaw }, { data: spRaw }, drift] = await Promise.all([
    ownedDbTable('daily_content_plans').select('content_status').eq('campaign_id', campaignId),
    ownedDbTable('scheduled_posts').select('status').eq('campaign_id', campaignId),
    detectCreatorScheduleDrift(campaignId),
  ]);

  const dailyPlanStatuses = ((dpRaw as Array<Record<string, unknown>> | null) ?? []).map(
    (r) => (r.content_status as string | null) ?? null,
  );
  const scheduledPostStatuses = ((spRaw as Array<Record<string, unknown>> | null) ?? []).map(
    (r) => (r.status as string | null) ?? null,
  );

  return computeExecutionHealth({
    dailyPlanStatuses,
    scheduledPostStatuses,
    scheduleDrift: {
      orphanCount: drift.orphanedScheduledPosts.length,
      danglingCount: drift.danglingDailyPlans.length,
    },
  });
}
