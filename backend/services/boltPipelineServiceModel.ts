/** BOLT pipeline — types, format bindings, plan prep — split from boltPipelineService.ts (barrel preserved; importers unchanged). */
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

import { getProfile } from './companyProfileService';
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


export const AI_PLAN_TIMEOUT_MS = 120_000;
export const GENERATE_WEEKLY_TIMEOUT_MS = 90_000;
// PHASE DAILY-PLAN-STAGE-VISIBILITY — heartbeat cadence for intra-stage
// "Building Activities" substages. Lightweight (fire-and-forget current_stage
// refresh) so the UI never sits frozen on a single label during the deterministic
// daily-plan build. Does NOT affect execution/timeout/persistence.
export const GENERATE_WEEKLY_HEARTBEAT_MS = 8_000;

function normalizeOptionalUuid(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  // Closure-pass follow-up: rejects with BoltError(STAGE_TIMEOUT) instead
  // of a generic Error. The message text is identical so the classifier's
  // 'timed out' pattern match still works for legacy callers, but the
  // BoltError fast-path now gives us a stable code on the failure summary
  // without depending on string matching. Behavior unchanged otherwise.
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new BoltError(
        BOLT_ERROR_CODES.STAGE_TIMEOUT,
        `${label} timed out after ${ms / 1000}s`,
        { details: { label, timeout_ms: ms } }
      )), ms)
    ),
  ]);
}

export type BoltStage =
  | 'source-recommendation'
  | 'ai/plan'
  | 'commit-plan'
  | 'generate-weekly-structure'
  | 'creator-asset-generation'
  | 'schedule-structured-plan';

export interface BoltPayload {
  companyId: string;
  userId?: string;
  generatedCampaignId?: string | null;
  sourceStrategicTheme: Record<string, unknown>;
  executionConfig: Record<string, unknown>;
  outcomeView?: 'campaign_schedule' | 'week_plan' | 'daily_plan' | 'repurpose' | 'schedule';
  recId?: string | null;
  title?: string;
  description?: string;
  sourceOpportunityId?: string | null;
  regionsFromCard?: string[];
}

export interface BoltRunRecord {
  id: string;
  company_id: string;
  campaign_id: string | null;
  user_id: string | null;
  current_stage: string;
  status: string;
  progress_percentage: number;
  payload: BoltPayload;
  result_campaign_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * In-process snapshot of the highest progress we've already written for
 * each runId. Lets `updateRun` enforce progress monotonicity (criterion
 * C11): once we've reported 60%, a later write of 40% (e.g. during a
 * retry/resume) is clamped back up to 60%. This is purely defensive —
 * the pipeline's stage loop is monotonic by construction, but retries
 * inside a stage have historically caused brief regressions in the UI.
 *
 * Map lives for the process lifetime; harmless if it grows because
 * runIds are UUIDs and old entries become unreachable.
 */
const highestProgressByRun = new Map<string, number>();

export async function updateRun(
  runId: string,
  updates: Partial<{
    current_stage: string;
    status: string;
    progress_percentage: number;
    campaign_id: string;
    result_campaign_id: string;
    error_message: string | null;
    weeks_generated: number;
    daily_slots_created: number;
    scheduled_posts_created: number;
    themes_generated: number;
    weekly_plan_items: number;
    content_variants_generated: number;
    expected_content_items: number;
    actual_posts_published: number;
    engagement_score: number;
    conversion_score: number;
    ai_calls_total: number;
    ai_tokens_input: number;
    ai_tokens_output: number;
    distribution_batches: number;
    variant_batches: number;
    ai_cost_usd: number;
    stage_campaign_plan_cost: number;
    stage_distribution_cost: number;
    stage_blueprint_cost: number;
    stage_variant_cost: number;
    blueprint_cache_hits: number;
    blueprint_cache_misses: number;
    cache_hit_ratio: number;
  }>
): Promise<void> {
  // ── Progress monotonicity guard ────────────────────────────────────
  // Reset the tracked high-water mark when a terminal status arrives,
  // and clamp incoming progress to never regress from the highest we
  // already wrote. The 100% completion path is allowed unconditionally
  // (it's always a forward write).
  const sanitizedUpdates: Record<string, unknown> = { ...updates };
  if (typeof updates.progress_percentage === 'number') {
    const incoming = Math.max(0, Math.min(100, updates.progress_percentage));
    const prev = highestProgressByRun.get(runId) ?? 0;
    const next = Math.max(prev, incoming);
    sanitizedUpdates.progress_percentage = next;
    highestProgressByRun.set(runId, next);
  }
  if (typeof updates.status === 'string' && ['completed', 'failed', 'cancelled', 'aborted', 'partially_completed'].includes(updates.status)) {
    // Terminal status — clear the high-water mark so a re-execution of
    // the same runId (if it ever happens) starts fresh.
    highestProgressByRun.delete(runId);
  }
  // Touch heartbeat on every meaningful update; the sweeper uses this
  // as its liveness signal independent of `status`. Cheap; column is
  // indexed only on the running subset.
  //
  // Also extend the lock TTL on every update. Combined with a 2-min
  // base TTL, this means any pipeline that's actually making progress
  // (writes happen multiple times per stage) keeps its lock fresh,
  // while a truly abandoned pipeline lapses within 2 min and becomes
  // re-claimable. Token-less extension here is safe because we're
  // already inside the pipeline that holds the lock — if we don't
  // hold it, the caller is in an inconsistent state anyway.
  const heartbeatNow = new Date();
  sanitizedUpdates.heartbeat_at = heartbeatNow.toISOString();
  sanitizedUpdates.updated_at = heartbeatNow.toISOString();
  // Sliding-window lock extension. 2 minutes from each write.
  sanitizedUpdates.lock_expires_at = new Date(heartbeatNow.getTime() + 2 * 60 * 1000).toISOString();

  const { error } = await ownedDbTable('bolt_execution_runs')
    .update(sanitizedUpdates)
    .eq('id', runId);
  if (error) throw new BoltError(
    BOLT_ERROR_CODES.RUN_UPDATE_FAILED,
    `Failed to update run: ${error.message}`,
    { cause: error, details: { db_error: error.message } }
  );
}

export async function logEvent(
  runId: string,
  stage: string,
  status: string,
  metadata?: Record<string, unknown> & {
    duration_ms?: number;
    campaign_id?: string;
    error_message?: string;
  }
): Promise<void> {
  const { error } = await ownedDbTable('bolt_execution_events').insert({
    run_id: runId,
    stage,
    status,
    metadata: metadata ?? {},
  });
  if (error) console.warn('[bolt] Event log failed:', error.message);
}

export async function checkStageCompleted(runId: string, stage: string): Promise<boolean> {
  const { data } = await ownedDbTable('bolt_execution_events')
    .select('id')
    .eq('run_id', runId)
    .eq('stage', stage)
    .eq('status', 'completed')
    .limit(1)
    .maybeSingle();
  return !!data;
}

export async function getCompletedStagePlan(runId: string, stage: string): Promise<{ weeks: unknown[] } | null> {
  const { data } = await ownedDbTable('bolt_execution_events')
    .select('metadata')
    .eq('run_id', runId)
    .eq('stage', stage)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const meta = (data as { metadata?: { plan?: { weeks?: unknown[] } } } | null)?.metadata;
  const plan = meta?.plan;
  if (plan && Array.isArray(plan.weeks)) return { weeks: plan.weeks };
  return null;
}

export async function assertCampaignValid(campaignId: string): Promise<void> {
  const { data, error } = await ownedDbTable('campaigns')
    .select('id')
    .eq('id', campaignId)
    .maybeSingle();
  if (error || !data) throw new BoltError(
    BOLT_ERROR_CODES.SCHEDULING_CAMPAIGN_NOT_FOUND,
    'Campaign not found',
    { cause: error ?? undefined }
  );
}

export async function runSourceRecommendation(
  runId: string,
  payload: BoltPayload
): Promise<string> {
  const { companyId, userId, generatedCampaignId, sourceStrategicTheme, executionConfig, recId, title, description, sourceOpportunityId, regionsFromCard } = payload;
  let safeUserId = normalizeOptionalUuid(userId);

  // If userId is null (auth fell back to dev context), resolve from company membership
  if (!safeUserId && companyId) {
    const { data: companyUser } = await ownedDbTable('user_company_roles')
      .select('user_id')
      .eq('company_id', companyId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    safeUserId = normalizeOptionalUuid((companyUser as any)?.user_id);
  }

  const sourceThemeTitle = getStoredStrategicThemeTitle(sourceStrategicTheme);

  let campaignId: string;

  if (generatedCampaignId) {
    campaignId = generatedCampaignId;

    const { data: latestVersion, error: fetchError } = await ownedDbTable('campaign_versions')
      .select('id, campaign_snapshot')
      .eq('company_id', companyId)
      .eq('campaign_id', campaignId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError || !latestVersion) {
      // Part 6 — classified persistence failure so the failure summary
      // surfaces CAMPAIGN_VERSION_NOT_FOUND instead of a generic message.
      throw new BoltError(
        BOLT_ERROR_CODES.CAMPAIGN_VERSION_NOT_FOUND,
        `Campaign version not found for source-recommendation (campaign_id=${campaignId}).`,
        { cause: fetchError ?? undefined, details: { campaign_id: campaignId, company_id: companyId } }
      );
    }

    const currentSnapshot = ((latestVersion as { campaign_snapshot?: unknown }).campaign_snapshot as Record<string, unknown>) || {};
    const updatedSnapshot: Record<string, unknown> = { ...currentSnapshot };
    if (recId) {
      updatedSnapshot.source_recommendation_id = recId;
      const meta = (currentSnapshot.metadata as Record<string, unknown>) || {};
      updatedSnapshot.metadata = { ...meta, recommendation_id: recId };
    }
    updatedSnapshot.source_strategic_theme = sourceStrategicTheme;
    updatedSnapshot.execution_config = executionConfig;
    updatedSnapshot.mode = 'fast';

    const { error: updateError } = await ownedDbTable('campaign_versions')
      .update({ campaign_snapshot: updatedSnapshot })
      .eq('id', (latestVersion as { id: string }).id);

    if (updateError) {
      throw new BoltError(
        BOLT_ERROR_CODES.CAMPAIGN_VERSION_UPDATE_FAILED,
        `CAMPAIGN_VERSION_UPDATE_FAILED: ${updateError.message}`,
        { cause: updateError, details: { campaign_id: campaignId, db_error: updateError.message } }
      );
    }

    const updates: Record<string, unknown> = {};
    if (sourceThemeTitle) updates.name = sourceThemeTitle;
    const tentativeStart = executionConfig.tentative_start as string | undefined;
    if (tentativeStart) {
      updates.start_date = tentativeStart.includes('T') ? tentativeStart : `${tentativeStart}T00:00:00.000Z`;
    }
    if (Object.keys(updates).length > 0) {
      await ownedDbTable('campaigns').update(updates).eq('id', campaignId);
    }
  } else {
    const newCampaignId = crypto.randomUUID();
    const tentativeStart = executionConfig.tentative_start as string | undefined;
    const startDate = tentativeStart ? (tentativeStart.includes('T') ? tentativeStart : `${tentativeStart}T00:00:00.000Z`) : null;
    const { error: campaignError } = await ownedDbTable('campaigns').insert({
      id: newCampaignId,
      name: title || 'Campaign from themes',
      description: description ?? null,
      user_id: safeUserId,
      company_id: companyId ?? null,
      status: 'planning',
      current_stage: 'planning',
      start_date: startDate,
    });

    if (campaignError) {
      throw new BoltError(
        BOLT_ERROR_CODES.CAMPAIGN_INSERT_FAILED,
        `CAMPAIGN_INSERT_FAILED: ${campaignError.message}`,
        { cause: campaignError, details: { campaign_id: newCampaignId, company_id: companyId, db_error: campaignError.message } }
      );
    }

    const snapshotPayload: Record<string, unknown> = {
      source_strategic_theme: sourceStrategicTheme,
      execution_config: executionConfig,
      mode: 'fast',
    };
    if (sourceOpportunityId) snapshotPayload.source_opportunity_id = sourceOpportunityId;
    if (recId) {
      snapshotPayload.source_recommendation_id = recId;
      snapshotPayload.metadata = { recommendation_id: recId };
    }
    if (Array.isArray(regionsFromCard) && regionsFromCard.length > 0) {
      snapshotPayload.target_regions = regionsFromCard;
    }

    const { error: versionError } = await ownedDbTable('campaign_versions').insert({
      company_id: companyId,
      campaign_id: newCampaignId,
      campaign_snapshot: snapshotPayload,
      status: 'draft',
      version: 1,
      build_mode: 'no_context',
      campaign_types: ['brand_awareness'],
      campaign_weights: { brand_awareness: 1 },
    });

    if (versionError) {
      throw new BoltError(
        BOLT_ERROR_CODES.CAMPAIGN_VERSION_INSERT_FAILED,
        `CAMPAIGN_VERSION_INSERT_FAILED: ${versionError.message}`,
        { cause: versionError, details: { campaign_id: newCampaignId, company_id: companyId, db_error: versionError.message } }
      );
    }
    campaignId = newCampaignId;
  }

  return campaignId;
}

