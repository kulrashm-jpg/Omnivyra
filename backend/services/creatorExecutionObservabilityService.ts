import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

export async function recordCreatorExecutionMetric(input: {
  campaignId: string;
  dailyPlanId: string;
  platform?: string | null;
  assetType?: string | null;
  metricName: 'execution_success_count' | 'execution_failure_count' | 'retry_count' | 'avg_execution_latency' | 'validation_failure_count';
  metricValue: number;
}): Promise<void> {
  const { error } = await supabase
    .from('creator_execution_metrics')
    .insert({
      campaign_id: input.campaignId,
      daily_plan_id: input.dailyPlanId,
      platform: input.platform ?? null,
      asset_type: input.assetType ?? null,
      metric_name: input.metricName,
      metric_value: input.metricValue,
      created_at: new Date().toISOString(),
    });

  if (error) {
    console.warn('[creatorExecutionMetrics] failed to record metric', {
      campaignId: input.campaignId,
      dailyPlanId: input.dailyPlanId,
      metricName: input.metricName,
      error: error.message,
    });
  }
}

export async function upsertCreatorExecutionSummary(input: {
  campaignId: string;
  dailyPlanId: string;
  platform?: string | null;
  assetType?: string | null;
  totalAttempts: number;
  retryCount: number;
  finalStatus: string;
  failureReason?: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from('creator_execution_summaries')
    .upsert({
      campaign_id: input.campaignId,
      daily_plan_id: input.dailyPlanId,
      platform: input.platform ?? null,
      asset_type: input.assetType ?? null,
      total_attempts: input.totalAttempts,
      retry_count: input.retryCount,
      final_status: input.finalStatus,
      failure_reason: input.failureReason ?? null,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'daily_plan_id',
    });

  if (error) {
    console.warn('[creatorExecutionSummary] failed to upsert summary', {
      campaignId: input.campaignId,
      dailyPlanId: input.dailyPlanId,
      error: error.message,
    });
  }
}

export async function writeCreatorDeadLetter(input: {
  campaignId: string;
  dailyPlanId: string;
  platform?: string | null;
  assetType?: string | null;
  failureReason: string;
  payloadSnapshot: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase
    .from('creator_execution_dead_letter_queue')
    .insert({
      campaign_id: input.campaignId,
      daily_plan_id: input.dailyPlanId,
      platform: input.platform ?? null,
      asset_type: input.assetType ?? null,
      failure_reason: input.failureReason,
      payload_snapshot: input.payloadSnapshot,
      failed_at: new Date().toISOString(),
    });

  if (error) {
    console.warn('[creatorExecutionDeadLetter] failed to insert dead letter row', {
      campaignId: input.campaignId,
      dailyPlanId: input.dailyPlanId,
      error: error.message,
    });
  }
}
