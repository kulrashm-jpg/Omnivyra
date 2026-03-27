import { inferExecutionMode, type ExecutionMode } from './executionModeInference';

export type SchedulableDailyPlanLike = {
  id?: string | null;
  title?: string | null;
  platform?: string | null;
  content_type?: string | null;
  execution_mode?: string | null;
  creator_asset?: unknown;
};

export type ScheduleEligibilityIssue = {
  id: string | null;
  title: string;
  platform: string;
  contentType: string;
  executionMode: ExecutionMode;
  reason: 'missing_creator_asset';
};

export type ScheduleEligibilityResult = {
  eligible: boolean;
  fullyAiExecutable: boolean;
  requiresCreatorInput: boolean;
  blockingCount: number;
  issues: ScheduleEligibilityIssue[];
};

function hasCreatorAsset(asset: unknown): boolean {
  if (asset == null || typeof asset !== 'object') return false;
  const value = asset as Record<string, unknown>;
  return Boolean(value.url || (Array.isArray(value.files) && value.files.length > 0));
}

function resolveExecutionMode(plan: SchedulableDailyPlanLike): ExecutionMode {
  const rawMode = String(plan.execution_mode ?? '').trim();
  if (rawMode === 'AI_AUTOMATED' || rawMode === 'CREATOR_REQUIRED' || rawMode === 'CONDITIONAL_AI') {
    return rawMode;
  }
  return inferExecutionMode(String(plan.content_type ?? 'post'), {
    media_ready: hasCreatorAsset(plan.creator_asset),
  });
}

export function evaluateScheduleEligibility(
  plans: SchedulableDailyPlanLike[]
): ScheduleEligibilityResult {
  const issues: ScheduleEligibilityIssue[] = [];
  let requiresCreatorInput = false;
  let fullyAiExecutable = true;

  for (const plan of plans) {
    const executionMode = resolveExecutionMode(plan);
    const creatorAssetReady = hasCreatorAsset(plan.creator_asset);

    if (executionMode !== 'AI_AUTOMATED') {
      fullyAiExecutable = false;
      requiresCreatorInput = true;
    }

    if ((executionMode === 'CREATOR_REQUIRED' || executionMode === 'CONDITIONAL_AI') && !creatorAssetReady) {
      issues.push({
        id: plan.id ? String(plan.id) : null,
        title: String(plan.title ?? '').trim() || 'Untitled activity',
        platform: String(plan.platform ?? '').trim().toLowerCase() || 'unknown',
        contentType: String(plan.content_type ?? 'post').trim().toLowerCase(),
        executionMode,
        reason: 'missing_creator_asset',
      });
    }
  }

  return {
    eligible: issues.length === 0,
    fullyAiExecutable,
    requiresCreatorInput,
    blockingCount: issues.length,
    issues,
  };
}
