/** BOLT pipeline — weekly-structure batch runner — split from boltPipelineServiceRunExec.ts (barrel preserved; importers unchanged). */
/** BOLT pipeline — weekly-structure execution + entrypoints — split from boltPipelineServiceRun.ts (barrel preserved; importers unchanged). */
/** TEMP — split from boltPipelineService.ts (barrel preserved; importers unchanged). */
import { WORKER_PROVENANCE } from '../../observability/runtime/workerProvenance';
import { ownedDbTable } from '../db/writeOwner';
import { trackEvent } from './telemetry/telemetryDispatcher';
/**
 * BOLT Pipeline Service
 *
 * Orchestrates the BOLT async execution pipeline stages.
 * Each stage updates bolt_execution_runs and logs to bolt_execution_events.
 * Supports idempotent stage execution, campaign state guards, retry, and timeouts.
 */

import { supabase } from '../db/supabaseClient';

import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
import { runCampaignAiPlan } from './campaignAiOrchestrator';
import { saveStructuredCampaignPlan, commitDraftBlueprint } from '../db/campaignPlanStore';
import { fromStructuredPlan } from './campaignBlueprintAdapter';
import { scheduleStructuredPlan } from './structuredPlanScheduler';
import { retryWithBackoff } from '../utils/retryWithBackoff';
import { getUserFriendlyMessage } from '../utils/userFriendlyErrors';
import { getConnectedPlatformsForCompany, CONTENT_PLATFORM_AFFINITY } from '../utils/platformEligibility';
import { sanitizeBoltPlanForTextOnly } from '../utils/boltTextContentConfig';
import { sanitizeBoltPlanForCombined } from '../../lib/shared/bolt/sanitizeBoltPlanForCombined';
import { filterConnectedPlatformsForContent } from '../../lib/shared/social/platformContentFilter';
import { aggregateBoltAiMetrics } from './boltMetricsAggregator';
import { getBlueprintCacheMetrics } from './contentBlueprintCache';
import { getAdaptiveDistributionAdjustments } from './campaignAdaptiveOptimizer';
import {
  determinePostsPerWeek,
  momentumScoreToLevel,
  pressureConfigToLevel,
} from './postDensityEngine';
import { generateWeeklyStructure } from './generateWeeklyStructureService';
import {
  getStoredStrategicThemeTitle,
  normalizeStoredStrategicTheme,
} from '../../lib/recommendationStrategicCard';
import {
  getExecutionProfile,
  isLegacyMediaProfile,
  withBoltMetadata,
} from '../../variants/bolt/boltCampaignMetadata';
import {
  getCreatorFormatsFromExecutionConfig,
  getUnsupportedCreatorFormats,
  getCreatorCampaignAggregate,
  isAutonomousRenderableFormat,
  isAttachmentRequiredFormat,
  validateCreatorScheduleRequest,
  type CreatorCampaignAggregate,
} from '../../lib/shared/creatorGovernanceRegistry';
import {
  runCreatorAssetGenerationRuntime,
  type CreatorAssetGenerationMode,
  type CreatorAssetGenerationResult,
} from './creatorAssetGenerationRuntime';
import {
  persistPipelineFailure,
  deriveBoltCampaignType,
  type BoltPipelineMode,
  type BoltCampaignType,
} from './boltPipelineFailurePersistence';
import { captureStrategySnapshot } from '../../lib/shared/bolt/captureStrategySnapshot';
import { assertValidBoltBlueprint } from '../../lib/shared/bolt/validateBoltBlueprint';
import { BoltError, BOLT_ERROR_CODES } from '../../lib/shared/bolt/boltErrorCodes';
import { FORMAT_EXCLUSIVE_PLATFORMS } from '../../lib/shared/bolt/formatPlatformBinding';
// Phase 6G-1 — canonical content↔platform assignment authority (derive, don't duplicate).
import { filterPlatformsForFormat, getSupportedPlatformsForFormat } from '../../lib/shared/bolt/contentPlatformAssignment';
import {
  MAX_CAMPAIGN_DURATION_WEEKS,
  MAX_SHORT_CAMPAIGN_DURATION_WEEKS,
} from '../../lib/shared/campaignDuration';
// Phase 6D-B — Intelligent Mix plan-generation reuses the 6D-A intelligence resolver.
import {
  resolveIntelligenceContext,
  formatIntelligenceForPlanning,
  normalizePlanningIntelligenceMode,
  shouldResolvePlanningIntelligence,
  shouldEnrichPlanning,
} from '../../lib/shared/intelligence/resolveIntelligenceContext';
// Phase 6D-C / 6E-2 — adaptive platform prioritization (ordering only; eligibility untouched).
// Re-pointed to the company-scoped aggregator so new campaigns have data.
import {
  rankPlatformsByCompanyPerformance,
  rankContentTypesByCompanyPerformance,
} from './companyPerformanceAggregator';
import {
  orderPlatformsForIntelligentMix,
  normalizePlatformPriorityMode,
  shouldPrioritizePlatforms,
} from '../../lib/shared/intelligence/platformOrdering';
// Phase 6D-D1 — format preference intelligence (ordering only; counts untouched).
import { getMarketingMemoriesByType } from './marketingMemoryService';
import {
  orderFormatsForIntelligentMix,
  extractFormatSignalsFromMemory,
  normalizeFormatPriorityMode,
  shouldPrioritizeFormats,
} from '../../lib/shared/intelligence/formatOrdering';
import { withBlueprintSaveGuard } from './boltPersistenceGuards';
import {
  acquireRunLock,
  extendRunLock,
  releaseRunLock,
  DEFAULT_LOCK_TTL_MS,
} from './boltExecutionLock';

import { AI_PLAN_TIMEOUT_MS, GENERATE_WEEKLY_TIMEOUT_MS, GENERATE_WEEKLY_HEARTBEAT_MS, withTimeout, type BoltStage, type BoltPayload, updateRun, logEvent, checkStageCompleted, getCompletedStagePlan, assertCampaignValid, runSourceRecommendation } from './boltPipelineServiceModel';

import { runAiPlan, runCommitPlan } from './boltPipelineServiceRunPlan';


const BATCH_WEEK_SIZE = 4;

export async function runGenerateWeeklyStructure(
  runId: string,
  campaignId: string,
  companyId: string,
  planWeeks: unknown[],
  updateRun: (updates: Partial<{ current_stage: string; status: string; progress_percentage: number; weeks_generated: number; daily_slots_created: number }>) => Promise<void>,
  logEvent: (runId: string, stage: string, status: string, metadata?: Record<string, unknown>) => Promise<void>,
  options?: { eligiblePlatforms?: string[]; postsPerWeek?: number; campaignStartDate?: string; boltTextOnly?: boolean; execConfig?: Record<string, unknown> }
): Promise<{ weeksGenerated: number; dailySlotsCreated: number }> {
  let dailySlotsCreated = 0;
  const numWeeks = planWeeks.length;
  const weekNumbers = (planWeeks as Array<{ week_number?: number; week?: number }>).map(
    (w, i) => Number(w?.week_number ?? w?.week ?? i + 1)
  );
  let completedWeeksSoFar: number[] = [];

  for (let i = 0; i < weekNumbers.length; i += BATCH_WEEK_SIZE) {
    const batchWeeks = weekNumbers.slice(i, i + BATCH_WEEK_SIZE);

    let adaptiveInsights: Awaited<ReturnType<typeof getAdaptiveDistributionAdjustments>> | null = null;
    if (completedWeeksSoFar.length > 0) {
      try {
        adaptiveInsights = await getAdaptiveDistributionAdjustments({
          campaignId,
          companyId,
          completedWeeks: completedWeeksSoFar,
        });
      } catch (err) {
        console.warn('[bolt] adaptive optimizer failed:', (err as Error)?.message);
      }
    }
    const batchStageName = batchWeeks.length === 1
      ? `generate-weekly-structure-week-${batchWeeks[0]}`
      : `generate-weekly-structure-weeks-${batchWeeks[0]}-${batchWeeks[batchWeeks.length - 1]}`;

    const allDoneRes = await Promise.all(
      batchWeeks.map((wn) => checkStageCompleted(runId, `generate-weekly-structure-week-${wn}`))
    );
    if (allDoneRes.every(Boolean)) {
      for (const wn of batchWeeks) {
        const { data: ev } = await ownedDbTable('bolt_execution_events')
          .select('metadata')
          .eq('run_id', runId)
          .eq('stage', `generate-weekly-structure-week-${wn}`)
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const meta = (ev as { metadata?: { dailySlots?: number } } | null)?.metadata;
        dailySlotsCreated += Number(meta?.dailySlots ?? 0);
      }
      continue;
    }

    await updateRun({ current_stage: batchStageName, status: 'running' });
    await logEvent(runId, batchStageName, 'started');

    // PHASE DAILY-PLAN-STAGE-VISIBILITY — intra-stage "Building Activities"
    // substages emitted from the ORCHESTRATOR around the deterministic build
    // (generateWeeklyStructureService is NOT touched). Mirrors the ai/plan
    // substage pattern: fire-and-forget current_stage refresh, never throws.
    const emitWeeklySub = (sub: string) =>
      void updateRun({ current_stage: `generate-weekly-structure:${sub}` }).catch(() => { /* advisory */ });
    emitWeeklySub('preparing');

          // Resolve format_frequency: always pass it when available so generateWeeklyStructure
          // creates daily plans for ALL selected content types (not just the AI plan's content_type_mix).
          const resolvedFormatFreq = (() => {
            const ff = options?.execConfig?.format_frequency;
            if (ff && typeof ff === 'object' && !Array.isArray(ff) && Object.keys(ff as object).length > 0) {
              return ff as Record<string, number>;
            }
            // Fallback: build from content_formats array if format_frequency is missing
            const cf = options?.execConfig?.content_formats;
            if (Array.isArray(cf) && cf.length > 0) {
              const freq: Record<string, number> = {};
              const perType = Math.max(1, Math.round((options?.postsPerWeek ?? 6) / cf.length));
              for (const f of cf) freq[String(f).toLowerCase()] = perType;
              return freq;
            }
            return null;
          })();
          if (resolvedFormatFreq) {
            console.log('[bolt] format_frequency resolved for weekly structure:', resolvedFormatFreq);
          }

          const callService = () =>
      generateWeeklyStructure({
        campaignId,
        companyId,
        weeks: batchWeeks,
        variantMetadata: withBoltMetadata({}, { runId, textOnly: options?.boltTextOnly ?? true }).variantMetadata,
        eligible_platforms: options?.eligiblePlatforms,
        ...(options?.postsPerWeek != null ? { posts_per_week: options.postsPerWeek } : {}),
        ...(options?.campaignStartDate ? { campaign_start_date: options.campaignStartDate } : {}),
        ...(resolvedFormatFreq ? { format_frequency: resolvedFormatFreq } : {}),
        cross_platform_sharing: options?.execConfig?.cross_platform_sharing as boolean | { enabled: boolean } | undefined,
        conflict_policy: options?.execConfig?.conflict_policy as 'avoid' | 'skip' | 'override' | undefined,
        ...(adaptiveInsights
          ? {
              adaptive_performance_insights: {
                high_performing_platforms: adaptiveInsights.high_performing_platforms,
                high_performing_content_types: adaptiveInsights.high_performing_content_types,
                low_performing_patterns: adaptiveInsights.low_performing_patterns,
              },
            }
          : {}),
      });

    // Heartbeat: while the deterministic build runs (up to ~180s) keep the
    // "Building activity rows…" substage fresh so the elapsed timer + tips
    // animate and the screen never looks frozen. Cleared in `finally`.
    emitWeeklySub('building-rows');
    const weeklyHeartbeat = setInterval(() => emitWeeklySub('building-rows'), GENERATE_WEEKLY_HEARTBEAT_MS);
    let data: Awaited<ReturnType<typeof callService>>;
    try {
      data = await retryWithBackoff(
        () =>
          withTimeout(
            callService(),
            GENERATE_WEEKLY_TIMEOUT_MS * Math.max(1, batchWeeks.length / 2),
            `generate-weekly-structure weeks ${batchWeeks.join(',')}`
          ),
        { maxRetries: 3, initialDelayMs: 1000 }
      );
    } finally {
      clearInterval(weeklyHeartbeat);
    }
    emitWeeklySub('saving');

    const count = Array.isArray(data?.dailyPlan) ? data.dailyPlan.length : 0;
    dailySlotsCreated += count;

    for (const wn of batchWeeks) {
      await logEvent(runId, `generate-weekly-structure-week-${wn}`, 'completed', {
        week: wn,
        dailySlots: Math.floor(count / batchWeeks.length),
      });
    }
    // Advance the per-week numeric progress shown by ProgressCard
    // ("Nw generated · X slots") — progress telemetry only, not a campaign output.
    void updateRun({
      weeks_generated: completedWeeksSoFar.length + batchWeeks.length,
      daily_slots_created: dailySlotsCreated,
    }).catch(() => { /* advisory */ });

    completedWeeksSoFar = [...completedWeeksSoFar, ...batchWeeks];
  }

  return { weeksGenerated: numWeeks, dailySlotsCreated };
}

export async function runScheduleStructuredPlan(
  campaignId: string,
  plan: { weeks: unknown[] },
  executionConfig: Record<string, unknown>,
  executionProfile: string | undefined,
  onProgress?: (stage: string) => void,
  eligiblePlatforms?: string[],
  runId?: string
): Promise<{ scheduled_count: number }> {
  const tentativeStart = executionConfig.tentative_start as string | undefined;
  if (tentativeStart) {
    const startDate = tentativeStart.includes('T') ? tentativeStart : `${tentativeStart}T00:00:00.000Z`;
    await ownedDbTable('campaigns').update({ start_date: startDate }).eq('id', campaignId);
  }

  const rawFreq = executionConfig.frequency_per_week;
  let frequencyPerWeek: number | undefined;
  if (typeof rawFreq === 'number' && rawFreq > 0 && isFinite(rawFreq)) {
    frequencyPerWeek = Math.round(rawFreq);
  } else if (typeof rawFreq === 'string') {
    const p = rawFreq.trim().toLowerCase() === 'daily' ? 7 : parseInt(rawFreq, 10);
    if (!isNaN(p) && p > 0) frequencyPerWeek = p;
  }

  // BOLT Text campaigns are small (≤5 formats, ≤4 weeks, text-only) — use the
  // inline block processor path instead of the queue/worker path.  The queue path
  // depends on BullMQ workers which may not be running in serverless environments.
  // Omitting run_id forces scheduleStructuredPlan to use processBlockSchedule inline.
  const result = await scheduleStructuredPlan(
    { weeks: plan.weeks } as Parameters<typeof scheduleStructuredPlan>[0],
    campaignId,
    {
      generateContent: true,
      onProgress,
      frequencyPerWeek,
      eligiblePlatforms: eligiblePlatforms?.length ? eligiblePlatforms : undefined,
      executionProfile,
    }
  );
  await ownedDbTable('campaigns')
    .update({
      status: 'active',
      current_stage: 'schedule',
      blueprint_status: 'ACTIVE',
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaignId);

  return { scheduled_count: result.scheduled_count };
}

export const STAGES: BoltStage[] = [
  'source-recommendation',
  'ai/plan',
  'commit-plan',
  'generate-weekly-structure',
  'creator-asset-generation',
  'schedule-structured-plan',
];

export function validateExecutionConfig(
  execConfig: Record<string, unknown> | undefined,
  // Phase 6C-4A: max allowed weeks, derived from the shared authority by the
  // caller per campaign_mode. Defaults to the short (BOLT Text/Creator) range so
  // any non-combined caller stays 1–4.
  maxDurationWeeks: number = MAX_SHORT_CAMPAIGN_DURATION_WEEKS,
): string[] {
  const required = [
    'target_audience',
    'content_depth',
    'frequency_per_week',
    'campaign_duration',
    'tentative_start',
    'campaign_goal',
  ];

  const missing = required.filter(
    (key) =>
      !execConfig ||
      execConfig[key] === undefined ||
      execConfig[key] === null ||
      execConfig[key] === ''
  );

  if (!missing.includes('campaign_duration') && execConfig?.campaign_duration != null) {
    const d = Number(execConfig.campaign_duration);
    if (!Number.isInteger(d) || d < 1 || d > maxDurationWeeks) {
      missing.push('campaign_duration_invalid'); // 1–4 (Text/Creator) or 1–12 (combined)
    }
  }

  return missing;
}

