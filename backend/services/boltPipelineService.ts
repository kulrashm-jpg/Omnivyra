import { ownedDbTable } from '../db/writeOwner';
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
import {
  acquireRunLock,
  extendRunLock,
  releaseRunLock,
  DEFAULT_LOCK_TTL_MS,
} from './boltExecutionLock';

const AI_PLAN_TIMEOUT_MS = 120_000;
const GENERATE_WEEKLY_TIMEOUT_MS = 90_000;

function normalizeOptionalUuid(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
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

async function updateRun(
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
  if (error) throw new Error(`Failed to update run: ${error.message}`);
}

async function logEvent(
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

async function checkStageCompleted(runId: string, stage: string): Promise<boolean> {
  const { data } = await ownedDbTable('bolt_execution_events')
    .select('id')
    .eq('run_id', runId)
    .eq('stage', stage)
    .eq('status', 'completed')
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function getCompletedStagePlan(runId: string, stage: string): Promise<{ weeks: unknown[] } | null> {
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

async function assertCampaignValid(campaignId: string): Promise<void> {
  const { data, error } = await ownedDbTable('campaigns')
    .select('id')
    .eq('id', campaignId)
    .maybeSingle();
  if (error || !data) throw new Error('Campaign not found');
}

async function runSourceRecommendation(
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
      throw new Error('Campaign version not found for source-recommendation');
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

    if (updateError) throw new Error(`Source-recommendation update failed: ${updateError.message}`);

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

    if (campaignError) throw new Error(`Campaign creation failed: ${campaignError.message}`);

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

    if (versionError) throw new Error(`Campaign version creation failed: ${versionError.message}`);
    campaignId = newCampaignId;
  }

  return campaignId;
}

async function runAiPlan(runId: string, campaignId: string, companyId: string, payload: BoltPayload, eligiblePlatforms?: string[], requiresMediaFlow?: boolean, isCombined?: boolean): Promise<{ plan: { weeks: unknown[] }; result: Awaited<ReturnType<typeof runCampaignAiPlan>> }> {
  const snapshot = payload.sourceStrategicTheme as Record<string, unknown>;
  const normalizedTheme = normalizeStoredStrategicTheme(snapshot);
  const basePayload = (snapshot?.context_payload && typeof snapshot.context_payload === 'object')
    ? { ...snapshot.context_payload }
    : {};
  const mergedPayload: Record<string, unknown> =
    payload.sourceStrategicTheme && typeof payload.sourceStrategicTheme === 'object'
      ? { ...basePayload, ...payload.sourceStrategicTheme }
      : basePayload;
  if (normalizedTheme) {
    mergedPayload.primary_recommendations = normalizedTheme.blueprint.primary_recommendations;
    mergedPayload.supporting_recommendations = normalizedTheme.blueprint.supporting_recommendations;
    mergedPayload.progression_summary = normalizedTheme.blueprint.progression_summary;
    mergedPayload.duration_weeks = normalizedTheme.blueprint.duration_weeks;
  }

  const topicFromCard = getStoredStrategicThemeTitle(snapshot);

  const recommendationContext = {
    target_regions: payload.regionsFromCard ?? null,
    context_payload: Object.keys(mergedPayload).length > 0 ? mergedPayload : null,
    source_opportunity_id: payload.sourceOpportunityId ?? null,
    ...(topicFromCard ? { topic_from_card: topicFromCard } : {}),
  };

  const execConfig = (payload.executionConfig ?? {}) as Record<string, unknown>;
  const themeTitle = topicFromCard;

  // Build collectedPlanningContext: executionConfig from Trend page first, then theme, then defaults for QA keys only
  const parsedFreq =
    typeof execConfig.frequency_per_week === 'string'
      ? parseInt(String(execConfig.frequency_per_week).replace(/\D/g, '') || '5', 10) || 5
      : typeof execConfig.frequency_per_week === 'number'
        ? execConfig.frequency_per_week
        : 5;

  // Build default platform requests from the company's configured platforms (eligiblePlatforms).
  // eligiblePlatforms is already narrowed by execConfig.selected_platforms upstream
  // (see executeBoltPipeline), so we just fall back to LinkedIn if nothing is configured.
  const configuredPlatforms = eligiblePlatforms && eligiblePlatforms.length > 0
    ? eligiblePlatforms
    : ['linkedin'];

  let platformContentPrefs: Record<string, string[]> = {};
  try {
    const { data } = await ownedDbTable('company_profiles')
      .select('platform_content_type_prefs')
      .eq('company_id', companyId)
      .maybeSingle();
    if (data?.platform_content_type_prefs && typeof data.platform_content_type_prefs === 'object') {
      platformContentPrefs = data.platform_content_type_prefs as Record<string, string[]>;
    }
  } catch { /* non-fatal — fall back to 'post' */ }

  const getPrimaryContentType = (platform: string): string => {
    const canonical = platform.toLowerCase().replace(/^twitter$/i, 'x');
    const prefs = platformContentPrefs[canonical] ?? platformContentPrefs[platform.toLowerCase()];
    if (Array.isArray(prefs) && prefs.length > 0) {
      // Pick the first text-compatible content type (skip video/reel for BOLT text campaigns)
      if (requiresMediaFlow) return prefs[0];
      const textSafe = prefs.find((t) => !['video', 'reel', 'short'].includes(t.toLowerCase()));
      return textSafe ?? prefs[0];
    }
    return 'post';
  };

  // Frequency semantics: `frequency_per_week` and `format_frequency[type]` are
  // TOTALS across all selected platforms, not per-platform. How the skeleton turns
  // these into unique pieces depends on `cross_platform_sharing`:
  //   • sharing OFF → per-platform counts sum to `total`; each count is a solo piece.
  //     Total scheduled = sum(counts) = total.
  //   • sharing ON  → the skeleton uses `max(counts)` unique pieces. The first piece
  //     cross-posts to all platforms; any remaining per-platform capacity becomes
  //     SOLO extras on the platforms that still have leftover count. So distributing
  //     `total` with remainder (e.g. 9 across 4 platforms → [3,2,2,2] if the first
  //     platform is the affinity winner for the content type) yields 2 shared pieces
  //     × 4 platforms + 1 solo piece on platform 0 = 9 scheduled exactly.
  // In both modes, distribute with remainder — the skeleton picks the right unique-
  // piece reduction.
  const distributeAcrossPlatforms = (total: number, platformCount: number): number[] => {
    if (platformCount <= 0 || total <= 0) return [];
    const base = Math.floor(total / platformCount);
    const remainder = total % platformCount;
    return Array.from({ length: platformCount }, (_, i) => base + (i < remainder ? 1 : 0));
  };

  const defaultDistribution = distributeAcrossPlatforms(Math.max(1, parsedFreq), configuredPlatforms.length);
  const defaultPlatformRequests = configuredPlatforms.map((p, idx) => ({
    platform: p,
    content_type: getPrimaryContentType(p),
    count_per_week: Math.max(1, defaultDistribution[idx] ?? 1),
  }));
  // When format_frequency is provided (multi-format BOLT: e.g. 3 posts + 3 articles),
  // expand into one entry per (platform × content_type) so all selected formats appear
  // as separate execution items instead of collapsing to the primary type only.
  const formatFreqMap =
    execConfig.format_frequency &&
    typeof execConfig.format_frequency === 'object' &&
    !Array.isArray(execConfig.format_frequency)
      ? (execConfig.format_frequency as Record<string, number>)
      : null;
  // Under sharing OFF the remainder (`total % P`) becomes an EXTRA post on the
  // first platforms in the list. To land the remainder on the platform most
  // natural for each content type (e.g. an `article` remainder should prefer
  // LinkedIn, not X), we reorder configuredPlatforms by CONTENT_PLATFORM_AFFINITY
  // for that type before distributing.
  const sortPlatformsByAffinity = (platforms: string[], contentType: string): string[] => {
    const affinity = CONTENT_PLATFORM_AFFINITY[String(contentType).toLowerCase()] ?? [];
    if (affinity.length === 0) return platforms;
    const rank = (p: string): number => {
      const idx = affinity.indexOf(p.toLowerCase());
      return idx >= 0 ? idx : Number.MAX_SAFE_INTEGER;
    };
    return [...platforms].sort((a, b) => rank(a) - rank(b));
  };

  const formatDerivedRequests: Array<{ platform?: string; content_type?: string; count_per_week?: number }> | null =
    !execConfig.platform_content_requests && formatFreqMap && Object.keys(formatFreqMap).length > 0
      ? Object.entries(formatFreqMap)
          .filter(([, cnt]) => Number(cnt) > 0)
          .flatMap(([ct, cnt]) => {
            const orderedPlatforms = sortPlatformsByAffinity(configuredPlatforms, ct);
            const perPlatform = distributeAcrossPlatforms(Number(cnt), orderedPlatforms.length);
            return orderedPlatforms
              .map((p, i) => ({ platform: p, content_type: ct, count_per_week: perPlatform[i] ?? 0 }))
              .filter((r) => r.count_per_week > 0);
          })
      : null;
  const rawPlatformRequests = (execConfig.platform_content_requests ?? formatDerivedRequests ?? defaultPlatformRequests) as Array<{ platform?: string; content_type?: string; count_per_week?: number }>;
  const boltPlatformRequests = rawPlatformRequests
    // Text BOLT excludes video-first platforms; creator and combined campaigns keep them all
    .filter((r) => r && r.platform && (requiresMediaFlow || isCombined || !['youtube', 'tiktok'].includes(String(r.platform).toLowerCase())))
    .map((r) => ({
      platform: r.platform,
      content_type: !requiresMediaFlow && !isCombined && ['video', 'reel', 'carousel', 'slider', 'image', 'banner'].includes(String(r.content_type ?? '').toLowerCase())
        ? 'post'
        : (r.content_type ?? 'post'),
      count_per_week: r.count_per_week ?? Math.max(1, Math.floor(parsedFreq / 2)),
    }));

  const durationWeeks = Math.min(
    4,
    Math.max(1, typeof execConfig.campaign_duration === 'number' ? execConfig.campaign_duration : 4)
  );
  const collectedPlanningContext: Record<string, unknown> = {
    ...execConfig,
    execution_config: execConfig,
    ...payload.sourceStrategicTheme,
    ...execConfig,
    // QA-required keys: use execConfig value if present, else default
    // When format_frequency is set (multi-format BOLT), mirror it as capacity so the per-type
    // capacity validator doesn't flag article/blog/etc. demand as exceeding 0 capacity.
    available_content: execConfig.available_content ?? 'No',
    weekly_capacity: execConfig.weekly_capacity ?? execConfig.content_capacity ?? (formatFreqMap && Object.keys(formatFreqMap).length > 0 ? { ...formatFreqMap } : { post: Math.max(1, parsedFreq) }),
    content_capacity: execConfig.content_capacity ?? execConfig.weekly_capacity ?? (formatFreqMap && Object.keys(formatFreqMap).length > 0 ? { ...formatFreqMap } : { post: Math.max(1, parsedFreq) }),
    action_expectation: execConfig.action_expectation ?? (themeTitle ? `Learn about ${String(themeTitle).slice(0, 80)}` : 'Learn and engage'),
    topic_continuity: execConfig.topic_continuity ?? 'One ongoing story',
    platforms: execConfig.platforms ?? configuredPlatforms.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(', '),
    platform_content_requests: boltPlatformRequests.length > 0 ? boltPlatformRequests : defaultPlatformRequests,
    exclusive_campaigns: execConfig.exclusive_campaigns ?? 'No',
    key_messages: execConfig.key_messages ?? themeTitle ?? (typeof snapshot?.theme_or_description === 'string' ? snapshot.theme_or_description : 'Core value and expertise'),
    campaign_duration: durationWeeks,
    preplanning_form_completed: true,
    ...withBoltMetadata({}, { textOnly: !requiresMediaFlow && !isCombined }),
    // User-selected content formats and per-format frequency — tell AI exactly what to plan
    ...(Array.isArray(execConfig.content_formats) && (execConfig.content_formats as string[]).length > 0
      ? { preferred_content_types: execConfig.content_formats, content_formats: execConfig.content_formats }
      : {}),
    ...(execConfig.format_frequency && typeof execConfig.format_frequency === 'object'
      ? { format_frequency: execConfig.format_frequency }
      : {}),
    // Multiple campaign goals — ensure AI aligns strategy to all of them
    ...(Array.isArray(execConfig.campaign_goals) && (execConfig.campaign_goals as string[]).length > 0
      ? { campaign_goals: execConfig.campaign_goals }
      : {}),
    // ── Campaign Brief surface for the planner ──────────────────────────────
    // These three keys come from the BOLT Text "Campaign Brief" section in
    // the UI (hooks/useBoltStrategy.tsx). The planner prompt uses them to
    // answer WHY (goals), WHO (target_audience), and HOW (tone) — without
    // them the AI plan falls back to topic-only inference, which is what
    // happened pre-Brief.
    ...(typeof execConfig.campaign_description === 'string' && (execConfig.campaign_description as string).trim()
      ? { campaign_description: execConfig.campaign_description }
      : {}),
    ...(Array.isArray(execConfig.tone) && (execConfig.tone as string[]).length > 0
      ? { tone: execConfig.tone, communication_style: execConfig.communication_style ?? execConfig.tone }
      : {}),
    // brief_fields_filled stays opaque to the planner (it's diagnostic only)
    // but we surface it so it appears in [bolt/plan-input] logs alongside
    // the rest of the planning context.
    ...(execConfig.brief_fields_filled && typeof execConfig.brief_fields_filled === 'object'
      ? { brief_fields_filled: execConfig.brief_fields_filled }
      : {}),
  };

  const planMessage = `Yes, generate my ${durationWeeks}-week plan now.`;

  // Diagnostic: log what we're sending so failures are traceable. Brief
  // fields are included so we can correlate AI plan quality against which
  // optional inputs the user supplied.
  console.log('[bolt/plan-input]', JSON.stringify({
    platform_content_requests: collectedPlanningContext.platform_content_requests,
    weekly_capacity: collectedPlanningContext.weekly_capacity,
    content_capacity: collectedPlanningContext.content_capacity,
    campaign_duration: collectedPlanningContext.campaign_duration,
    brief: {
      has_description: Boolean(collectedPlanningContext.campaign_description),
      goals_count: Array.isArray(collectedPlanningContext.campaign_goals) ? (collectedPlanningContext.campaign_goals as unknown[]).length : 0,
      tone_count: Array.isArray(collectedPlanningContext.tone) ? (collectedPlanningContext.tone as unknown[]).length : 0,
      audience_present: typeof collectedPlanningContext.target_audience === 'string' && (collectedPlanningContext.target_audience as string).trim().length > 0,
      brief_fields_filled: collectedPlanningContext.brief_fields_filled ?? null,
    },
    format_frequency: collectedPlanningContext.format_frequency,
  }));

  // Single retry on ai/plan. Each attempt is bounded by AI_PLAN_TIMEOUT_MS (120s); 3 retries
  // turned a slow OpenAI call into ~8 min of wall time, blowing past the UI polling deadline
  // without measurably improving success rate.
  const result = await retryWithBackoff(
    () =>
      withTimeout(
        runCampaignAiPlan({
          campaignId,
          mode: 'generate_plan',
          message: planMessage,
          // No conversationHistory — BOLT is not conversational. Passing history triggers
          // the gather-phase Q&A loop which ignores collectedPlanningContext and returns
          // a conversational prompt instead of a plan.
          recommendationContext,
          collectedPlanningContext,
          variantMetadata: withBoltMetadata({}, { runId }).variantMetadata,
        }),
        AI_PLAN_TIMEOUT_MS,
        'ai/plan'
      ),
    { maxRetries: 1, initialDelayMs: 2000 }
  );

  // Diagnostic: log what came back so we can tell if it's a capacity block, QA block, or AI failure
  console.log('[bolt/plan-result]', JSON.stringify({
    has_plan: !!result?.plan,
    has_weeks: Array.isArray(result?.plan?.weeks),
    week_count: Array.isArray(result?.plan?.weeks) ? result.plan.weeks.length : null,
    has_conversational: !!result?.conversationalResponse,
    conversational_preview: result?.conversationalResponse
      ? String(result.conversationalResponse).slice(0, 200)
      : null,
    validation_status: (result as any)?.validation_result?.status ?? null,
    validation_deficit: (result as any)?.validation_result?.deficit ?? null,
  }));

  const plan = result?.plan;
  if (!plan || !Array.isArray(plan.weeks)) {
    throw new Error('AI plan did not return a valid plan with weeks');
  }

  // Trim to requested duration: reduce downstream work (generate-weekly-structure, scheduling)
  const trimmedWeeks = plan.weeks.slice(0, durationWeeks);
  if (trimmedWeeks.length < plan.weeks.length) {
    (plan as { weeks: unknown[] }).weeks = trimmedWeeks;
  }

  return { plan, result };
}

async function runCommitPlan(
  campaignId: string,
  plan: { weeks: unknown[] },
  executionConfig?: Record<string, unknown>,
  requiresMediaFlow?: boolean
): Promise<void> {
  const sanitizedWeeks = requiresMediaFlow ? plan.weeks : sanitizeBoltPlanForTextOnly(plan.weeks);
  const blueprint = fromStructuredPlan({ weeks: sanitizedWeeks, campaign_id: campaignId });
  // Align with strategic theme card → create campaign flow: saveStructuredCampaignPlan + commitDraftBlueprint
  const snapshotHash = `bolt-${campaignId}-${Date.now()}`;
  await saveStructuredCampaignPlan({
    campaignId,
    snapshot_hash: snapshotHash,
    weeks: sanitizedWeeks as any,
    omnivyre_decision: { status: 'ok', recommendation: 'proceed' } as any,
    raw_plan_text: '',
  });
  await commitDraftBlueprint({
    campaignId,
    blueprint,
    source: 'bolt-ai-commit-plan',
  });
  const durationWeeks = Math.max(1, blueprint.duration_weeks ?? plan.weeks.length ?? 1);
  const tentativeStart = executionConfig?.tentative_start as string | undefined;
  const startDateValue =
    tentativeStart && String(tentativeStart).trim()
      ? String(tentativeStart).includes('T')
        ? String(tentativeStart)
        : `${String(tentativeStart).trim()}T00:00:00.000Z`
      : undefined;

  const { data: existing } = await ownedDbTable('campaigns')
    .select('start_date')
    .eq('id', campaignId)
    .maybeSingle();
  const hasStartDate = !!(
    (existing as { start_date?: string } | null)?.start_date &&
    String((existing as { start_date: string }).start_date).trim()
  );

  // Keep campaign in 'draft' during BOLT execution. The pipeline sets it to 'active' on success.
  // Previously used 'active' here which caused the dashboard to show "scheduled" even when the
  // pipeline had not yet completed (or failed shortly after).
  const updates: Record<string, unknown> = {
    status: 'draft',
    current_stage: 'blueprint_committed',
    blueprint_status: 'ACTIVE',
    duration_weeks: durationWeeks,
    updated_at: new Date().toISOString(),
  };
  if (!hasStartDate && startDateValue) {
    updates.start_date = startDateValue;
  }

  await ownedDbTable('campaigns').update(updates).eq('id', campaignId);
}

const BATCH_WEEK_SIZE = 4;

async function runGenerateWeeklyStructure(
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

    const data = await retryWithBackoff(
      () =>
        withTimeout(
          callService(),
          GENERATE_WEEKLY_TIMEOUT_MS * Math.max(1, batchWeeks.length / 2),
          `generate-weekly-structure weeks ${batchWeeks.join(',')}`
        ),
      { maxRetries: 3, initialDelayMs: 1000 }
    );

    const count = Array.isArray(data?.dailyPlan) ? data.dailyPlan.length : 0;
    dailySlotsCreated += count;

    for (const wn of batchWeeks) {
      await logEvent(runId, `generate-weekly-structure-week-${wn}`, 'completed', {
        week: wn,
        dailySlots: Math.floor(count / batchWeeks.length),
      });
    }

    completedWeeksSoFar = [...completedWeeksSoFar, ...batchWeeks];
  }

  return { weeksGenerated: numWeeks, dailySlotsCreated };
}

async function runScheduleStructuredPlan(
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

const STAGES: BoltStage[] = [
  'source-recommendation',
  'ai/plan',
  'commit-plan',
  'generate-weekly-structure',
  'creator-asset-generation',
  'schedule-structured-plan',
];

function validateExecutionConfig(execConfig: Record<string, unknown> | undefined): string[] {
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
    if (!Number.isInteger(d) || d < 1 || d > 4) {
      missing.push('campaign_duration_invalid'); // BOLT allows 1–4 weeks only
    }
  }

  return missing;
}

async function executeBoltPipelineRuntime(runId: string): Promise<void> {
  // Wall-clock anchor for `failed_after_ms`. Captured before any DB work so
  // even pre-validation failures get a meaningful elapsed-time stamp.
  const runStartedAt = Date.now();

  const { data: run, error: fetchError } = await ownedDbTable('bolt_execution_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle();

  if (fetchError || !run) {
    throw new Error(`BOLT run not found: ${runId}`);
  }

  const status = (run as { status?: string }).status;
  // Terminal states never re-enter. Note: 'running' is NO LONGER a
  // bail-out condition — we use the lock for liveness instead, so a
  // crashed worker that left status='running' but lapsed its lock can
  // be recovered by the next attempt.
  if (status === 'failed' || status === 'completed' || status === 'cancelled') {
    return;
  }

  // ── Atomic lock claim with stale-lock recovery ─────────────────────
  // Replaces the prior `status === 'running'` soft guard. The previous
  // guard had no expiry, so a crashed worker permanently locked the run.
  // acquireRunLock atomically claims when nobody holds a non-expired
  // lock, generates a token we present on every subsequent extend /
  // release, and refreshes heartbeat at the same time.
  const lock = await acquireRunLock(runId, DEFAULT_LOCK_TTL_MS);
  if (!lock) {
    // A live worker already holds a valid lock. Back off silently —
    // this is the normal "BullMQ also fired the same job" case.
    return;
  }

  // Set status='running' AFTER claiming the lock so observers see the
  // running state only when there's a live worker to back it.
  await updateRun(runId, { status: 'running' });

  const payload = run.payload as BoltPayload;
  const { companyId, outcomeView } = payload;
  // Stamped on every failure persistence so dashboards can filter
  // "show me all bolt-text schedule-view failures from this week".
  const pipelineMode: BoltPipelineMode = (outcomeView ?? 'week_plan') as BoltPipelineMode;
  const campaignType: BoltCampaignType = deriveBoltCampaignType(payload.executionConfig);
  const executionProfile = getExecutionProfile(payload.executionConfig);
  if (executionProfile === 'creator') {
    const formats = getCreatorFormatsFromExecutionConfig(payload.executionConfig);
    const unsupportedFormats = getUnsupportedCreatorFormats(formats);
    if (unsupportedFormats.length > 0) {
      const err = new Error(`Unsupported creator format: ${unsupportedFormats.join(', ')}`);
      await persistPipelineFailure({
        runId, stage: 'pre-validate-creator-format', error: err,
        runStartedAt, pipelineMode, campaignType,
      });
      // Release the lock so a fast-failing validation doesn't hold the
      // row in "running with valid lock" for the full TTL.
      await releaseRunLock(runId, lock.token);
      throw err;
    }
    const scheduleValidation = validateCreatorScheduleRequest({
      campaignMode: 'creator',
      outcomeView,
      executionConfig: payload.executionConfig,
    });
    if (scheduleValidation.ok === false) {
      const err = new Error(scheduleValidation.message);
      await persistPipelineFailure({
        runId, stage: 'pre-validate-creator-schedule', error: err,
        runStartedAt, pipelineMode, campaignType,
      });
      await releaseRunLock(runId, lock.token);
      throw err;
    }
  }
  const usesUnifiedMediaFlow = executionProfile === 'creator';
  const usesLegacyMediaFlow = isLegacyMediaProfile(executionProfile);
  const requiresMediaFlow = usesUnifiedMediaFlow || usesLegacyMediaFlow;
  // Combined mode: text + creator formats together. Scheduling applies to the text portion only.
  const isCombined = executionProfile === 'combined';
  const creatorFormats = usesUnifiedMediaFlow
    ? getCreatorFormatsFromExecutionConfig(payload.executionConfig)
    : [];
  // ── Per-row eligibility (replaces the old campaign-wide veto) ─────────────
  // We classify EACH format independently. Autonomous formats render and
  // schedule on their own. Attachment-required formats produce a theme
  // treatment + creator guidance and wait in `awaiting_media_upload` for a
  // user-uploaded media URL — they no longer poison the rest of the campaign.
  // The previous code collapsed Row[] → boolean (`hasGuidanceOnlyCreatorFormats`)
  // and used that to downgrade the whole campaign to RENDER_ONLY; that
  // category error is removed here.
  const rowEligibility = creatorFormats.map((format) => ({
    format,
    is_autonomous: isAutonomousRenderableFormat(format),
    is_attachment_required: isAttachmentRequiredFormat(format),
  }));
  const hasAutonomousCreatorFormats = rowEligibility.some((row) => row.is_autonomous);
  const hasAttachmentRequiredCreatorFormats = rowEligibility.some((row) => row.is_attachment_required);
  const creatorCampaignAggregate: CreatorCampaignAggregate = usesUnifiedMediaFlow
    ? getCreatorCampaignAggregate(creatorFormats)
    : 'empty';
  const wantsSchedule = outcomeView === 'schedule' || outcomeView === 'campaign_schedule';

  // The generation runtime mode is purely a HINT to the runtime about what
  // mix to expect; it no longer gates anything. The runtime evaluates each
  // row independently and decides render vs. theme-treatment per row.
  const creatorExecutionMode: CreatorAssetGenerationMode | null = usesUnifiedMediaFlow
    ? (hasAutonomousCreatorFormats && hasAttachmentRequiredCreatorFormats)
      ? 'MIXED'
      : hasAutonomousCreatorFormats
        ? (wantsSchedule ? 'SCHEDULE_AND_RENDER' : 'RENDER_ONLY')
        : hasAttachmentRequiredCreatorFormats
          ? 'ATTACHMENT_ONLY'
          : 'RENDER_ONLY'
    : null;

  // Run the creator asset generation stage whenever there's at least one
  // creator format and the user wanted more than a week plan. The stage
  // itself decides per row whether to render or emit awaiting_media_upload.
  const shouldRunCreatorAssetGeneration =
    usesUnifiedMediaFlow &&
    outcomeView !== 'week_plan' &&
    creatorFormats.length > 0;

  // shouldSchedule fires when the user asked to schedule AND there is at
  // least one row that can be scheduled NOW. Autonomous rows count as
  // schedulable; attachment-required rows do not block scheduling — they
  // simply stay in `awaiting_media_upload` until the user uploads media.
  const shouldSchedule = wantsSchedule && (
    (usesUnifiedMediaFlow && hasAutonomousCreatorFormats) ||
    (!requiresMediaFlow)
  );
  const isWeekPlanOnly = outcomeView === 'week_plan';

  const missing = validateExecutionConfig(payload.executionConfig);
  if (missing.length > 0) {
    const invalidDuration = missing.includes('campaign_duration_invalid');
    const filtered = missing.filter((m) => m !== 'campaign_duration_invalid');
    const msg = invalidDuration
      ? `BOLT execution blocked. Campaign duration must be 1–4 weeks.${filtered.length > 0 ? ` Missing: ${filtered.join(', ')}` : ''}`
      : `BOLT execution blocked. Missing execution inputs: ${missing.join(', ')}`;
    const err = new Error(msg);
    await persistPipelineFailure({
      runId, stage: 'validate-execution-config', error: err,
      runStartedAt, pipelineMode, campaignType,
    });
    await releaseRunLock(runId, lock.token);
    throw err;
  }

  let eligiblePlatforms: string[] = [];
  try {
    // Use the same "connected at company admin level" source the BOLT picker
    // endpoint uses (social_accounts, with profile-URL fallback). Both must
    // agree, otherwise selected_platforms gets intersected to a smaller set
    // than the user saw in the picker and platforms silently disappear.
    const profile = await getProfile(companyId, { autoRefine: false, languageRefine: false }).catch(() => null);
    const rawPlatforms = await getConnectedPlatformsForCompany(companyId, profile);
    // Creator and Combined campaigns include all platforms (multi-capability).
    // Text-only BOLT routes through the canonical capability filter so any
    // non-text-capable platform (Instagram/Pinterest/TikTok/YouTube) is
    // excluded by the same rules as the publish validator and UI picker.
    eligiblePlatforms = (requiresMediaFlow || isCombined)
      ? rawPlatforms
      : filterConnectedPlatformsForContent(rawPlatforms, { workflowType: 'text' }).supported;

    // Honor execConfig.selected_platforms (per-campaign platform picker from the
    // BOLT Text strategy builder). Intersect with eligiblePlatforms so the user
    // can narrow scope but never target unconfigured platforms.
    const rawSelected = (payload.executionConfig as Record<string, unknown> | undefined)?.selected_platforms;
    const selectedList = Array.isArray(rawSelected)
      ? rawSelected
          .map((p) => String(p ?? '').trim().toLowerCase().replace(/^twitter$/i, 'x'))
          .filter(Boolean)
      : [];
    if (selectedList.length > 0 && eligiblePlatforms.length > 0) {
      const narrowed = eligiblePlatforms.filter((p) => selectedList.includes(p.toLowerCase()));
      if (narrowed.length > 0) eligiblePlatforms = narrowed;
    }
    console.log('[bolt] eligiblePlatforms resolved', {
      companyId,
      connected: rawPlatforms,
      selected_platforms: selectedList,
      eligible: eligiblePlatforms,
    });
  } catch (err) {
    console.error('[bolt] Failed to resolve eligible platforms', err);
    eligiblePlatforms = [];
  }

  const totalStages = isWeekPlanOnly
    ? 3  // source-recommendation, ai/plan, commit-plan — stops at blueprint
    : shouldSchedule
      ? STAGES.length
      : shouldRunCreatorAssetGeneration
        ? STAGES.length - 1
        : STAGES.length - 2;
  // Platforms required for scheduling; generate-weekly-structure falls back to linkedin if none configured
  const needsPlatformsForContent = shouldSchedule;
  if (needsPlatformsForContent && eligiblePlatforms.length === 0) {
    const msg =
      'No social platforms configured for this company. Add platform URLs (LinkedIn, Instagram, X, etc.) in the company profile before generating or scheduling content.';
    const err = new Error(msg);
    await persistPipelineFailure({
      runId, stage: 'validate-platforms', error: err,
      runStartedAt, pipelineMode, campaignType,
    });
    await releaseRunLock(runId, lock.token);
    throw err;
  }

  let campaignId: string | null = null;
  let plan: { weeks: unknown[] } | null = null;
  let weeksGenerated = 0;
  let dailySlotsCreated = 0;
  let scheduledPostsCreated = 0;
  let creatorAssetGenerationResult: CreatorAssetGenerationResult | null = null;

  const getProgress = (stageIndex: number) => Math.round((stageIndex / totalStages) * 100);

  try {
    for (let i = 0; i < STAGES.length; i++) {
      const stage = STAGES[i];
      if (stage === 'creator-asset-generation' && !shouldRunCreatorAssetGeneration) continue;
      if (stage === 'schedule-structured-plan' && !shouldSchedule) continue;
      // Note: generate-weekly-structure now runs even for week_plan so that
      // daily_content_plans rows (activity cards) are created and visible
      // on the campaign detail page.

      // ── Cancellation checkpoint ────────────────────────────────────
      // Polled between stages, NOT mid-stage. Mid-stage cancellation
      // would risk leaving daily_content_plans / scheduled_posts in
      // partial state — between-stage gives us a clean boundary.
      // The campaign's already-completed stages are preserved; we
      // mark remaining stages as skipped on the way out.
      const { data: cancelCheck } = await ownedDbTable('bolt_execution_runs')
        .select('cancel_requested')
        .eq('id', runId)
        .maybeSingle();
      if ((cancelCheck as { cancel_requested?: boolean } | null)?.cancel_requested) {
        await updateRun(runId, {
          status: 'cancelled',
          error_message: 'Cancelled by user',
        });
        await logEvent(runId, stage, 'cancelled', { campaign_id: campaignId ?? undefined });
        await releaseRunLock(runId, lock.token);
        return;
      }

      // ── Lock extension ──────────────────────────────────────────────
      // Push the lock expiry forward at the start of every stage so a
      // long AI plan call (up to 120s × retries) can't let the lock
      // lapse mid-stage and invite a second worker. Token-checked, so
      // if our lock has already been stolen by stale-recovery we hit
      // the failure path with a clean message.
      const lockStillOurs = await extendRunLock(runId, lock.token, DEFAULT_LOCK_TTL_MS);
      if (!lockStillOurs) {
        // Another worker took over via stale-lock recovery. Bail
        // silently — the other worker is the source of truth now.
        return;
      }

      if (campaignId) {
        try {
          await assertCampaignValid(campaignId);
        } catch (guardErr) {
          // Aborted path (campaign was deleted mid-run, etc.) — still
          // capture raw cause so operators can tell why the run gave up.
          // We re-set status='aborted' AFTER persistPipelineFailure to
          // preserve the "aborted vs failed" distinction the UI relies on.
          await persistPipelineFailure({
            runId, stage, error: guardErr,
            runStartedAt, pipelineMode, campaignType, campaignId,
          });
          await updateRun(runId, { status: 'aborted' });
          return;
        }
      }

      const stageToCheck = stage === 'generate-weekly-structure' ? null : stage;
      if (stageToCheck && (await checkStageCompleted(runId, stageToCheck))) {
        if (stage === 'source-recommendation') {
          const { data: runRow } = await ownedDbTable('bolt_execution_runs')
            .select('campaign_id')
            .eq('id', runId)
            .maybeSingle();
          const cid = (runRow as { campaign_id?: string } | null)?.campaign_id;
          if (cid) campaignId = cid;
        } else if (stage === 'ai/plan' && campaignId) {
          const cached = await getCompletedStagePlan(runId, stage);
          if (cached) plan = cached;
        }
        continue;
      }

      const isGenerateWeekly = stage === 'generate-weekly-structure';
      const stageStart = Date.now();
      // Always update current_stage so the progress bar reflects the real-time stage.
      // generate-weekly-structure also needs this so the UI doesn't get stuck on the previous stage.
      await updateRun(runId, {
        current_stage: stage,
        status: 'running',
        progress_percentage: getProgress(i),
      });
      if (!isGenerateWeekly) {
        await logEvent(runId, stage, 'started', {
          campaign_id: campaignId ?? undefined,
        });
      }

      try {
        if (stage === 'source-recommendation') {
          if (payload.generatedCampaignId) {
            await assertCampaignValid(payload.generatedCampaignId);
          }
          campaignId = await runSourceRecommendation(runId, payload);
          await updateRun(runId, { campaign_id: campaignId, progress_percentage: getProgress(i + 1) });
          await logEvent(runId, stage, 'completed', {
            campaign_id: campaignId,
            duration_ms: Date.now() - stageStart,
          });
        } else if (stage === 'ai/plan' && campaignId) {
          const aiResult = await runAiPlan(runId, campaignId, companyId, payload, eligiblePlatforms, requiresMediaFlow, isCombined);
          plan = aiResult.plan;
          await logEvent(runId, stage, 'completed', {
            campaign_id: campaignId,
            duration_ms: Date.now() - stageStart,
            weeksCount: plan.weeks.length,
            plan: { weeks: plan.weeks },
          });
        } else if (stage === 'commit-plan' && campaignId && plan) {
          await runCommitPlan(campaignId, plan, payload.executionConfig as Record<string, unknown>, requiresMediaFlow);
          await logEvent(runId, stage, 'completed', {
            campaign_id: campaignId,
            duration_ms: Date.now() - stageStart,
          });
        } else if (stage === 'generate-weekly-structure' && campaignId && plan) {
          const theme = payload.sourceStrategicTheme as Record<string, unknown> | undefined;
          const execConfig = payload.executionConfig as Record<string, unknown> | undefined;
          const tentativeStart = execConfig?.tentative_start as string | undefined;
          const campaignStartDate =
            tentativeStart && String(tentativeStart).trim()
              ? String(tentativeStart).includes('T')
                ? String(tentativeStart)
                : `${String(tentativeStart).trim()}T00:00:00.000Z`
              : undefined;

          const momentumLevel = momentumScoreToLevel(theme?.momentum_score as number | undefined);
          const pressureLevel = pressureConfigToLevel(execConfig?.pressure as string | undefined);

          let postsPerWeek: number;
          const rawFreq = execConfig?.frequency_per_week;
          let parsedFreq: number | null = null;
          if (typeof rawFreq === 'number' && rawFreq > 0 && isFinite(rawFreq)) {
            parsedFreq = Math.round(rawFreq);
          } else if (typeof rawFreq === 'string') {
            const s = rawFreq.trim().toLowerCase();
            const p = s === 'daily' ? 7 : parseInt(rawFreq, 10);
            if (!isNaN(p) && p > 0) parsedFreq = p;
          }
          if (parsedFreq !== null) {
            postsPerWeek = parsedFreq;
          } else {
            postsPerWeek = determinePostsPerWeek({
              campaignDurationWeeks: plan.weeks.length,
              momentumLevel,
              pressureLevel,
            });
          }
          postsPerWeek = Math.min(Math.max(postsPerWeek, 1), 20);
          const summary = await runGenerateWeeklyStructure(
            runId,
            campaignId,
            companyId,
            plan.weeks,
            (u) => updateRun(runId, u),
            (rid, s, st, m) => logEvent(rid, s, st, m),
            {
              eligiblePlatforms: eligiblePlatforms.length > 0 ? eligiblePlatforms : undefined,
              postsPerWeek,
              campaignStartDate,
              boltTextOnly: !requiresMediaFlow && !isCombined,
              execConfig: execConfig ?? undefined,
            }
          );
          weeksGenerated = plan.weeks.length;
          dailySlotsCreated = summary.dailySlotsCreated;
        } else if (stage === 'creator-asset-generation' && campaignId) {
          creatorAssetGenerationResult = await runCreatorAssetGenerationRuntime({
            campaignId,
            companyId,
            userId: payload.userId ?? null,
            mode: creatorExecutionMode ?? 'RENDER_ONLY',
            onProgress: (progressStage) => updateRun(runId, { current_stage: progressStage }),
          });
          await logEvent(runId, stage, 'completed', {
            campaign_id: campaignId,
            duration_ms: Date.now() - stageStart,
            mode: creatorAssetGenerationResult.mode,
            rendered_count: creatorAssetGenerationResult.rendered_count,
            guidance_ready_count: creatorAssetGenerationResult.guidance_ready_count,
            skipped_count: creatorAssetGenerationResult.skipped_count,
            failed_count: creatorAssetGenerationResult.failed_count,
            final_status: creatorAssetGenerationResult.final_status,
          });
        } else if (stage === 'schedule-structured-plan' && campaignId && plan) {
          const scheduleResult = await runScheduleStructuredPlan(
            campaignId,
            plan,
            payload.executionConfig,
            executionProfile,
            (s) => updateRun(runId, { current_stage: s }),
            eligiblePlatforms.length > 0 ? eligiblePlatforms : undefined,
            runId
          );
          scheduledPostsCreated = scheduleResult.scheduled_count;
          await logEvent(runId, stage, 'completed', {
            campaign_id: campaignId,
            duration_ms: Date.now() - stageStart,
            scheduled_count: scheduleResult.scheduled_count,
          });
        }
      } catch (stageErr) {
        // Single instrumentation entry: writes raw + friendly to the run,
        // emits the standardized `[bolt/pipeline-error]` log line, and
        // inserts a `failed` event with raw fields in metadata. Never
        // throws — we still re-raise the ORIGINAL stageErr below so
        // upper-level handling stays identical.
        await persistPipelineFailure({
          runId,
          stage,
          error: stageErr,
          runStartedAt,
          stageStartedAt: stageStart,
          pipelineMode,
          campaignType,
          campaignId,
        });
        throw stageErr;
      }
    }

    const planWeeksCount = plan?.weeks?.length ?? 0;
    let aiMetrics: Partial<{
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
    }> = {};
    try {
      const metrics = await aggregateBoltAiMetrics(runId);
      aiMetrics = {
        ai_calls_total: metrics.ai_calls_total,
        ai_tokens_input: metrics.ai_tokens_input,
        ai_tokens_output: metrics.ai_tokens_output,
        distribution_batches: metrics.distribution_batches,
        variant_batches: metrics.variant_batches,
        ai_cost_usd: metrics.ai_cost_usd,
        stage_campaign_plan_cost: metrics.stage_campaign_plan_cost,
        stage_distribution_cost: metrics.stage_distribution_cost,
        stage_blueprint_cost: metrics.stage_blueprint_cost,
        stage_variant_cost: metrics.stage_variant_cost,
      };
      const cacheMetrics = getBlueprintCacheMetrics();
      aiMetrics.blueprint_cache_hits = cacheMetrics.blueprint_cache_hits;
      aiMetrics.blueprint_cache_misses = cacheMetrics.blueprint_cache_misses;
      aiMetrics.cache_hit_ratio = cacheMetrics.cache_hit_ratio;
    } catch (metricsErr) {
      console.warn('[bolt] AI metrics aggregation failed:', (metricsErr as Error)?.message);
    }
    // Mark campaign active now that the pipeline completed successfully.
    // Set current_stage to match the actual outcome so the dashboard reflects the right state.
    if (campaignId) {
      const outcomeStageMap: Record<string, string> = {
        week_plan: 'week_plan',
        daily_plan: 'daily_plan',
        schedule: 'schedule',
        campaign_schedule: 'schedule',
      };
      const finalStage = creatorAssetGenerationResult?.final_status
        ?? outcomeStageMap[String(payload.outcomeView ?? '')]
        ?? 'week_plan';
      await ownedDbTable('campaigns')
        .update({ status: 'active', current_stage: finalStage, updated_at: new Date().toISOString() })
        .eq('id', campaignId);
    }
    await updateRun(runId, {
      status: 'completed',
      progress_percentage: 100,
      result_campaign_id: campaignId ?? undefined,
      error_message: null,
      weeks_generated: weeksGenerated,
      daily_slots_created: dailySlotsCreated,
      scheduled_posts_created: scheduledPostsCreated,
      themes_generated: 1,
      weekly_plan_items: planWeeksCount,
      content_variants_generated: creatorAssetGenerationResult
        ? creatorAssetGenerationResult.rendered_count + creatorAssetGenerationResult.guidance_ready_count
        : dailySlotsCreated,
      expected_content_items: dailySlotsCreated,
      actual_posts_published: scheduledPostsCreated,
      ...aiMetrics,
    });

    // Success path — release the lock so the row's lock columns
    // reflect "no live worker holds this" and downstream operators
    // know the run is fully terminal.
    await releaseRunLock(runId, lock.token);
  } catch (err) {
    // Outer pipeline safety net. A per-stage catch usually fires first and
    // has already populated the run row, but we ALSO instrument here so any
    // throw outside a stage (post-loop metrics aggregation, campaign-status
    // update, the final updateRun, …) still leaves an operator-queryable
    // record. persistPipelineFailure is safe to call twice — the run row
    // ends up reflecting the last writer, and a second event row makes the
    // double-write visible.
    await persistPipelineFailure({
      runId,
      stage: 'pipeline-outer',
      error: err,
      runStartedAt,
      pipelineMode,
      campaignType,
      campaignId,
    });
    // Release lock on failure too — keeps stale-lock rows out of the
    // sweeper's queue. Token-checked, so if our lock was already
    // recovered by a successor this is a no-op.
    await releaseRunLock(runId, lock.token);
    throw err;
  }
}

export { executeBoltPipelineRuntime as executeBoltPipeline };

/**
 * Planner-only: runs generate-weekly-structure (same service as BOLT pipeline stage).
 * Blueprint must already be committed via campaignPlanStore before calling.
 * Does not update campaign status (planner-finalize sets execution_ready, blueprint_status committed).
 */
export async function runPlannerCommitAndGenerateWeekly(params: {
  campaignId: string;
  companyId: string;
  plan: { weeks: unknown[] };
  startDate?: string;
}): Promise<void> {
  const blueprint = fromStructuredPlan({ weeks: params.plan.weeks, campaign_id: params.campaignId });
  const durationWeeks = Math.max(1, blueprint.duration_weeks ?? params.plan.weeks.length ?? 1);
  const weekNumbers = (params.plan.weeks as Array<{ week_number?: number; week?: number }>).map(
    (w, i) => Number(w?.week_number ?? w?.week ?? i + 1)
  );
  if (params.startDate) {
    const startVal = String(params.startDate).trim();
    const startDateValue = startVal.includes('T') ? startVal : `${startVal}T00:00:00.000Z`;
    await ownedDbTable('campaigns').update({
      start_date: startDateValue,
      duration_weeks: durationWeeks,
      updated_at: new Date().toISOString(),
    }).eq('id', params.campaignId);
  }
  await generateWeeklyStructure({
    campaignId: params.campaignId,
    companyId: params.companyId,
    weeks: weekNumbers,
  });
}

// `unwrapErrorForLog` was the previous instrumentation helper. It has been
// superseded by `normalizePipelineError` + `persistPipelineFailure`, which
// also persist the raw failure to bolt_execution_runs (raw_error_message,
// error_stack, failed_stage, failed_after_ms, pipeline_mode, campaign_type).
// See `backend/services/boltPipelineFailurePersistence.ts`.
