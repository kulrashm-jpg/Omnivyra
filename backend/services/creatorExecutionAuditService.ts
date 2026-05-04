import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

export type CreatorExecutionAuditStage =
  | 'intent'
  | 'generated'
  | 'adapted'
  | 'asset_validation'
  | 'schedule'
  | 'confirmation'
  | 'failure';

const PRODUCTION_STAGES = new Set<CreatorExecutionAuditStage>([
  'intent',
  'asset_validation',
  'schedule',
  'confirmation',
  'failure',
]);

function resolveAuditLevel(): 'debug' | 'production' {
  return process.env.CREATOR_EXECUTION_AUDIT_LOG_LEVEL === 'debug' ? 'debug' : 'production';
}

export async function logCreatorExecutionAudit(input: {
  campaignId: string;
  dailyPlanId: string;
  companyId?: string | null;
  userId?: string | null;
  platform?: string | null;
  assetType?: string | null;
  stage: CreatorExecutionAuditStage;
  attemptCount?: number;
  retryCount?: number;
  planVersion?: number | null;
  status?: string | null;
  payload?: Record<string, unknown>;
  failureType?: string | null;
}): Promise<void> {
  const logLevel = resolveAuditLevel();
  if (logLevel === 'production' && !PRODUCTION_STAGES.has(input.stage)) {
    return;
  }

  const retentionDays = logLevel === 'debug' ? 7 : 30;
  const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('creator_execution_audit_logs')
    .insert({
      campaign_id: input.campaignId,
      daily_plan_id: input.dailyPlanId,
      company_id: input.companyId ?? null,
      user_id: input.userId ?? null,
      platform: input.platform ?? null,
      asset_type: input.assetType ?? null,
      stage: input.stage,
      attempt_count: input.attemptCount ?? 0,
      retry_count: input.retryCount ?? 0,
      plan_version: input.planVersion ?? null,
      status: input.status ?? null,
      failure_type: input.failureType ?? null,
      log_level: logLevel,
      payload: input.payload ?? {},
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    });

  if (error) {
    console.warn('[creatorExecutionAudit] failed to write audit log', {
      dailyPlanId: input.dailyPlanId,
      stage: input.stage,
      error: error.message,
    });
  }
}
