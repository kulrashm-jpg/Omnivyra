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
import { getAvailablePlatformsFromProfile } from '../utils/platformEligibility';
import { filterBoltPlatforms, sanitizeBoltPlanForTextOnly } from '../utils/boltTextContentConfig';
import { aggregateBoltAiMetrics } from './boltMetricsAggregator';
import { getBlueprintCacheMetrics } from './contentBlueprintCache';
import { getAdaptiveDistributionAdjustments } from './campaignAdaptiveOptimizer';
import {
  determinePostsPerWeek,
  momentumScoreToLevel,
  pressureConfigToLevel,
} from './postDensityEngine';
import { generateWeeklyStructure } from './generateWeeklyStructureService';

const AI_PLAN_TIMEOUT_MS = 120_000;
const GENERATE_WEEKLY_TIMEOUT_MS = 90_000;

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
  const { error } = await supabase
    .from('bolt_execution_runs')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
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
  const { error } = await supabase.from('bolt_execution_events').insert({
    run_id: runId,
    stage,
    status,
    metadata: metadata ?? {},
  });
  if (error) console.warn('[bolt] Event log failed:', error.message);
}

async function checkStageCompleted(runId: string, stage: string): Promise<boolean> {
  const { data } = await supabase
    .from('bolt_execution_events')
    .select('id')
    .eq('run_id', runId)
    .eq('stage', stage)
    .eq('status', 'completed')
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function getCompletedStagePlan(runId: string, stage: string): Promise<{ weeks: unknown[] } | null> {
  const { data } = await supabase
    .from('bolt_execution_events')
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
  const { data, error } = await supabase
    .from('campaigns')
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

  let campaignId: string;

  if (generatedCampaignId) {
    campaignId = generatedCampaignId;

    const { data: latestVersion, error: fetchError } = await supabase
      .from('campaign_versions')
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

    const { error: updateError } = await supabase
      .from('campaign_versions')
      .update({ campaign_snapshot: updatedSnapshot })
      .eq('id', (latestVersion as { id: string }).id);

    if (updateError) throw new Error(`Source-recommendation update failed: ${updateError.message}`);

    const theme = sourceStrategicTheme as { polished_title?: string; topic?: string; title?: string };
    const themeName = [theme?.polished_title, theme?.topic, theme?.title]
      .map((t) => (typeof t === 'string' ? t.trim() : ''))
      .find(Boolean);
    const updates: Record<string, unknown> = {};
    if (themeName) updates.name = themeName;
    const tentativeStart = executionConfig.tentative_start as string | undefined;
    if (tentativeStart) {
      updates.start_date = tentativeStart.includes('T') ? tentativeStart : `${tentativeStart}T00:00:00.000Z`;
    }
    if (Object.keys(updates).length > 0) {
      await supabase.from('campaigns').update(updates).eq('id', campaignId);
    }
  } else {
    const newCampaignId = crypto.randomUUID();
    const tentativeStart = executionConfig.tentative_start as string | undefined;
    const startDate = tentativeStart ? (tentativeStart.includes('T') ? tentativeStart : `${tentativeStart}T00:00:00.000Z`) : null;
    const { error: campaignError } = await supabase.from('campaigns').insert({
      id: newCampaignId,
      name: title || 'Campaign from themes',
      description: description ?? null,
      user_id: userId ?? null,
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

    const { error: versionError } = await supabase.from('campaign_versions').insert({
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

async function runAiPlan(runId: string, campaignId: string, companyId: string, payload: BoltPayload, eligiblePlatforms?: string[]): Promise<{ plan: { weeks: unknown[] }; result: Awaited<ReturnType<typeof runCampaignAiPlan>> }> {
  const snapshot = payload.sourceStrategicTheme as Record<string, unknown>;
  const basePayload = (snapshot?.context_payload && typeof snapshot.context_payload === 'object')
    ? { ...snapshot.context_payload }
    : {};
  const mergedPayload =
    payload.sourceStrategicTheme && typeof payload.sourceStrategicTheme === 'object'
      ? { ...basePayload, ...payload.sourceStrategicTheme }
      : basePayload;

  const topicFromCard =
    typeof snapshot?.polished_title === 'string' && (snapshot.polished_title as string).trim()
      ? (snapshot.polished_title as string).trim()
      : typeof snapshot?.topic === 'string' && (snapshot.topic as string).trim()
        ? (snapshot.topic as string).trim()
        : typeof snapshot?.title === 'string' && (snapshot.title as string).trim()
          ? (snapshot.title as string).trim()
          : null;

  const recommendationContext = {
    target_regions: payload.regionsFromCard ?? null,
    context_payload: Object.keys(mergedPayload).length > 0 ? mergedPayload : null,
    source_opportunity_id: payload.sourceOpportunityId ?? null,
    ...(topicFromCard ? { topic_from_card: topicFromCard } : {}),
  };

  const execConfig = (payload.executionConfig ?? {}) as Record<string, unknown>;
  const themeTitle = typeof snapshot?.polished_title === 'string' ? snapshot.polished_title : typeof snapshot?.topic === 'string' ? snapshot.topic : typeof snapshot?.title === 'string' ? snapshot.title : null;

  // Build collectedPlanningContext: executionConfig from Trend page first, then theme, then defaults for QA keys only
  const parsedFreq =
    typeof execConfig.frequency_per_week === 'string'
      ? parseInt(String(execConfig.frequency_per_week).replace(/\D/g, '') || '5', 10) || 5
      : typeof execConfig.frequency_per_week === 'number'
        ? execConfig.frequency_per_week
        : 5;

  // Build default platform requests from the company's configured platforms (eligiblePlatforms).
  // Fall back to LinkedIn only if none are configured.
  // Use user-configured content type prefs per platform when available.
  const configuredPlatforms = eligiblePlatforms && eligiblePlatforms.length > 0
    ? eligiblePlatforms
    : ['linkedin'];

  let platformContentPrefs: Record<string, string[]> = {};
  try {
    const { data } = await supabase
      .from('company_profiles')
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
      // Pick the first text-compatible content type (skip video/reel for BOLT)
      const textSafe = prefs.find((t) => !['video', 'reel', 'short'].includes(t.toLowerCase()));
      return textSafe ?? prefs[0];
    }
    return 'post';
  };

  const defaultPlatformRequests = configuredPlatforms.map((p, idx) => ({
    platform: p,
    content_type: getPrimaryContentType(p),
    count_per_week: Math.max(1, idx === 0 ? Math.ceil(parsedFreq * 0.6) : Math.floor(parsedFreq * 0.4 / Math.max(1, configuredPlatforms.length - 1))),
  }));
  const rawPlatformRequests = (execConfig.platform_content_requests ?? defaultPlatformRequests) as Array<{ platform?: string; content_type?: string; count_per_week?: number }>;
  const boltPlatformRequests = rawPlatformRequests
    .filter((r) => r && r.platform && !['youtube', 'tiktok'].includes(String(r.platform).toLowerCase()))
    .map((r) => ({
      platform: r.platform,
      content_type: ['video', 'reel', 'carousel', 'slider', 'image', 'banner'].includes(String(r.content_type ?? '').toLowerCase())
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
    available_content: execConfig.available_content ?? 'No',
    weekly_capacity: execConfig.weekly_capacity ?? execConfig.content_capacity ?? { post: Math.max(1, parsedFreq) },
    content_capacity: execConfig.content_capacity ?? execConfig.weekly_capacity ?? { post: Math.max(1, parsedFreq) },
    action_expectation: execConfig.action_expectation ?? (themeTitle ? `Learn about ${String(themeTitle).slice(0, 80)}` : 'Learn and engage'),
    topic_continuity: execConfig.topic_continuity ?? 'One ongoing story',
    platforms: execConfig.platforms ?? configuredPlatforms.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(', '),
    platform_content_requests: boltPlatformRequests.length > 0 ? boltPlatformRequests : defaultPlatformRequests,
    exclusive_campaigns: execConfig.exclusive_campaigns ?? 'No',
    key_messages: execConfig.key_messages ?? themeTitle ?? (typeof snapshot?.theme_or_description === 'string' ? snapshot.theme_or_description : 'Core value and expertise'),
    campaign_duration: durationWeeks,
    preplanning_form_completed: true,
    bolt_text_only: true,
  };

  const planMessage = `Yes, generate my ${durationWeeks}-week plan now.`;
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
          bolt_run_id: runId,
        }),
        AI_PLAN_TIMEOUT_MS,
        'ai/plan'
      ),
    { maxRetries: 3, initialDelayMs: 2000 }
  );

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
  executionConfig?: Record<string, unknown>
): Promise<void> {
  const sanitizedWeeks = sanitizeBoltPlanForTextOnly(plan.weeks);
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

  const { data: existing } = await supabase
    .from('campaigns')
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

  await supabase.from('campaigns').update(updates).eq('id', campaignId);
}

const BATCH_WEEK_SIZE = 4;

async function runGenerateWeeklyStructure(
  runId: string,
  campaignId: string,
  companyId: string,
  planWeeks: unknown[],
  updateRun: (updates: Partial<{ current_stage: string; status: string; progress_percentage: number; weeks_generated: number; daily_slots_created: number }>) => Promise<void>,
  logEvent: (runId: string, stage: string, status: string, metadata?: Record<string, unknown>) => Promise<void>,
  options?: { eligiblePlatforms?: string[]; postsPerWeek?: number; campaignStartDate?: string; boltTextOnly?: boolean }
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
        const { data: ev } = await supabase
          .from('bolt_execution_events')
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

          const callService = () =>
      generateWeeklyStructure({
        campaignId,
        companyId,
        weeks: batchWeeks,
        bolt_run_id: runId,
        eligible_platforms: options?.eligiblePlatforms,
        bolt_text_only: options?.boltTextOnly ?? true,
        ...(options?.postsPerWeek != null ? { posts_per_week: options.postsPerWeek } : {}),
        ...(options?.campaignStartDate ? { campaign_start_date: options.campaignStartDate } : {}),
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
  onProgress?: (stage: string) => void
): Promise<{ scheduled_count: number }> {
  const tentativeStart = executionConfig.tentative_start as string | undefined;
  if (tentativeStart) {
    const startDate = tentativeStart.includes('T') ? tentativeStart : `${tentativeStart}T00:00:00.000Z`;
    await supabase.from('campaigns').update({ start_date: startDate }).eq('id', campaignId);
  }
  const result = await scheduleStructuredPlan(
    { weeks: plan.weeks } as Parameters<typeof scheduleStructuredPlan>[0],
    campaignId,
    { generateContent: true, onProgress }
  );
  await supabase
    .from('campaigns')
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

export async function executeBoltPipeline(runId: string): Promise<void> {
  const { data: run, error: fetchError } = await supabase
    .from('bolt_execution_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle();

  if (fetchError || !run) {
    throw new Error(`BOLT run not found: ${runId}`);
  }

  const status = (run as { status?: string }).status;
  if (status === 'failed' || status === 'completed' || status === 'running') {
    // 'running' guard prevents double execution when both direct call and BullMQ worker fire
    return;
  }

  // Atomically claim the run — prevents a BullMQ worker from starting it again
  await updateRun(runId, { status: 'running' });

  const payload = run.payload as BoltPayload;
  const { companyId, outcomeView } = payload;
  const campaignMode = (payload.executionConfig as Record<string, unknown>)?.campaign_mode as string | undefined;
  const isCreatorDependent = campaignMode === 'creator_dependent';

  // Creator-dependent campaigns stop at daily_plan — a human creator must produce the content.
  // 'schedule' and 'campaign_schedule' both trigger scheduled_posts creation (text-based only).
  const shouldSchedule = !isCreatorDependent && (outcomeView === 'schedule' || outcomeView === 'campaign_schedule');
  const isWeekPlanOnly = outcomeView === 'week_plan';

  const missing = validateExecutionConfig(payload.executionConfig);
  if (missing.length > 0) {
    const invalidDuration = missing.includes('campaign_duration_invalid');
    const filtered = missing.filter((m) => m !== 'campaign_duration_invalid');
    const msg = invalidDuration
      ? `BOLT execution blocked. Campaign duration must be 1–4 weeks.${filtered.length > 0 ? ` Missing: ${filtered.join(', ')}` : ''}`
      : `BOLT execution blocked. Missing execution inputs: ${missing.join(', ')}`;
    await updateRun(runId, { status: 'failed', error_message: msg });
    throw new Error(msg);
  }

  let eligiblePlatforms: string[] = [];
  try {
    const profile = await getProfile(companyId, { autoRefine: false, languageRefine: false });
    const rawPlatforms = getAvailablePlatformsFromProfile(profile);
    eligiblePlatforms = filterBoltPlatforms(rawPlatforms);
    // Only use company-configured platforms; never add unconfigured ones
  } catch {
    eligiblePlatforms = [];
  }

  const totalStages = isWeekPlanOnly
    ? 3  // source-recommendation, ai/plan, commit-plan
    : shouldSchedule
      ? STAGES.length
      : STAGES.length - 1;
  const needsPlatformsForContent = !isWeekPlanOnly && (shouldSchedule || totalStages > 2);
  if (needsPlatformsForContent && eligiblePlatforms.length === 0) {
    const msg =
      'No social platforms configured for this company. Add platform URLs (LinkedIn, Instagram, X, etc.) in the company profile before generating or scheduling content.';
    await updateRun(runId, { status: 'failed', error_message: msg });
    throw new Error(msg);
  }

  let campaignId: string | null = null;
  let plan: { weeks: unknown[] } | null = null;
  let weeksGenerated = 0;
  let dailySlotsCreated = 0;
  let scheduledPostsCreated = 0;

  const getProgress = (stageIndex: number) => Math.round((stageIndex / totalStages) * 100);

  try {
    for (let i = 0; i < STAGES.length; i++) {
      const stage = STAGES[i];
      if (stage === 'schedule-structured-plan' && !shouldSchedule) continue;
      // week_plan commits the plan to DB then stops — generate-weekly-structure and beyond are skipped
      if (isWeekPlanOnly && stage === 'generate-weekly-structure') break;

      if (campaignId) {
        try {
          await assertCampaignValid(campaignId);
        } catch (guardErr) {
          const rawMsg = guardErr instanceof Error ? guardErr.message : String(guardErr);
          const msg = await getUserFriendlyMessage(guardErr, 'campaign').catch(() => rawMsg);
          await updateRun(runId, { status: 'aborted', error_message: msg });
          await logEvent(runId, stage, 'aborted', { error: rawMsg });
          return;
        }
      }

      const stageToCheck = stage === 'generate-weekly-structure' ? null : stage;
      if (stageToCheck && (await checkStageCompleted(runId, stageToCheck))) {
        if (stage === 'source-recommendation') {
          const { data: runRow } = await supabase
            .from('bolt_execution_runs')
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
          const aiResult = await runAiPlan(runId, campaignId, companyId, payload, eligiblePlatforms);
          plan = aiResult.plan;
          await logEvent(runId, stage, 'completed', {
            campaign_id: campaignId,
            duration_ms: Date.now() - stageStart,
            weeksCount: plan.weeks.length,
            plan: { weeks: plan.weeks },
          });
        } else if (stage === 'commit-plan' && campaignId && plan) {
          await runCommitPlan(campaignId, plan, payload.executionConfig as Record<string, unknown>);
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
          if (typeof rawFreq === 'string') {
            const s = rawFreq.trim().toLowerCase();
            const parsed = s === 'daily' ? 7 : parseInt(rawFreq, 10);
            if (!isNaN(parsed) && parsed > 0) {
              postsPerWeek = parsed;
            } else {
              postsPerWeek = determinePostsPerWeek({
                campaignDurationWeeks: plan.weeks.length,
                momentumLevel,
                pressureLevel,
              });
            }
          } else {
            postsPerWeek = determinePostsPerWeek({
              campaignDurationWeeks: plan.weeks.length,
              momentumLevel,
              pressureLevel,
            });
          }
          postsPerWeek = Math.min(Math.max(postsPerWeek, 1), 14);
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
              boltTextOnly: true,
            }
          );
          weeksGenerated = plan.weeks.length;
          dailySlotsCreated = summary.dailySlotsCreated;
        } else if (stage === 'schedule-structured-plan' && campaignId && plan) {
          const scheduleResult = await runScheduleStructuredPlan(
            campaignId,
            plan,
            payload.executionConfig,
            (s) => updateRun(runId, { current_stage: s })
          );
          scheduledPostsCreated = scheduleResult.scheduled_count;
          await logEvent(runId, stage, 'completed', {
            campaign_id: campaignId,
            duration_ms: Date.now() - stageStart,
            scheduled_count: scheduleResult.scheduled_count,
          });
        }
      } catch (stageErr) {
        const { msg, details } = unwrapErrorForLog(stageErr);
        if (details) {
          console.error('[bolt] Stage failed with underlying errors:', details);
        }
        const userMessage = await getUserFriendlyMessage(stageErr, 'campaign');
        await logEvent(runId, stage, 'failed', {
          duration_ms: Date.now() - stageStart,
          campaign_id: campaignId ?? undefined,
          error_message: userMessage,
        });
        await updateRun(runId, { status: 'failed', error_message: userMessage });
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
    // Mark campaign active now that the pipeline completed successfully
    if (campaignId) {
      await supabase
        .from('campaigns')
        .update({ status: 'active', current_stage: 'schedule', updated_at: new Date().toISOString() })
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
      content_variants_generated: dailySlotsCreated,
      expected_content_items: dailySlotsCreated,
      actual_posts_published: scheduledPostsCreated,
      ...aiMetrics,
    });
  } catch (err) {
    const { details } = unwrapErrorForLog(err);
    if (details) {
      console.error('[bolt] Pipeline failed with underlying errors:', details);
    }
    const userMessage = await getUserFriendlyMessage(err, 'campaign');
    await updateRun(runId, { status: 'failed', error_message: userMessage });
    throw err;
  }
}

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
    await supabase.from('campaigns').update({
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

/** Unwrap AggregateError so we log underlying causes; return human-readable msg for UI. */
function unwrapErrorForLog(err: unknown): { msg: string; details?: string } {
  const errObj = err as { errors?: unknown[]; message?: string };
  if (errObj && typeof errObj === 'object' && Array.isArray(errObj.errors) && errObj.errors.length > 0) {
    const messages = errObj.errors.map((e: unknown) => (e instanceof Error ? e.message : String(e)));
    const details = messages.join('; ');
    const first = messages[0] ?? errObj.message ?? 'Unknown error';
    return {
      msg: messages.length > 1 ? `${first} (${messages.length} errors)` : first,
      details,
    };
  }
  return {
    msg: err instanceof Error ? err.message : String(err),
  };
}
