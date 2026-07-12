import { getExecutionCategoryForContentType, executionCategoryToAiGenerated } from '../../../backend/services/plannerActivityCardService';
// Phase-2 Step-2: centralized routing authority. requiresMediaIntent no
// longer hard-codes a format list — it defers to the ONE routing engine
// (behaviour-preserving shim; video stays in the human-production lane).
import { routeRequiresMediaIntent } from '../../../backend/services/orchestration/routing';
import { deriveCreatorAssetTypeFromIntent } from '../../../backend/services/creatorTemplateRegistryService';
import { familyForCreatorType } from '../../../lib/creator-templates';
import { loadCampaignTemplatePool, selectTemplateFromPool, type CampaignTemplatePool } from '../../../backend/services/creator/campaignDesignSystemService';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { BoltError, BOLT_ERROR_CODES } from '../../../lib/shared/bolt/boltErrorCodes';
import { validateDailyPlanRow } from '../../../lib/shared/bolt/validateDailyPlanRow';
// Capability-aware eligibility (capability ∩ exclusive ∩ blocklist) — NOT the
// blocklist-only leaf in formatPlatformBinding, which let carousel→YouTube etc.
// slip through at generation (AUDIT-004 mapping gap).
import { filterPlatformsForFormat } from '../../../lib/shared/bolt/contentPlatformAssignment';
import { clampCampaignFormatFrequency } from '../../../lib/shared/bolt/formatGovernance';
import { buildReconciliation, assertPlannerInvariant, summarizeDrops, publicDropReason, type DroppedItem, type DropReasonCode, type PlannerReconciliation } from '../../../lib/shared/campaign/plannerDiagnostics';
import { PlannerTrace, computePlannerMetrics, type PlannerMetrics } from '../../../lib/shared/campaign/campaignLifecycle';
import { emitPlannerMetrics, emitLifecycleTransition } from '../../../backend/services/campaign/plannerMetrics';
import { deriveMasterIdeaBundle, normalizeForFingerprint } from '../../../lib/shared/campaign/masterIdea';
import { assessCampaignQuality, type CampaignQualityAssessment, type PlannedAsset } from '../../../lib/shared/campaign/campaignQuality';
import { optimizeCampaign, applyOptimizedContext, DEFAULT_MAX_OPTIMIZATION_PASSES, type OptimizationResult } from '../../../lib/shared/campaign/campaignOptimizer';
import { validateAsset, ValidationContext, emptyValidationStats, tallyValidation, type CampaignValidationLanes, type GeneratedAsset } from '../../../lib/shared/campaign/semanticValidation';
import { emitQualityMetrics, emitOptimizationMetrics, emitCampaignRunMetrics } from '../../../backend/services/campaign/campaignObservability';
import { recordRowFailureBatch, type RowFailureRecord } from '../../../backend/services/boltRowFailureDiagnostics';

import { getUnifiedCampaignBlueprint } from '../../../backend/services/campaignBlueprintService';
import {
  enrichDailyItemWithPlatformRequirements,
  validateDailyItemAgainstPlatformRules,
} from '../../../backend/services/platformExecutionValidator';
import {
  analyzeValidationResults,
  generatePlanningFeedback,
} from '../../../backend/services/campaignExecutionFeedbackService';
import { getPlatformRules } from '../../../backend/services/platformIntelligenceService';
import {
  analyzeExecutionFeedback,
  suggestPublishingStrategy,
} from '../../../backend/services/publishingOptimizationService';
import { generatePlatformWaveSchedule } from '../../../backend/services/campaignWaveService';
/** Daily distribution removed: schedule (day_index) comes from weekly plan only. */
import { getCompanyPerformanceInsights } from '../../../backend/services/campaignLearningService';
import {
  buildCampaignContext,
  getCampaignContext,
  setCampaignContext,
  type CampaignContext,
} from '../../../backend/services/contextCompressionService';
import { getStrategyMemory } from '../../../backend/services/campaignStrategyMemoryService';
import { getCachedStrategyProfile } from '../../../backend/services/strategyProfileCache';
import { getLatestCampaignVersionByCampaignId } from '../../../backend/db/campaignVersionStore';
import type { CampaignBlueprintWeek, WeeklyTopicWritingBrief } from '../../../backend/types/CampaignBlueprint';
import { filterBoltContentTypeMix } from '../../../backend/utils/boltTextContentConfig';
import { getPlatformBestTime, pickPlatformDayIndex } from '../../../backend/utils/platformPostingTimes';
import {
  normalizePlatformKey,
  deriveSynthPainPoint,
  deriveSynthOutcomePromise,
  deriveKeywords,
  deriveHashtags,
  deriveTextHook,
  deriveKeyPoints,
  deriveRepurposeAngles,
  deriveSEOFocus,
  deriveVisualHook,
  deriveImagePrompt,
  deriveVideoPrompt,
  deriveSceneDirection,
  normalizeTopicKey,
  pickContentType,
  buildTopicReference,
  buildCreatorCard,
  buildCreativeGuidance,
  requiresCreatorCreativeGuidance,
  buildDayTopics,
  computeTopicAssignedDays,
  validateDailyPlan,
  toIsoDateOnly,
  computeDayDate,
  buildDeterministicDailyObjective,
  getDefaultPlatformTargets,
  deriveContentGuidance,
  refineDailyObjectivesWithLLM,
  stableStringify,
  assertDailyIntentNotMutated,
  assertDailyExecutionIdentityNotMutated,
  assertDailyGlobalProgressionNotMutated,
  deriveSubTopic,
  DailyPlanItem,
  GenerateWeeklyStructureInput,
  DAYS_OF_WEEK,
} from "./weekly-structure-helpers";
export { type GenerateWeeklyStructureInput } from "./weekly-structure-helpers";
// Step-4 feature-flagged Creator cutover (image/carousel only). The
// SINGLE adapter entry point — both the main loop and the auto-optimize
// branch route through it. Flag OFF ⇒ this returns false everywhere and
// the legacy inline paths run byte-identically.
import {
  applyCreatorBlueprint,
  isCreatorBlueprintAdapterEnabled,
} from "../../../backend/services/creator/intelligence/applyCreatorBlueprint";
// Step-7 feature-flagged planning-hierarchy cutover (image/carousel
// scheduler-bound only; reel/video model-only). SINGLE planning entry
// point; persists ONLY toSchedulerRow(task). Flag OFF ⇒ returns false
// and the Step-4 adapter / legacy chain runs unchanged.
import {
  applyCreatorPlanningFlow,
} from "../../../backend/services/creator/intelligence/planning/applyCreatorPlanningFlow";

/**
 * Exact TS mirror of the DB CHECK `is_valid_creator_platform_asset_combo`
 * (supabase/migrations/20260516_creator_capability_function_complete.sql).
 * The DB constraint is the final authority — this MUST stay byte-for-byte
 * equivalent to that function's platform/asset table.
 *
 * Why this exists: a daily_content_plans row is only allowed to be tagged
 * intent_type='creator' when the (platform, asset_type) pair is renderable
 * for that platform. Previously the row was tagged 'creator' purely from
 * the content type, so unrenderable combos (e.g. youtube+carousel,
 * instagram+story→null asset_type) violated the constraint and rolled
 * back the ENTIRE daily-plans batch ("Failed to save daily plans"). When
 * the combo is NOT valid we fall the row back to the 'text' lane, which
 * always passes the constraint and follows the standard BOLT-text content
 * queue — content still gets created, just via the writer path.
 */
function isValidCreatorPlatformAssetCombo(
  platform: string | null | undefined,
  assetType: string | null | undefined,
): boolean {
  const a = String(assetType ?? '').trim();
  if (!a) return false;
  let p = String(platform ?? '').toLowerCase().trim();
  if (p === 'twitter') p = 'x';
  switch (p) {
    case 'linkedin':  return ['image', 'carousel', 'video', 'post_with_asset'].includes(a);
    case 'instagram': return ['image', 'carousel', 'video', 'post_with_asset'].includes(a);
    case 'facebook':  return ['image', 'carousel', 'video', 'post_with_asset'].includes(a);
    case 'threads':   return ['image', 'video', 'post_with_asset'].includes(a);
    case 'x':         return ['image', 'video', 'thread_with_asset', 'post_with_asset'].includes(a);
    case 'tiktok':    return a === 'video';
    case 'pinterest': return ['image', 'carousel', 'post_with_asset'].includes(a);
    case 'youtube':   return ['video', 'post_with_asset'].includes(a);
    default:          return false;
  }
}

/**
 * CAMPAIGN-IMPL-004: stamp the additive Master-Idea bundle (idea identity +
 * variant identity + semantic fingerprints) onto the enriched content envelope,
 * derived from fields ALREADY on the item. Fail-safe (never blocks generation)
 * and additive (older rows simply lack the block). ideaKey uses the planner's
 * own topicReference so every asset gets exactly one deterministic Master Idea.
 */
function stampMasterIdea(enriched: any, campaignId: string, weekNumber: number, weekBlueprint: any, item: any): void {
  try {
    const platform = enriched?.platform
      ?? (Array.isArray(item?.platformTargets) ? item.platformTargets[0] : undefined);
    const bundle = deriveMasterIdeaBundle({
      campaignId,
      weekNumber,
      // Planner-emitted Master-Idea seed wins: the normalized base business
      // concept, shared by every format variant of one idea (cross-format
      // grouping). Falls back to per-asset identity for legacy / AI-decide rows
      // that predate planner emission (backward compatibility).
      ideaKey: String(item?.masterIdeaSeed ?? item?.topicReference ?? item?.masterContentId ?? '') || undefined,
      theme: weekBlueprint?.phase_label ?? weekBlueprint?.primary_objective,
      narrative: item?.narrativeStyle,
      audience: item?.whoAreWeWritingFor,
      intent: item?.dailyObjective,
      buyerJourneyStage: weekBlueprint?.funnel_stage ?? weekBlueprint?.buyer_journey_stage,
      ctaStrategy: item?.ctaType ?? item?.desiredAction,
      coreMessage: item?.briefSummary,
      contentType: item?.contentType,
      platform,
      topicTitle: item?.topicTitle,
    });
    enriched.master_idea = bundle.master_idea;
    enriched.variant = bundle.variant;
    enriched.fingerprint = bundle.fingerprint;
    enriched.master_idea_version = bundle.master_idea_version;
    // CAMPAIGN-IMPL-006A traceability: default context is the original plan; the
    // optimizer flips this to 'optimized' on rows it refines.
    if (enriched.campaign_context == null) enriched.campaign_context = 'original';
  } catch { /* additive metadata — never block generation */ }
}

/**
 * CAMPAIGN-IMPL-005: build the advisory quality-engine input from the rows about
 * to be persisted (the PLAN, before AI content generation). Reads the additive
 * Master-Idea + fingerprint block stamped above plus the row's own fields. Purely
 * read-only — it feeds the advisory assessment and never alters a row.
 */
function toPlannedAsset(row: any): PlannedAsset {
  let content: any = {};
  try { content = typeof row?.content === 'string' ? JSON.parse(row.content) : (row?.content ?? {}); } catch { content = {}; }
  const mi = content?.master_idea ?? {};
  const fp = content?.fingerprint ?? {};
  const intent = content?.intent ?? content?.writer_brief ?? {};
  return {
    content_type: String(row?.content_type ?? 'post'),
    platform: row?.platform ?? null,
    week: Number(row?.week_number ?? 1) || 1,
    theme: mi.theme ?? null,
    funnel_stage: mi.buyer_journey_stage ?? content?.funnel_stage ?? null,
    cta: row?.cta ?? mi.cta_strategy ?? null,
    audience: row?.target_audience ?? mi.audience ?? null,
    master_idea_id: mi.id ?? content?.master_content_id ?? null,
    idea_fingerprint: fp.idea ?? null,
    narrative_fingerprint: fp.narrative ?? null,
    cta_fingerprint: fp.cta ?? null,
    topic_fingerprint: fp.topic ?? null,
    topic_title: row?.title ?? row?.topic ?? null,
    hook: intent?.hook ?? intent?.visual_hook ?? null,
  };
}

/**
 * CAMPAIGN-IMPL-006: apply an optimizer's metadata-only refinements back onto a
 * persisted row's content JSON — ONLY the additive Master-Idea block + fingerprints
 * (theme / buyer-journey stage / CTA strategy / audience / idea identity). It never
 * touches content_type, platform, week/date, counts, or any typed DB column, so
 * campaign structure + schedule stay invariant. Fail-safe; no-op on rows without a
 * Master-Idea block (backward compatible).
 */
function applyOptimizationToRow(row: any, opt: PlannedAsset): void {
  try {
    if (typeof row?.content !== 'string') return;
    const content = JSON.parse(row.content);
    if (!content || typeof content !== 'object' || !content.master_idea) return;
    // CAMPAIGN-IMPL-006A: project the optimized values onto BOTH the additive
    // Master-Idea block (creator prompt) AND the flat fields the text/BOLT prompt
    // builders read (desiredAction → cta_type, whoAreWeWritingFor → target_audience),
    // and stamp campaign_context='optimized'. Never touches content_type/platform/
    // date/counts or typed columns.
    applyOptimizedContext(content, opt);
    row.content = JSON.stringify(content);
  } catch { /* metadata-only refinement — never block generation */ }
}


export async function generateWeeklyStructure(body: GenerateWeeklyStructureInput): Promise<{
  success: boolean;
  week?: number;
  weeks?: number[];
  dailyPlan: unknown[];
  topicDayMap: unknown[];
  validation: unknown;
  planning_feedback: unknown;
  execution_feedback: unknown;
  publishing_optimization: unknown;
  auto_rebalance: boolean;
  auto_optimize_distribution: boolean;
  enable_campaign_waves: boolean;
  message: string;
  planner_diagnostics?: (PlannerReconciliation & {
    metrics: PlannerMetrics;
    /** Structured drop events captured at the actual drop sites (row-unit "where"). */
    drop_events: DroppedItem[];
    /** Per-reason count summary with public uppercase reason names (UI-ready). */
    drop_summary: Array<{ reason: DropReasonCode; message: string; count: number; public_reason: string }>;
  }) | null;
  /** CAMPAIGN-IMPL-005 — advisory pre-generation campaign quality assessment. */
  campaign_quality?: CampaignQualityAssessment | null;
  /** CAMPAIGN-IMPL-006 — pre-generation optimization: before/after + changelog. */
  campaign_optimization?: OptimizationResult | null;
  /** CAMPAIGN-IMPL-007 — pre-generation semantic-validation preview (idea-level). */
  campaign_validation?: CampaignValidationLanes | null;
}> {
  const {
    week,
    weeks: weeksBody,
    campaignId,
    companyId,
    auto_rebalance,
    auto_optimize_distribution,
    enable_campaign_waves,
    distribution_mode,
    eligible_platforms: eligiblePlatformsBody,
    posts_per_week: postsPerWeekBody,
    variantMetadata,
    adaptive_performance_insights: adaptiveInsightsBody,
    campaign_start_date: campaignStartDateFromInput,
    boltTextOnly: boltTextOnlyBody,
    format_frequency: formatFrequencyBody,
    cross_platform_sharing: crossPlatformSharingBody,
    conflict_policy: conflictPolicyBody,
  } = body || {};
  // Cross-campaign conflict decision from the launch UI: 'avoid' (default — schedule
  // around other campaigns), 'skip' (drop pieces that can't get a free day), or
  // 'override' (ignore other campaigns and allow same-day double-booking).
  const conflictPolicy: 'avoid' | 'skip' | 'override' =
    conflictPolicyBody === 'skip' || conflictPolicyBody === 'override' ? conflictPolicyBody : 'avoid';
  // Only default to text-only when the adapter explicitly passes that setting.
  const boltTextOnly = boltTextOnlyBody != null ? Boolean(boltTextOnlyBody) : false;
  void variantMetadata;
    const eligiblePlatforms: string[] | undefined =
      Array.isArray(eligiblePlatformsBody) && eligiblePlatformsBody.length > 0
        ? eligiblePlatformsBody.map((p: unknown) => normalizePlatformKey(String(p))).filter(Boolean)
        : undefined;
    const postsPerWeek: number | undefined =
      postsPerWeekBody != null && Number.isFinite(Number(postsPerWeekBody))
        ? Math.max(2, Math.min(20, Math.floor(Number(postsPerWeekBody))))  // raised 7→14→20 to support up to 20 activity cards/week
        : undefined;
  // Resolve format_frequency: Record<string, number> or null.
  // Defence-in-depth (CAMPAIGN-IMPL-001): clamp to the canonical business
  // limits (≤2 types/lane, ≤3/week per type, ≤5/week per lane in a mix) so the
  // planner can NEVER emit an over-limit campaign even if a payload bypasses the
  // server validator (internal re-execution, an existing over-limit saved
  // campaign). The server validator rejects such payloads up front; this is the
  // graceful floor for anything that slips past it.
  const rawFormatFrequency: Record<string, number> | null =
    formatFrequencyBody && typeof formatFrequencyBody === 'object' && !Array.isArray(formatFrequencyBody)
      ? (formatFrequencyBody as Record<string, number>)
      : null;
  const formatFrequency: Record<string, number> | null = clampCampaignFormatFrequency(rawFormatFrequency);
  if (rawFormatFrequency && JSON.stringify(rawFormatFrequency) !== JSON.stringify(formatFrequency)) {
    console.warn('[weekly-structure][limits-clamp] format_frequency clamped to business limits', {
      before: rawFormatFrequency,
      after: formatFrequency,
    });
  }
  // Resolve cross_platform_sharing: true = shared (same day), false = unique (staggered)
  const crossPlatformShared: boolean =
    typeof crossPlatformSharingBody === 'boolean'
      ? crossPlatformSharingBody
      : typeof crossPlatformSharingBody === 'object' && crossPlatformSharingBody !== null
        ? Boolean((crossPlatformSharingBody as { enabled?: boolean }).enabled)
        : true; // default: shared (BOLT default behaviour)
    const autoRebalance = Boolean(auto_rebalance);
    const autoOptimizeDistribution = Boolean(auto_optimize_distribution);
    const enableCampaignWaves = Boolean(enable_campaign_waves);

    const weekNumbers: number[] = Array.isArray(weeksBody) && weeksBody.length > 0
      ? weeksBody
          .map((w: unknown) => Number(w))
          .filter((n) => Number.isFinite(n) && n >= 1)
      : Number.isFinite(Number(week)) && Number(week) >= 1
        ? [Number(week)]
        : [];

  if (!campaignId || weekNumbers.length === 0) {
    throw new BoltError(
      BOLT_ERROR_CODES.WEEK_STRUCTURE_VALIDATION_FAILED,
      'campaignId and week (or weeks array) are required',
    );
  }

  // CAMPAIGN-OPS-001: campaign execution timer (run duration + outcome).
  const runStartedAt = Date.now();

  // CAMPAIGN-IMPL-003: deterministic drop capture. Every in-loop skip that used
  // to vanish behind a bare `continue` / `console.log` now records a STRUCTURED
  // drop here at the point it happens (row-unit). These events power the
  // planner_diagnostics reason breakdown + observability; the piece-unit
  // reconciliation invariant below stays the authoritative planned=generated+
  // dropped accounting. Silent loss is impossible: a skip that records nothing
  // would show up as an unattributed reconciliation residual.
  const plannerTrace = new PlannerTrace();

    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, start_date, name, company_id')
      .eq('id', campaignId)
      .maybeSingle();

  let effectiveStartDate = (campaign as { start_date?: string } | null)?.start_date;
  if (!effectiveStartDate && campaignStartDateFromInput && String(campaignStartDateFromInput).trim()) {
    const startVal = String(campaignStartDateFromInput).trim();
    effectiveStartDate = startVal.includes('T') ? startVal : `${startVal}T00:00:00.000Z`;
    await supabase.from('campaigns').update({ start_date: effectiveStartDate }).eq('id', campaignId);
  }
  if (!effectiveStartDate) {
    throw new BoltError(
      BOLT_ERROR_CODES.WEEK_STRUCTURE_VALIDATION_FAILED,
      'Campaign start_date is required before generating daily plans',
      { details: { field: 'start_date' } }
    );
  }
  // Ensure campaign object has start_date for downstream usage
  if (campaign) (campaign as { start_date: string }).start_date = effectiveStartDate;

  const blueprint = await getUnifiedCampaignBlueprint(String(campaignId));
  if (!blueprint?.weeks?.length) {
    throw new BoltError(
      BOLT_ERROR_CODES.BLUEPRINT_NOT_FOUND,
      'Committed weekly blueprint not found',
    );
  }
  for (const wn of weekNumbers) {
    const wb = blueprint.weeks.find((w) => Number(w.week_number) === wn);
    if (!wb) {
      throw new BoltError(
        BOLT_ERROR_CODES.WEEK_NOT_FOUND,
        `Week ${wn} not found in blueprint`,
        { details: { week_number: wn } }
      );
    }
  }

    const adaptiveInsights = adaptiveInsightsBody && typeof adaptiveInsightsBody === 'object'
      ? adaptiveInsightsBody as {
          high_performing_platforms?: Array<{ value: string; avgEngagement: number; signalCount: number }>;
          high_performing_content_types?: Array<{ value: string; avgEngagement: number; signalCount: number }>;
          low_performing_patterns?: Array<{ platform?: string; content_type?: string; reason: string }>;
        }
      : null;

    const cid = (campaign as any)?.company_id ?? companyId;
    let compressedContext: CampaignContext | undefined;
    const cached = cid ? getCampaignContext(String(campaignId)) : null;
    if (cached) {
      compressedContext = cached;
    } else {
      try {
        let baseInsightsForCtx: { company_high_performing_platforms: any[]; company_high_performing_content_types: any[] } | null = null;
        if (cid) baseInsightsForCtx = await getCompanyPerformanceInsights(cid);
        const companyPerfForCtx = baseInsightsForCtx || adaptiveInsights ? {
          high_performing_platforms: (adaptiveInsights?.high_performing_platforms?.length ?? 0) > 0
            ? adaptiveInsights.high_performing_platforms
            : baseInsightsForCtx?.company_high_performing_platforms.map((p) => ({ value: p.value })) ?? [],
          high_performing_content_types: (adaptiveInsights?.high_performing_content_types?.length ?? 0) > 0
            ? adaptiveInsights.high_performing_content_types
            : baseInsightsForCtx?.company_high_performing_content_types.map((p) => ({ value: p.value })) ?? [],
        } : undefined;
        let strategyMemory: { preferred_platforms?: string[]; preferred_content_types?: string[] } | null = null;
        let strategyProfile: { preferred_platform_weights?: Record<string, number>; preferred_content_type_ratios?: Record<string, number> } | null = null;
        if (cid) {
          try { strategyMemory = await getStrategyMemory(cid); } catch { /* optional */ }
          try {
            const { profile } = await getCachedStrategyProfile(cid);
            strategyProfile = profile;
          } catch { /* optional */ }
        }
        const themes = blueprint.weeks.flatMap((w) =>
          (Array.isArray((w as any).topics) ? (w as any).topics : [])
            .map((t) => (t as any)?.topicTitle ?? (t as any)?.title ?? '')
            .filter(Boolean)
        );
        const topic = (campaign as any)?.name ?? blueprint.weeks[0]?.primary_objective ?? 'Campaign';
        let execInputs: { target_audience?: string; content_depth?: string; campaign_goal?: string } = {};
        try {
          const versionRow = await getLatestCampaignVersionByCampaignId(String(campaignId));
          const execConfig = (versionRow?.campaign_snapshot as Record<string, unknown>)?.execution_config as Record<string, unknown> | undefined;
          if (execConfig && typeof execConfig === 'object') {
            if (execConfig.target_audience != null && String(execConfig.target_audience).trim())
              execInputs.target_audience = String(execConfig.target_audience).trim();
            if (execConfig.content_depth != null && String(execConfig.content_depth).trim())
              execInputs.content_depth = String(execConfig.content_depth).trim();
            if (execConfig.campaign_goal != null && String(execConfig.campaign_goal).trim())
              execInputs.campaign_goal = String(execConfig.campaign_goal).trim();
          }
        } catch { /* optional */ }
        compressedContext = buildCampaignContext({
          topic,
          themes: themes.length > 0 ? themes : undefined,
          companyPerformanceInsights: companyPerfForCtx,
          strategyMemory: strategyMemory ?? undefined,
          strategyLearningProfile: strategyProfile ?? undefined,
          eligiblePlatforms,
          ...execInputs,
        });
        if (cid) setCampaignContext(String(campaignId), compressedContext);
      } catch { /* optional; will pass companyPerformanceInsights only */ }
    }

    const allFinalItems: any[] = [];
    const allRowsToInsert: any[] = [];
    const { data: latestCampaignVersion } = await supabase
      .from('campaign_versions')
      .select('version')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const currentPlanVersion = Math.max(1, Number((latestCampaignVersion as any)?.version || 1));
    let lastTopicDayMap: { dayIndex: number; day: string; topics: string[] }[] = [];
    let lastValidation: any = {};
    let lastExecutionFeedback: any = {};
    let lastPublishingOptimization: any = {};
    let lastAutoRebalanceEffective = false;
    let lastAutoOptimizeDistributionEffective = false;

    // Cross-campaign conflict avoidance: gather the platform-days this company's
    // OTHER campaigns have already scheduled, so day-placement below schedules
    // around them (never double-books a platform on a day across campaigns).
    // Best-effort — any lookup failure degrades to the prior single-campaign behavior.
    const existingScheduledByPlatform = new Map<string, Set<string>>();
    try {
      const { data: siblingCampaigns } = await supabase
        .from('campaigns')
        .select('id')
        .eq('company_id', cid)
        .neq('id', campaignId);
      const siblingIds = (siblingCampaigns ?? []).map((c: { id: string }) => c.id).filter(Boolean);
      if (siblingIds.length > 0) {
        const { data: existingRows } = await supabase
          .from('daily_content_plans')
          .select('platforms, date')
          .in('campaign_id', siblingIds);
        for (const row of existingRows ?? []) {
          const rowDate = String((row as { date?: unknown }).date ?? '').trim();
          if (!rowDate) continue;
          const plats = Array.isArray((row as { platforms?: unknown }).platforms)
            ? (row as { platforms: unknown[] }).platforms
            : [];
          for (const pl of plats) {
            const key = normalizePlatformKey(String(pl));
            if (!key) continue;
            const set = existingScheduledByPlatform.get(key) ?? new Set<string>();
            set.add(rowDate);
            existingScheduledByPlatform.set(key, set);
          }
        }
      }
      console.log('[weekly-structure][cross-campaign-conflicts]', {
        siblings: siblingIds.length,
        occupied: [...existingScheduledByPlatform.entries()].map(([p, s]) => ({ platform: p, days: s.size })),
      });
    } catch (e) {
      console.warn('[weekly-structure] cross-campaign conflict lookup failed (continuing):', (e as Error)?.message);
    }

    for (const weekNumber of weekNumbers) {
      const weekBlueprint = blueprint.weeks.find((w) => Number(w.week_number) === weekNumber)!;

      const distributionStrategy = (weekBlueprint as any).distribution_strategy as string | undefined;
      const fromStrategy =
        distributionStrategy === 'QUICK_LAUNCH'
          ? { distributionProfile: 'QUICK_LAUNCH' as const, distributionMode: 'same_day_per_topic' as const }
          : distributionStrategy === 'STAGGERED'
            ? { distributionProfile: 'STRATEGIC' as const, distributionMode: 'staggered' as const }
            : null;
      const distributionMode =
        fromStrategy?.distributionMode ??
        (distribution_mode === 'same_day_per_topic'
          ? 'same_day_per_topic'
          : crossPlatformShared
            ? 'same_day_per_topic'   // shared: all platforms get content on the same day
            : 'staggered');          // unique: each platform gets its own day slot
      const topicOrderRaw: string[] = Array.isArray(weekBlueprint.topics)
      ? weekBlueprint.topics.map((t) => String((t as any)?.topicTitle ?? '').trim()).filter(Boolean)
      : Array.isArray(weekBlueprint.topics_to_cover)
        ? weekBlueprint.topics_to_cover.map((t) => String(t ?? '').trim()).filter(Boolean)
        : [];
    const topicOrder = topicOrderRaw.length > 0
      ? topicOrderRaw
      : [String(weekBlueprint.phase_label || weekBlueprint.primary_objective || `Week ${weekNumber} topic`).trim()];

    const briefByKey = new Map<string, WeeklyTopicWritingBrief>();
    if (Array.isArray(weekBlueprint.topics)) {
      for (const brief of weekBlueprint.topics) {
        const title = String((brief as any)?.topicTitle ?? '').trim();
        if (title) briefByKey.set(normalizeTopicKey(title), brief as any);
      }
    }

    const topicIndexByKey = new Map<string, number>();
    topicOrder.forEach((t, idx) => topicIndexByKey.set(normalizeTopicKey(t), idx));

    const resolveTopic = (rawTopic: string, fallbackIndex: number): string => {
      const key = normalizeTopicKey(rawTopic);
      if (topicIndexByKey.has(key)) return topicOrder[topicIndexByKey.get(key) ?? 0]!;
      for (const t of topicOrder) {
        const tk = normalizeTopicKey(t);
        if (tk && key && (tk.includes(key) || key.includes(tk))) return t;
      }
      return topicOrder[fallbackIndex % topicOrder.length]!;
    };

    type ExecutionItemInput = {
      content_type: string;
      selected_platforms: string[];
      count_per_week: number;
      topic?: string;
      topic_slots?: Array<{
        topic: string | null;
        global_progression_index?: number;
        intent: any;
      }>;
    };

    const rawExecutionItems: any[] | null =
      Array.isArray((weekBlueprint as any)?.execution_items) ? ((weekBlueprint as any).execution_items as any[]) : null;
    let executionItems: ExecutionItemInput[] = (rawExecutionItems || [])
      .map((it) => {
        const content_type = String(it?.content_type ?? it?.contentType ?? it?.type ?? '').trim().toLowerCase();
        const selected_platforms_raw =
          Array.isArray(it?.selected_platforms) ? it.selected_platforms
          : Array.isArray(it?.selectedPlatforms) ? it.selectedPlatforms
          : Array.isArray(it?.platforms) ? it.platforms
          : it?.platform ? [it.platform]
          : [];
        const aiPlatforms = (selected_platforms_raw || [])
          .map((p: any) => normalizePlatformKey(String(p)))
          .filter(Boolean);
        // Owner policy 2026-07-10: the USER'S explicit platform selection is
        // the authority. AI-chosen platforms are constrained to it; when the
        // intersection is empty the piece is REASSIGNED to the user's
        // platforms (the piece survives, the platform choice does not).
        // No user selection → AI platforms pass through unchanged.
        const selected_platforms = (() => {
          if (!eligiblePlatforms || eligiblePlatforms.length === 0) return aiPlatforms;
          const allow = new Set(eligiblePlatforms);
          const kept = aiPlatforms.filter((p: string) => allow.has(p));
          return kept.length > 0 ? kept : [...eligiblePlatforms];
        })();
        const count_per_week = Number(it?.count_per_week ?? it?.countPerWeek ?? it?.count ?? 0) || 0;
        const topic = typeof it?.topic === 'string' && it.topic.trim() ? String(it.topic).trim() : undefined;
        const topic_slots = Array.isArray(it?.topic_slots)
          ? (it.topic_slots as any[]).map((slot: any) => {
              if (!slot || typeof slot !== 'object') return null;
              const topic = slot.topic == null ? null : String(slot.topic);
              const global_progression_index = Number((slot as any)?.global_progression_index);
              const intentRaw = slot.intent;
              if (!intentRaw || typeof intentRaw !== 'object') return null;
              const objective = (intentRaw as any).objective;
              const cta_type = (intentRaw as any).cta_type;
              const target_audience = (intentRaw as any).target_audience;
              const brief_summary = (intentRaw as any).brief_summary;
              if (typeof objective !== 'string' || !objective) return null;
              if (typeof cta_type !== 'string' || !cta_type) return null;
              if (typeof target_audience !== 'string' || !target_audience) return null;
              if (typeof brief_summary !== 'string' || !brief_summary) return null;
              if (!Number.isFinite(global_progression_index) || global_progression_index < 1) return null;
              return {
                topic,
                global_progression_index,
                intent: intentRaw,
              };
            }).filter(Boolean) as any
          : undefined;
        return { content_type, selected_platforms, count_per_week, topic, topic_slots };
      })
      .filter((it) => it.content_type && it.selected_platforms.length > 0 && Number(it.count_per_week) > 0);

    console.log('[weekly-structure][execution-items-check]', {
      weekNumber,
      executionItemsFromAI: executionItems.length,
      executionItemsPreview: executionItems.slice(0, 3).map((it: any) => ({
        content_type: it.content_type,
        slots: it.topic_slots?.length ?? 0,
        firstTopic: it.topic_slots?.[0]?.topic,
      })),
      willSynth: executionItems.length === 0,
    });

    // ── Resolve the distribution context ONCE. Used by BOTH the
    //    synth-from-blueprint path (when the AI gave no execution_items) AND
    //    the format_frequency reconciliation below (when it did). Pure, cheap
    //    derivations — safe to compute even when execution_items are present.
    const synthSlotPlatforms = (() => {
      // Owner policy 2026-07-10: the USER'S explicit platform selection wins.
      // (Previously the AI blueprint's platform_allocation keys took
      // precedence — a user who picked linkedin+facebook could get instagram
      // because the blueprint allocated it.) platform_allocation is only the
      // fallback when the user made no explicit selection.
      if (eligiblePlatforms && eligiblePlatforms.length > 0) return eligiblePlatforms;
      const fromAllocation = Object.keys(weekBlueprint.platform_allocation || {})
        .map(normalizePlatformKey)
        .filter(Boolean);
      return fromAllocation.length > 0 ? fromAllocation : ['linkedin'];
    })();
    // User's explicit format_frequency keys take precedence over AI-generated
    // content_type_mix — the distribution strictly honours what the user
    // selected on the strategy page.
    const userFormats = formatFrequency && Object.keys(formatFrequency).length > 0
      ? Object.keys(formatFrequency).map((t) => t.trim().toLowerCase()).filter(Boolean)
      : null;
    const synthContentTypes = (
      userFormats ??
      (Array.isArray(weekBlueprint.content_type_mix) && weekBlueprint.content_type_mix.length > 0
        ? weekBlueprint.content_type_mix
        : ['post'])
    ).map((t) => String(t || '').trim().toLowerCase()).filter(Boolean);
    const synthTotalCount = postsPerWeek ?? Math.max(
      2,
      Object.values(weekBlueprint.platform_allocation || {}).reduce((sum: number, n: unknown) => sum + Number(n), 0) || 3
    );
    // Topic resolution: topics_to_cover > platform_content_breakdown > phase_label
    const rawTopics: string[] = Array.isArray(weekBlueprint.topics_to_cover) && (weekBlueprint.topics_to_cover as unknown[]).length > 0
      ? (weekBlueprint.topics_to_cover as unknown[]).map((t) => String(t ?? '').trim()).filter(Boolean)
      : Array.isArray(weekBlueprint.topics) && (weekBlueprint.topics as any[]).length > 0
        ? (weekBlueprint.topics as any[]).map((t: any) => String(t?.topicTitle ?? t ?? '').trim()).filter(Boolean)
        : [];
    // Fallback: per-piece topics from platform_content_breakdown ("(1) Topic A").
    const pcdTopics: string[] = [];
    if (weekBlueprint.platform_content_breakdown && typeof weekBlueprint.platform_content_breakdown === 'object') {
      const seen = new Set<string>();
      for (const items of Object.values(weekBlueprint.platform_content_breakdown as Record<string, any[]>)) {
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          const perPieceTopics = Array.isArray(item?.topics) ? item.topics : (typeof item?.topic === 'string' && item.topic ? [item.topic] : []);
          for (const raw of perPieceTopics) {
            const clean = String(raw ?? '').replace(/^\(\d+\)\s*/, '').trim();
            if (clean && !seen.has(clean.toLowerCase())) {
              seen.add(clean.toLowerCase());
              pcdTopics.push(clean);
            }
          }
        }
      }
    }
    const synthTopics = rawTopics.length > 1
      ? rawTopics
      : rawTopics.length === 1 && pcdTopics.length > 0
        ? pcdTopics
        : rawTopics.length === 1
          ? rawTopics
          : pcdTopics.length > 0
            ? pcdTopics
            : [String(weekBlueprint.phase_label || weekBlueprint.primary_objective || `Week ${weekNumber} content`).trim()];
    const synthCtaType = String(weekBlueprint.cta_type || 'Engage').trim() || 'Engage';
    const synthObjective = String(weekBlueprint.primary_objective || weekBlueprint.phase_label || 'Build brand awareness').trim() || 'Build brand awareness';
    const synthDefaultCountPerType = Math.max(1, Math.round(synthTotalCount / Math.max(1, synthContentTypes.length)));
    const synthTargetAudience = compressedContext?.target_audience || 'our target audience';
    let synthGlobalIdx = (weekNumber - 1) * synthTotalCount;
    let globalTopicIdx = 0;

    // Build N topic_slots for a content type (shared by synth + reconciliation).
    // deriveSubTopic wraps each base topic in a content-type-specific angle so
    // every card gets a distinct, on-format title.
    const buildTopicSlots = (contentType: string, count: number): Array<{ topic: string | null; global_progression_index: number; intent: any }> => {
      const slots: Array<{ topic: string | null; global_progression_index: number; intent: any }> = [];
      for (let k = 0; k < count; k++) {
        synthGlobalIdx++;
        const baseTopic = synthTopics[globalTopicIdx % synthTopics.length]!;
        const topic = deriveSubTopic(baseTopic, contentType, k, synthTargetAudience);
        globalTopicIdx++;
        // CAMPAIGN-IMPL-004A: the planner OWNS the Master-Idea seed. It is the
        // normalized BASE business concept (before the per-format deriveSubTopic
        // angle), so every format variant built from this base topic carries the
        // same seed and resolves to ONE Master Idea id — cross-format grouping is
        // intentional, decided here in the planner, not inferred per asset.
        const masterIdeaSeed = normalizeForFingerprint(baseTopic);
        const requiresMediaBrief =
          ['video', 'reel', 'reels', 'carousel', 'infographic', 'story', 'stories', 'short', 'shorts', 'podcast', 'image'].includes(contentType) ||
          requiresCreatorCreativeGuidance(contentType);
        slots.push({
          topic,
          global_progression_index: synthGlobalIdx,
          intent: {
            objective: synthObjective,
            cta_type: synthCtaType,
            target_audience: synthTargetAudience,
            master_idea_seed: masterIdeaSeed,
            brief_summary: `${topic}: ${synthObjective}`,
            pain_point: deriveSynthPainPoint(topic),
            outcome_promise: deriveSynthOutcomePromise(topic, contentType),
            // Text enrichment (non-creator types)
            ...(!requiresMediaBrief ? {
              hook: deriveTextHook(topic, contentType),
              key_points: deriveKeyPoints(topic, synthObjective, contentType),
              seo_focus: deriveSEOFocus(topic, synthObjective),
              keywords: deriveKeywords(topic, synthObjective),
              hashtags: deriveHashtags(topic, contentType, synthObjective),
              repurpose_angles: deriveRepurposeAngles(topic, contentType),
            } : {}),
            // Creator enrichment
            ...(requiresMediaBrief ? {
              visual_hook: deriveVisualHook(topic, contentType),
              image_prompt: deriveImagePrompt(topic, contentType, synthSlotPlatforms),
              video_prompt: contentType !== 'carousel' ? deriveVideoPrompt(topic, contentType, synthSlotPlatforms) : undefined,
              scene_direction: deriveSceneDirection(topic, contentType),
              keywords: deriveKeywords(topic, synthObjective),
              hashtags: deriveHashtags(topic, contentType, synthObjective),
            } : {}),
          },
        });
      }
      return slots;
    };

    // Synthesize execution_items from blueprint data when the AI plan did not
    // produce explicit ones (BOLT / legacy campaigns).
    if (executionItems.length === 0) {
      console.log('[generate-weekly-structure] content type resolution', {
        formatFrequency,
        userFormats,
        contentTypeMix: weekBlueprint.content_type_mix,
        resolvedContentTypes: synthContentTypes,
      });
      for (const contentType of synthContentTypes) {
        const countPerType = formatFrequency?.[contentType] != null
          ? Math.max(1, Math.round(Number(formatFrequency[contentType])))
          : synthDefaultCountPerType;
        // Per-format platform eligibility: tweet→X only, poll↛X (truncates), etc.
        // Drop the format entirely when none of the candidate platforms qualify.
        const plats = filterPlatformsForFormat(synthSlotPlatforms, contentType);
        if (plats.length === 0) {
          console.log('[weekly-structure][skip-format-no-eligible-platform]', { contentType, candidates: synthSlotPlatforms });
          plannerTrace.drop({ content_type: String(contentType), platform: null, reason: 'no_eligible_platform', stage: 'structure_generation', detail: `synth: candidates=${synthSlotPlatforms.join(',') || 'none'}` });
          continue;
        }
        executionItems.push({ content_type: contentType, selected_platforms: plats, count_per_week: countPerType, topic_slots: buildTopicSlots(contentType, countPerType) });
      }
    } else if (userFormats && userFormats.length > 0) {
      // RECONCILE AI-provided execution_items against the user's explicit
      // format_frequency. The synth path above already honours format_frequency;
      // without this, AI-emitted counts silently win and the user's selected
      // per-type counts (e.g. 3 carousel + 3 image) are NOT produced (observed:
      // only 2 carousels, 0 images). Pad missing types/slots, trim overflow, and
      // drop content types the user did not select — making format_frequency the
      // single authority on counts for BOTH the AI and synth paths.
      const aiByType = new Map<string, ExecutionItemInput>();
      for (const it of executionItems) {
        const existing = aiByType.get(it.content_type);
        if (!existing) {
          aiByType.set(it.content_type, { ...it, topic_slots: Array.isArray(it.topic_slots) ? [...it.topic_slots] : [] });
        } else {
          existing.topic_slots = [...(existing.topic_slots ?? []), ...(Array.isArray(it.topic_slots) ? it.topic_slots : [])];
        }
      }
      const reconciled: ExecutionItemInput[] = [];
      for (const type of userFormats) {
        const desired = Math.max(1, Math.round(Number(formatFrequency![type] ?? 1)));
        const existing = aiByType.get(type);
        let slots = existing && Array.isArray(existing.topic_slots) ? [...existing.topic_slots] : [];
        if (slots.length > desired) {
          slots = slots.slice(0, desired);
        } else if (slots.length < desired) {
          slots = [...slots, ...buildTopicSlots(type, desired - slots.length)];
        }
        const rawPlats = existing && existing.selected_platforms.length > 0 ? existing.selected_platforms : synthSlotPlatforms;
        // Per-format platform eligibility (tweet→X only, poll↛X, etc.).
        let plats = filterPlatformsForFormat(rawPlats, type);
        // Reassign, don't drop (AUDIT-004): when the AI assigned this format to
        // platform(s) that BLOCK it (e.g. poll→X, which X coerces into a broken
        // tweet), fall back to the user's FULL eligible platform set before
        // dropping. A poll belongs on Facebook/LinkedIn — it must not be lost
        // just because the blueprint happened to pick X.
        if (plats.length === 0 && rawPlats !== synthSlotPlatforms) {
          plats = filterPlatformsForFormat(synthSlotPlatforms, type);
        }
        if (plats.length === 0) {
          console.log('[weekly-structure][skip-format-no-eligible-platform]', { type, candidates: rawPlats });
          plannerTrace.drop({ content_type: String(type), platform: null, reason: 'no_eligible_platform', stage: 'structure_generation', detail: `reconcile: candidates=${(rawPlats || []).join(',') || 'none'}` });
          continue;
        }
        reconciled.push({ content_type: type, selected_platforms: plats, count_per_week: desired, topic_slots: slots });
      }
      console.log('[weekly-structure][reconcile-format-frequency]', {
        formatFrequency,
        aiTypes: [...aiByType.keys()],
        reconciled: reconciled.map((r) => ({ type: r.content_type, count: r.count_per_week, slots: r.topic_slots?.length ?? 0 })),
      });
      executionItems = reconciled;
    }

    // ── BOLT "frequency is total" ────────────────────────────────────────────
    // format_frequency is the TOTAL number of posts across platforms, not a
    // per-platform count. The synth/reconcile above attach ALL platforms to each
    // format's pieces, which the per-platform daily expansion below would
    // multiply into (frequency × platforms) — e.g. 6 confirmed → 11 scheduled.
    // Redistribute so each piece targets a SINGLE platform (round-robin): the
    // total scheduled posts then equals exactly the frequency the user confirmed.
    if (formatFrequency) {
      executionItems = executionItems.flatMap((it) => {
        const plats = (it.selected_platforms || []).map((p) => String(p)).filter(Boolean);
        const slots = Array.isArray(it.topic_slots) ? it.topic_slots : [];
        if (plats.length <= 1 || slots.length === 0) return [it];
        const buckets = plats.length;
        const base = Math.floor(slots.length / buckets);
        const rem = slots.length % buckets;
        const split: ExecutionItemInput[] = [];
        let cursor = 0;
        for (let i = 0; i < buckets; i += 1) {
          const take = base + (i < rem ? 1 : 0);
          if (take <= 0) continue;
          split.push({
            content_type: it.content_type,
            selected_platforms: [plats[i]!],
            count_per_week: take,
            topic_slots: slots.slice(cursor, cursor + take),
          });
          cursor += take;
        }
        return split.length > 0 ? split : [it];
      });
      console.log('[weekly-structure][bolt-frequency-total]', {
        weekNumber,
        totalScheduledPosts: executionItems.reduce((s, it) => s + (Array.isArray(it.topic_slots) ? it.topic_slots.length : 0), 0),
        items: executionItems.map((it) => ({ type: it.content_type, platform: it.selected_platforms?.[0], count: it.count_per_week })),
      });
    }

    // ── DEDUPE GUARD: ensure no two activity cards share the same topic ──────
    // Whether topics came from synth or AI-provided execution_items, we must
    // guarantee each slot has a unique, content-type-appropriate title. Walk
    // through every (content_type × slot) and rewrite duplicates via deriveSubTopic.
    {
      const seenTopics = new Set<string>();
      const synthAudience = compressedContext?.target_audience || 'our target audience';
      for (const exec of executionItems) {
        const ct = String((exec as any).content_type || 'post').toLowerCase();
        const slots = Array.isArray((exec as any).topic_slots) ? (exec as any).topic_slots : [];
        for (let idx = 0; idx < slots.length; idx++) {
          const slot = slots[idx];
          if (!slot) continue;
          const currentTopic = String(slot.topic ?? '').trim();
          if (!currentTopic) continue;
          const key = currentTopic.toLowerCase();
          if (seenTopics.has(key)) {
            // Duplicate topic — rewrite with content-type-specific angle. This IS
            // regenerate-before-drop for structural duplicates: a duplicate is
            // never dropped, it is regenerated into a distinct on-format variation
            // (deriveSubTopic, deterministic — no AI, no uniqueness engine).
            // CAMPAIGN-IMPL-003A: record it so the regeneration shows in metrics.
            const derived = deriveSubTopic(currentTopic, ct, idx, synthAudience);
            slot.topic = derived;
            seenTopics.add(derived.toLowerCase());
            plannerTrace.regenerated(1);
            console.log('[weekly-structure][dedupe]', {
              contentType: ct,
              slotIndex: idx,
              original: currentTopic,
              rewrittenTo: derived,
            });
          } else {
            seenTopics.add(key);
          }
        }
      }
    }

    const useExecutionItems = executionItems.length > 0;

    for (const it of executionItems) {
      const slots = Array.isArray(it.topic_slots) ? it.topic_slots : [];
      if (slots.length < Math.max(0, Math.floor(it.count_per_week))) {
        throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_TOPIC_INTENT_REQUIRED');
      }
      for (const slot of slots) {
        if (!slot || typeof slot !== 'object' || !slot.intent) {
          throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_TOPIC_INTENT_REQUIRED');
        }
      }
    }

    type Piece = { platformTargets: string[]; contentType: string; topicTitle: string };
    const piecesByTopic = new Map<string, Piece[]>();
    for (const t of topicOrder) piecesByTopic.set(t, []);

    const dailyItemsDeterministic: DailyPlanItem[] = [];
    let dayTopics: string[][] = Array.from({ length: 7 }, () => []);

    {
      const isStaggered = distributionStrategy === 'STAGGERED';
      for (const exec of executionItems) {
        const platforms = exec.selected_platforms.map(normalizePlatformKey).filter(Boolean);
        for (let k = 0; k < (exec.topic_slots?.length ?? 0); k += 1) {
          const slot = (exec.topic_slots || [])[k];
          const baseDayIndex = Math.min(7, Math.max(1, Number((slot as any)?.day_index) || ((k % 7) + 1)));
          if (!slot || !slot.intent) {
            throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_TOPIC_INTENT_REQUIRED');
          }
          const rawTopic = slot.topic == null ? '' : String(slot.topic);
          if (!rawTopic.trim()) {
            throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_TOPIC_INTENT_REQUIRED');
          }
          const topicTitle = rawTopic;
          const topicKey = normalizeTopicKey(topicTitle);
          const briefForSlot = briefByKey.get(topicKey) ?? undefined;
          const topicIndex = topicIndexByKey.get(topicKey) ?? 0;
          const execIntent = slot.intent;

          const narrativeFallback =
            (briefForSlot as any)?.narrativeStyle
            ?? (weekBlueprint as any)?.weeklyContextCapsule?.toneGuidance
            ?? 'clear, practical, outcome-driven';

          const dailyObjective = execIntent.objective;
          const who = execIntent.target_audience;
          const briefSummary = execIntent.brief_summary;
          const ctaType = execIntent.cta_type;
          const writerBrief = execIntent;
          const globalProgressionIndex = Number((slot as any)?.global_progression_index);
          const writingAngle = typeof execIntent.writing_angle === 'string' && execIntent.writing_angle ? execIntent.writing_angle : null;
          if (typeof dailyObjective !== 'string' || !dailyObjective) throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_TOPIC_INTENT_REQUIRED');
          if (typeof who !== 'string' || !who) throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_TOPIC_INTENT_REQUIRED');
          if (typeof briefSummary !== 'string' || !briefSummary) throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_TOPIC_INTENT_REQUIRED');
          if (typeof ctaType !== 'string' || !ctaType) throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_TOPIC_INTENT_REQUIRED');
          if (!Number.isFinite(globalProgressionIndex) || globalProgressionIndex < 1) throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_GLOBAL_PROGRESSION_REQUIRED');

          const contentGuidance = deriveContentGuidance(briefForSlot);
          const slotMasterContentId = (slot as any)?.master_content_id;

          if (isStaggered && platforms.length > 0) {
            for (let pi = 0; pi < platforms.length; pi += 1) {
              const dayIndex = ((baseDayIndex - 1 + pi) % 7) + 1;
              const item: DailyPlanItem = {
                dayIndex,
                weekNumber,
                topicTitle,
                topicReference: buildTopicReference(weekNumber, topicIndex),
                globalProgressionIndex,
                dailyObjective,
                platformTargets: [platforms[pi]!],
                contentType: String(exec.content_type || 'post').toLowerCase(),
                briefSummary,
                writerBrief,
                writingIntent: briefSummary,
                whoAreWeWritingFor: who,
                whatProblemAreWeAddressing: typeof execIntent.pain_point === 'string' ? execIntent.pain_point : '',
                whatShouldReaderLearn: typeof execIntent.outcome_promise === 'string' ? execIntent.outcome_promise : '',
                desiredAction: ctaType,
                narrativeStyle: writingAngle || narrativeFallback,
                contentGuidance,
                ctaType,
                kpiTarget: String((weekBlueprint as any)?.weekly_kpi_focus ?? 'Reach growth'),
                ...(slotMasterContentId ? { masterContentId: slotMasterContentId } : {}),
                ...((execIntent as any)?.master_idea_seed ? { masterIdeaSeed: String((execIntent as any).master_idea_seed) } : {}),
              };
              const p = platforms[pi]!;
              assertDailyExecutionIdentityNotMutated({
                source_execution: { content_type: item.contentType, platform: p, topic: item.topicTitle },
                candidate: { content_type: item.contentType, platform: p, topic: item.topicTitle },
                stage: 'daily-build',
              });
              assertDailyGlobalProgressionNotMutated({
                source_global_progression_index: item.globalProgressionIndex,
                candidate: { global_progression_index: item.globalProgressionIndex },
                stage: 'daily-build',
              });
              assertDailyIntentNotMutated({
                sourceIntent: execIntent,
                dailyItem: item,
                candidate: {
                  objective: item.dailyObjective,
                  target_audience: item.whoAreWeWritingFor,
                  cta_type: item.ctaType,
                  brief_summary: item.briefSummary,
                  writer_brief: item.writerBrief,
                },
                stage: 'daily-build',
              });
              dailyItemsDeterministic.push(item);
              dayTopics[dayIndex - 1] = Array.from(new Set([...(dayTopics[dayIndex - 1] ?? []), topicTitle]));
            }
          } else {
            const dayIndex = baseDayIndex;
            const item: DailyPlanItem = {
              dayIndex,
              weekNumber,
              topicTitle,
              topicReference: buildTopicReference(weekNumber, topicIndex),
              globalProgressionIndex,
              dailyObjective,
              platformTargets: platforms.length > 0 ? platforms : exec.selected_platforms.map(normalizePlatformKey).filter(Boolean),
              contentType: String(exec.content_type || 'post').toLowerCase(),
              briefSummary,
              writerBrief,
              writingIntent: briefSummary,
              whoAreWeWritingFor: who,
              whatProblemAreWeAddressing: typeof execIntent.pain_point === 'string' ? execIntent.pain_point : '',
              whatShouldReaderLearn: typeof execIntent.outcome_promise === 'string' ? execIntent.outcome_promise : '',
              desiredAction: ctaType,
              narrativeStyle: writingAngle || narrativeFallback,
              contentGuidance,
              ctaType,
              kpiTarget: String((weekBlueprint as any)?.weekly_kpi_focus ?? 'Reach growth'),
              ...(slotMasterContentId ? { masterContentId: slotMasterContentId } : {}),
              ...((execIntent as any)?.master_idea_seed ? { masterIdeaSeed: String((execIntent as any).master_idea_seed) } : {}),
            };
            for (const platform of item.platformTargets) {
              const p = normalizePlatformKey(platform);
              if (!p) continue;
              assertDailyExecutionIdentityNotMutated({
                source_execution: { content_type: item.contentType, platform: p, topic: item.topicTitle },
                candidate: { content_type: item.contentType, platform: p, topic: item.topicTitle },
                stage: 'daily-build',
              });
              assertDailyGlobalProgressionNotMutated({
                source_global_progression_index: item.globalProgressionIndex,
                candidate: { global_progression_index: item.globalProgressionIndex },
                stage: 'daily-build',
              });
            }
            assertDailyIntentNotMutated({
              sourceIntent: execIntent,
              dailyItem: item,
              candidate: {
                objective: item.dailyObjective,
                target_audience: item.whoAreWeWritingFor,
                cta_type: item.ctaType,
                brief_summary: item.briefSummary,
                writer_brief: item.writerBrief,
              },
              stage: 'daily-build',
            });
            dailyItemsDeterministic.push(item);
            dayTopics[dayIndex - 1] = Array.from(new Set([...(dayTopics[dayIndex - 1] ?? []), topicTitle]));
          }
        }
      }
    }

    await supabase
      .from('daily_content_plans')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('week_number', weekNumber);

    const finalItems = dailyItemsDeterministic;
    const validation = { ok: true, errors: [] as string[] };

    const rowsWithContent: Array<{ row: any; contentObj: any }> = [];
    // Phase 1 — campaign design-system template pool, loaded ONCE per run. When the
    // campaign has a pinned collection (multiple templates per asset family), each
    // creator piece below picks its best-fit template from this pool. Null ⇒ no
    // design system pinned ⇒ generation is byte-identical to today.
    const campaignTemplatePool: CampaignTemplatePool | null = await loadCampaignTemplatePool(String(campaignId));
    let executionValidationItems: any[] = [];
    const autoRebalanceEffective = useExecutionItems ? false : autoRebalance;
    const autoOptimizeDistributionEffective = useExecutionItems ? false : autoOptimizeDistribution;
    // Per-platform counter so each platform rotates through its own best_days list
    // (LinkedIn → Tue/Wed/Thu, Instagram → Wed/Fri/Sun, X → Tue/Thu, …) instead of
    // every platform clustering on item.dayIndex (which effectively picked Monday
    // for every post under sharing ON).
    const platformDayCursor = new Map<string, number>();
    // Scheduling-integrity guards for this week: at most ONE piece per platform per
    // day, and NO duplicate content on the same platform (drop repeats).
    const usedDatesByPlatform = new Map<string, Set<string>>();
    const usedContentByPlatform = new Map<string, Set<string>>();

    for (const item of finalItems) {
      const fallbackDayName = DAYS_OF_WEEK[item.dayIndex - 1] ?? 'Monday';
      const fallbackDate = computeDayDate({
        campaignStart: String(effectiveStartDate),
        weekNumber,
        dayIndex: item.dayIndex,
      });
      const platforms = Array.isArray(item.platformTargets) && item.platformTargets.length > 0
        ? item.platformTargets
        : useExecutionItems
          ? []
          : getDefaultPlatformTargets(weekBlueprint as any);
      if (useExecutionItems && platforms.length === 0) {
        plannerTrace.drop({ content_type: String(item.contentType || 'unknown'), platform: null, reason: 'zero_platforms', stage: 'structure_generation', detail: 'execution item resolved to no platform targets' });
        continue;
      }

      for (const platform of platforms) {
        // Platform-aware day placement. Each platform tracks how many posts we've
        // assigned it this week, and we pick the nth entry from that platform's
        // research-backed best_days list (falls back to Tue/Wed/Thu when unknown).
        const platformKey = normalizePlatformKey(platform);

        // Rule: no duplicate content on the same platform — drop the repeat.
        const contentKey = `${String(item.contentType || 'post').toLowerCase()}::${normalizeTopicKey(String(item.topicTitle || ''))}`;
        const usedContent = usedContentByPlatform.get(platformKey) ?? new Set<string>();
        if (usedContent.has(contentKey)) {
          console.log('[weekly-structure][skip-duplicate-platform-content]', { platform: platformKey, contentKey });
          plannerTrace.drop({ content_type: String(item.contentType || 'post'), platform: platformKey, reason: 'duplicate_platform_content', stage: 'structure_generation', detail: `already used ${contentKey} on ${platformKey}` });
          continue;
        }

        const usedDates = usedDatesByPlatform.get(platformKey)
          ?? new Set<string>(conflictPolicy === 'override' ? [] : existingScheduledByPlatform.get(platformKey) ?? []);
        const nth = platformDayCursor.get(platformKey) ?? 0;
        let dayName: string = fallbackDayName;
        let date: string = fallbackDate;
        try {
          const dayIdx = await pickPlatformDayIndex(platformKey, nth);
          dayName = DAYS_OF_WEEK[dayIdx - 1] ?? fallbackDayName;
          date = computeDayDate({
            campaignStart: String(effectiveStartDate),
            weekNumber,
            dayIndex: dayIdx,
          });
        } catch {
          // fall back to item.dayIndex on any lookup failure
        }
        platformDayCursor.set(platformKey, nth + 1);
        // Rule: at most one piece per platform per day — if this platform already
        // has a post on `date`, shift to the next free weekday in the week.
        if (usedDates.has(date)) {
          let moved = false;
          for (let di = 1; di <= 7; di += 1) {
            const candidate = computeDayDate({ campaignStart: String(effectiveStartDate), weekNumber, dayIndex: di });
            if (!usedDates.has(candidate)) {
              date = candidate;
              dayName = DAYS_OF_WEEK[di - 1] ?? dayName;
              moved = true;
              break;
            }
          }
          // 'skip' policy: if no free day exists this week, drop the piece rather
          // than double-booking the platform on a day.
          if (!moved && conflictPolicy === 'skip') {
            console.log('[weekly-structure][skip-conflict-no-free-day]', { platform: platformKey, date });
            plannerTrace.drop({ content_type: String(item.contentType || 'post'), platform: platformKey, reason: 'schedule_conflict', stage: 'scheduling', detail: `no free day on ${platformKey} (conflict_policy=skip)` });
            continue;
          }
        }
        usedDates.add(date);
        usedDatesByPlatform.set(platformKey, usedDates);
        usedContent.add(contentKey);
        usedContentByPlatform.set(platformKey, usedContent);
        const identitySource = {
          content_type: String(item.contentType || 'post'),
          platform: normalizePlatformKey(platform),
          topic: String(item.topicTitle || ''),
        };
        const writerReady = {
          content_type: identitySource.content_type,
          platform: identitySource.platform,
          topic: identitySource.topic,
          brief_summary: (item as any).briefSummary,
          target_audience: item.whoAreWeWritingFor,
          objective: item.dailyObjective,
          cta_type: item.ctaType,
          global_progression_index: item.globalProgressionIndex,
          writer_brief: (item as any).writerBrief ?? null,
        };
        assertDailyExecutionIdentityNotMutated({
          source_execution: identitySource,
          candidate: writerReady,
          stage: 'writer-ready',
        });
        assertDailyGlobalProgressionNotMutated({
          source_global_progression_index: item.globalProgressionIndex,
          candidate: writerReady,
          stage: 'writer-ready',
        });
        assertDailyIntentNotMutated({
          sourceIntent: (item as any).writerBrief,
          dailyItem: item,
          candidate: writerReady,
          stage: 'writer-ready',
        });
        const executionBase = {
          ...item,
          ...writerReady,
          platform: writerReady.platform,
          contentType: writerReady.content_type,
        } as any;

        let validated = await validateDailyItemAgainstPlatformRules(executionBase);
        assertDailyExecutionIdentityNotMutated({
          source_execution: identitySource,
          candidate: validated?.dailyItem,
          stage: 'post-validate',
        });
        assertDailyGlobalProgressionNotMutated({
          source_global_progression_index: item.globalProgressionIndex,
          candidate: validated?.dailyItem,
          stage: 'post-validate',
        });
        assertDailyIntentNotMutated({
          sourceIntent: (item as any).writerBrief,
          dailyItem: item,
          candidate: validated?.dailyItem,
          stage: 'post-validate',
        });

        if (autoRebalanceEffective && validated.validation_status === 'invalid') {
          try {
            const bundle = await getPlatformRules(executionBase.platform);
            const supported = (bundle?.content_rules || [])
              .map((r: any) => String(r?.content_type || '').toLowerCase().trim())
              .filter(Boolean);
            const preferred =
              supported.includes('post')
                ? 'post'
                : supported.includes('tweet')
                  ? 'tweet'
                  : supported.sort()[0];

            if (preferred) {
              validated = await validateDailyItemAgainstPlatformRules({
                ...executionBase,
                contentType: preferred,
              });
              (validated.dailyItem as any).validation_notes = [
                ...(validated.dailyItem as any).validation_notes || [],
                `auto_rebalance: reassigned unsupported contentType to "${preferred}"`,
              ];
              (validated.dailyItem as any).validation_status =
                validated.validation_status === 'invalid' ? 'invalid' : 'adjusted';
            }
          } catch {
            // fail-soft: keep invalid status
          }
        }

        if (autoRebalanceEffective && validated.validation_status === 'invalid') {
          // Reduce invalid items automatically by not persisting them.
          executionValidationItems.push(validated.dailyItem);
          continue;
        }

        const enriched = await enrichDailyItemWithPlatformRequirements(validated.dailyItem as any);
        if ((item as any).masterContentId != null) {
          (enriched as any).master_content_id = (item as any).masterContentId;
        }
        stampMasterIdea(enriched as any, String(campaignId), weekNumber, weekBlueprint, item);
        const creator_card = buildCreatorCard(weekBlueprint as any, item, enriched);
        if (Object.keys(creator_card).length > 0) {
          (enriched as any).creator_card = creator_card;
        }
        assertDailyExecutionIdentityNotMutated({
          source_execution: identitySource,
          candidate: enriched,
          stage: 'post-enrich',
        });
        assertDailyGlobalProgressionNotMutated({
          source_global_progression_index: item.globalProgressionIndex,
          candidate: enriched,
          stage: 'post-enrich',
        });
        assertDailyIntentNotMutated({
          sourceIntent: (item as any).writerBrief,
          dailyItem: item,
          candidate: enriched,
          stage: 'post-enrich',
        });
        executionValidationItems.push(enriched);

        // Use the ORIGINAL content type from the execution item (poll, short_story, etc.)
        // not the validator's mapped type (which maps poll→post for platform constraints).
        // daily_content_plans.content_type must preserve the user's selected format
        // so the block processor generates format-appropriate content.
        const contentType = String(item.contentType || 'post');
        const normalizedContentType = contentType.toLowerCase().trim();
        // intent_type='creator' is enforced by daily_content_plans_creator_capability_check,
        // which requires asset_type ∈ (image | carousel | video | post_with_asset) per platform.
        // Only ai_renderable formats resolve to a non-null asset_type, so guidance-only
        // formats (video/reel/short/podcast) must NOT be tagged creator — they live in the
        // daily-plan / human-production lane. Renderable image/carousel-family formats
        // are the ones that can pass the constraint.
        // Centralized routing decision (Phase-2 Step-2). Byte-equivalent to
        // the former hard-coded ['carousel','image','story','banner',
        // 'infographic','pdf','slider'] list — video/reel/short remain
        // excluded (human-production lane), preserving the constraint design.
        const requiresMediaIntent = routeRequiresMediaIntent(normalizedContentType);
        const execCategory = getExecutionCategoryForContentType(contentType);
        const aiGenerated = executionCategoryToAiGenerated(execCategory);

        // Research-backed posting time per platform (from platform_rules).
        // Falls back to a built-in map (LinkedIn 09:00, Facebook 13:00, Instagram 19:00,
        // X 12:00, etc.) when the row isn't in the table, so posts no longer cluster
        // at 09:00 UTC for every platform.
        const platformScheduledTime = await getPlatformBestTime(platform);

        const creatorCardForRow: Record<string, unknown> | null =
          (enriched as any)?.creator_card && typeof (enriched as any).creator_card === 'object'
            ? {
                ...((enriched as any).creator_card as Record<string, unknown>),
                mode: 'explicit_creator_control',
              }
            : null;
        if (creatorCardForRow) {
          (enriched as any).creator_card = creatorCardForRow;
        }
        const creativeGuidance = buildCreativeGuidance({
          week: weekBlueprint as any,
          item,
          enrichedItem: enriched,
          creatorCard: creatorCardForRow as any,
        });
        if (creativeGuidance) {
          (enriched as any).creative_guidance = creativeGuidance;
        }
        let derivedAssetType: string | null = null;
        if (requiresMediaIntent) {
          try {
            derivedAssetType = deriveCreatorAssetTypeFromIntent({
              contentType: normalizedContentType,
              targetPlatforms: [normalizePlatformKey(platform)],
            });
          } catch {
            derivedAssetType = null;
          }
        }
        let rowAssetType: string | null = requiresMediaIntent
          ? (
              typeof creatorCardForRow?.asset_type === 'string' && creatorCardForRow.asset_type.trim()
                ? creatorCardForRow.asset_type.trim()
                : derivedAssetType
            )
          : null;
        // Asset-type resolution for visual formats (image / banner /
        // carousel / infographic / story / pdf / slider — note video /
        // reel / short are NOT requiresMediaIntent, so they already take
        // the text lane, which is the accepted behavior for video).
        //
        // 1. If the requested visual is renderable on this platform
        //    (e.g. instagram + image|carousel|video) → keep it: we create
        //    that exact content type.
        // 2. If it is NOT renderable as a standalone visual on this
        //    platform (e.g. youtube + carousel/image, or a null/unknown
        //    derived type) → DON'T drop to plain text. Combine text with
        //    the asset via `post_with_asset` — the same model as BOLT
        //    Text "add asset" — as long as the platform supports it
        //    (the DB capability table allows post_with_asset on every
        //    creator platform). The caption_blueprint payload stub for
        //    post_with_asset is built by the per-asset_type switch below,
        //    so the row still passes both creator CHECK constraints.
        // 3. Only fall back to the pure 'text' lane if the platform
        //    supports neither the visual nor post_with_asset (unknown
        //    platform) — keeps the daily-plans batch from rolling back.
        if (
          requiresMediaIntent &&
          !isValidCreatorPlatformAssetCombo(platform, rowAssetType) &&
          isValidCreatorPlatformAssetCombo(platform, 'post_with_asset')
        ) {
          rowAssetType = 'post_with_asset';
        }
        const creatorComboValid = requiresMediaIntent && isValidCreatorPlatformAssetCombo(platform, rowAssetType);
        // Resolved template for THIS row: a card-stamped template wins; else the
        // campaign design-system per-piece selection (computed in the creator block
        // below). Null when no template applies — stamped onto the row at build.
        let resolvedTemplateId: string | null = null;
        // Satisfy `daily_content_plans_creator_payload_check`. The deployed
        // function is significantly stricter than its initial migration
        // header suggested — it requires:
        //   packaging.caption, .hashtags (array), .meta_description,
        //                .keywords (array), .cta
        //   asset_payload — shape varies by asset_type:
        //     image            → { visual_descriptor: object }
        //     carousel         → { slides: array }
        //     video            → { scenes: array }
        //     post_with_asset  → { caption_blueprint: object }
        //   asset_instruction (object)
        //
        // The creator-asset-generation stage replaces these stubs with
        // real values later; here we just produce the minimum well-typed
        // structure so the row passes the CHECK at insert time. We only
        // OVERWRITE keys that aren't already populated — if a real value
        // is already present, it wins.
        if (creatorComboValid) {
          const e = enriched as Record<string, unknown>;
          e.intent_type = 'creator';
          if (rowAssetType) e.asset_type = rowAssetType;

          // ── Marketing-text packaging ──────────────────────────────────
          // Creator campaigns need BOTH the visual asset AND the
          // marketing copy that ships with it (caption, hashtags,
          // keywords, meta description, CTA) — the same way BOLT Text
          // produces platform-ready text. We don't make a fresh AI call
          // here: `creatorCardForRow` already carries summary / hashtags
          // / keywords / seo_focus (built by buildCreatorCard via the
          // same deriveHashtags/deriveKeywords helpers BOLT Text uses),
          // so we project those into the packaging shape. Any value the
          // creator-asset-generation stage later produces overrides
          // these (existingPackaging spread wins last).
          const cc = (creatorCardForRow ?? {}) as Record<string, unknown>;
          const ccIntent = (cc.intent && typeof cc.intent === 'object' ? cc.intent : {}) as Record<string, unknown>;
          const topicForCopy = String(item.topicTitle || (enriched as any)?.topic || '').trim();
          const objectiveForCopy = String(item.dailyObjective || (enriched as any)?.objective || '').trim();

          // ── Step-4 feature-flagged Creator cutover (image/carousel) ──
          // The SINGLE adapter entry point, shared verbatim with the
          // auto-optimize branch below — no duplicate adapter wiring.
          // Returns false (⇒ the legacy inline path runs byte-identically)
          // unless ENABLE_CREATOR_BLUEPRINT_ADAPTERS is ON and the
          // asset_type is image|carousel. Existing non-empty packaging
          // still wins inside the helper (precedence preserved).
          // Shared pure seeds — built ONCE, fed to BOTH the Step-7
          // planning entry point and the Step-4 adapter fallback so the
          // two never drift.
          const creatorContextSeeds = {
            topic: topicForCopy || String(item.topicTitle || ''),
            objective: objectiveForCopy,
            contentType: normalizedContentType,
            platforms: [normalizePlatformKey(platform)],
            campaignTheme: String(
              (enriched as any)?.campaign_theme || item.topicReference || topicForCopy || '',
            ),
            creativeObjective:
              (typeof item.briefSummary === 'string' && item.briefSummary.trim())
              || (typeof cc.seo_focus === 'string' && cc.seo_focus.trim())
              || objectiveForCopy
              || '',
            coreMessage:
              (typeof cc.summary === 'string' && cc.summary.trim())
              || (typeof item.briefSummary === 'string' && item.briefSummary.trim())
              || topicForCopy
              || '',
            tone: String(item.narrativeStyle || ''),
            cta:
              (typeof item.desiredAction === 'string' && item.desiredAction.trim())
              || (typeof ccIntent.cta_type === 'string' && (ccIntent.cta_type as string).trim())
              || (typeof item.ctaType === 'string' && item.ctaType.trim())
              || 'Learn more',
            distributionMode: 'unique' as const,
            continuityContext: { campaign_id: campaignId, week_index: weekNumber },
          };

          // Phase 1 — per-piece template selection from the campaign's pinned
          // collection. A card-stamped template wins; otherwise pick the best-fit
          // template for THIS piece's context. No pool / no family coverage ⇒
          // resolvedTemplateId stays null and the row is stamped null as before.
          resolvedTemplateId =
            typeof creatorCardForRow?.template_id === 'string' && creatorCardForRow.template_id.trim()
              ? creatorCardForRow.template_id.trim()
              : null;
          if (!resolvedTemplateId && campaignTemplatePool) {
            const assetFamily = familyForCreatorType(rowAssetType);
            if (assetFamily) {
              const picked = selectTemplateFromPool(campaignTemplatePool, assetFamily, {
                assetFamily,
                contentType: normalizedContentType,
                objective: objectiveForCopy || null,
                platform: normalizePlatformKey(platform),
                audience: String(item.whoAreWeWritingFor || '') || null,
              });
              if (picked) resolvedTemplateId = picked.templateId;
            }
          }

          // Step-7 planning hierarchy takes precedence. When ON +
          // image/carousel it builds a CreatorBlueprintCard, expands it,
          // and stamps ONLY toSchedulerRow(task) — no strategic leakage.
          // reel/video return false here (tagged requires_human_production)
          // so the existing human-production lane is untouched. When the
          // planning flag is OFF it returns false and the Step-4 adapter
          // helper runs exactly as before (backward compatible).
          const planningHandled = applyCreatorPlanningFlow({
            enriched: e,
            assetType: rowAssetType,
            platform: normalizePlatformKey(platform),
            weekIndex: weekNumber,
            context: creatorContextSeeds,
          });

          const adapterHandled = planningHandled || applyCreatorBlueprint({
            enriched: e,
            assetType: rowAssetType,
            platform: normalizePlatformKey(platform),
            context: creatorContextSeeds,
          });

          // Legacy inline construction — unchanged; runs only when the
          // adapter path did NOT handle this row (flag OFF, or a
          // non-image/carousel asset_type). Indentation kept as-is to
          // keep this a behavior-preserving guard, not a rewrite.
          if (!adapterHandled) {
          const derivedHashtags = Array.isArray(cc.hashtags) && cc.hashtags.length > 0
            ? (cc.hashtags as string[])
            : deriveHashtags(topicForCopy, normalizedContentType, objectiveForCopy);
          const derivedKeywords = Array.isArray(cc.keywords) && cc.keywords.length > 0
            ? (cc.keywords as string[])
            : deriveKeywords(topicForCopy, objectiveForCopy);
          const captionSeed =
            (typeof cc.summary === 'string' && cc.summary.trim())
              || (typeof item.briefSummary === 'string' && item.briefSummary.trim())
              || topicForCopy
              || '';
          const metaSeed =
            (typeof item.briefSummary === 'string' && item.briefSummary.trim())
              || (typeof cc.seo_focus === 'string' && cc.seo_focus.trim())
              || (typeof cc.summary === 'string' && cc.summary.trim())
              || topicForCopy
              || '';
          const ctaSeed =
            (typeof item.desiredAction === 'string' && item.desiredAction.trim())
              || (typeof ccIntent.cta_type === 'string' && (ccIntent.cta_type as string).trim())
              || (typeof item.ctaType === 'string' && item.ctaType.trim())
              || 'Learn more';

          const existingPackaging =
            e.packaging && typeof e.packaging === 'object' && !Array.isArray(e.packaging)
              ? (e.packaging as Record<string, unknown>)
              : {};
          // Spread existing FIRST so any non-marketing extras it carries
          // are preserved, then let the resolved marketing fields win.
          // Each resolved field already prefers a non-empty existing
          // value over the derived fallback, so a real value the
          // creator-asset stage produced is never downgraded.
          e.packaging = {
            ...existingPackaging,
            caption: typeof existingPackaging.caption === 'string' && existingPackaging.caption.trim()
              ? existingPackaging.caption
              : captionSeed,
            hashtags: Array.isArray(existingPackaging.hashtags) && existingPackaging.hashtags.length > 0
              ? existingPackaging.hashtags
              : derivedHashtags,
            meta_description: typeof existingPackaging.meta_description === 'string' && existingPackaging.meta_description.trim()
              ? existingPackaging.meta_description
              : metaSeed,
            keywords: Array.isArray(existingPackaging.keywords) && existingPackaging.keywords.length > 0
              ? existingPackaging.keywords
              : derivedKeywords,
            cta: typeof existingPackaging.cta === 'string' && existingPackaging.cta.trim()
              ? existingPackaging.cta
              : ctaSeed,
          };

          const existingPayload =
            e.asset_payload && typeof e.asset_payload === 'object' && !Array.isArray(e.asset_payload)
              ? (e.asset_payload as Record<string, unknown>)
              : {};
          if (rowAssetType === 'carousel') {
            e.asset_payload = { slides: Array.isArray(existingPayload.slides) ? existingPayload.slides : [], ...existingPayload };
          } else if (rowAssetType === 'image') {
            e.asset_payload = {
              visual_descriptor:
                existingPayload.visual_descriptor && typeof existingPayload.visual_descriptor === 'object' && !Array.isArray(existingPayload.visual_descriptor)
                  ? existingPayload.visual_descriptor
                  : {},
              ...existingPayload,
            };
          } else if (rowAssetType === 'video') {
            e.asset_payload = { scenes: Array.isArray(existingPayload.scenes) ? existingPayload.scenes : [], ...existingPayload };
          } else if (rowAssetType === 'post_with_asset' || rowAssetType === 'thread_with_asset') {
            e.asset_payload = {
              caption_blueprint:
                existingPayload.caption_blueprint && typeof existingPayload.caption_blueprint === 'object' && !Array.isArray(existingPayload.caption_blueprint)
                  ? existingPayload.caption_blueprint
                  : {},
              ...existingPayload,
            };
          } else {
            e.asset_payload = existingPayload;
          }

          if (typeof e.asset_instruction !== 'object' || e.asset_instruction === null || Array.isArray(e.asset_instruction)) {
            e.asset_instruction = (creatorCardForRow as Record<string, unknown>) ?? {};
          }
          } // end legacy inline construction (!adapterHandled)
        }
        const row = {
          campaign_id: campaignId,
          week_number: weekNumber,
          day_of_week: dayName,
          date,
          platform: normalizePlatformKey(platform),
          content_type: contentType,
          title: item.topicTitle,
          content: JSON.stringify(enriched),
          topic: item.topicTitle,
          objective: item.dailyObjective,
          intro_objective: item.whatShouldReaderLearn,
          summary: item.whatProblemAreWeAddressing,
          cta: item.desiredAction,
          brand_voice: item.narrativeStyle,
          format_notes: `${item.contentGuidance.primaryFormat}; max ${item.contentGuidance.maxWordTarget} words; highest limit: ${item.contentGuidance.platformWithHighestLimit}`,
          scheduled_time: platformScheduledTime,
          posting_strategy: `Week ${weekNumber} Day ${item.dayIndex} — ${item.topicReference}`,
          status: 'planned',
          priority: 'medium',
          ai_generated: aiGenerated,
          target_audience: item.whoAreWeWritingFor,
          intent_type: creatorComboValid ? 'creator' : 'text',
          asset_type: creatorComboValid ? rowAssetType : null,
          template_id: creatorComboValid ? resolvedTemplateId : null,
          plan_version: currentPlanVersion,
          retry_count: 0,
          max_retries: 3,
          failure_reason: null,
          failure_type: null,
          content_status: creativeGuidance && ['video', 'reel', 'short', 'podcast'].includes(normalizedContentType)
            ? 'guidance_ready'
            : null,
        };
        rowsWithContent.push({ row, contentObj: enriched });
      }
    }

    let executionSummary = analyzeValidationResults(executionValidationItems);
    let recommendations = generatePlanningFeedback(executionSummary);
    let execution_feedback = {
      summary: executionSummary,
      recommendations,
    };

    // Historical awareness: compare against previous weeks' stored snapshots (best-effort).
    let history: Array<{ week_number: number; summary: any }> = [];
    try {
      const { data: prior, error } = await supabase
        .from('weekly_content_refinements')
        .select('week_number, content_plan')
        .eq('campaign_id', campaignId)
        .lt('week_number', weekNumber)
        .order('week_number', { ascending: true })
        .limit(12);
      if (!error && Array.isArray(prior)) {
        history = prior
          .map((row: any) => {
            const wp = Number(row.week_number);
            const plan = row.content_plan;
            const summary = plan?.execution_feedback?.summary ?? null;
            if (!Number.isFinite(wp) || !summary) return null;
            return { week_number: wp, summary };
          })
          .filter(Boolean) as any;
      }
    } catch {
      history = [];
    }
    let feedbackHistory = [
      ...history,
      { week_number: weekNumber, summary: executionSummary },
    ];

    let optimizationSummary = analyzeExecutionFeedback(feedbackHistory as any);
    const weeklyPlanForOptimization = {
      weekNumber,
      platform_allocation: (weekBlueprint as any)?.platform_allocation ?? {},
    };
    let strategy_adjustments = suggestPublishingStrategy(weeklyPlanForOptimization, optimizationSummary);
    let publishing_optimization = {
      summary: optimizationSummary,
      strategy_adjustments,
    };

    if (autoOptimizeDistributionEffective) {
      const reduced = new Set<string>(
        (strategy_adjustments.reduced_platforms || []).map((p) => normalizePlatformKey(p)).filter(Boolean)
      );
      const preferred = (strategy_adjustments.preferred_platforms || [])
        .map((p) => normalizePlatformKey(p))
        .filter(Boolean);
      const preferredPlatform = preferred[0] || 'linkedin';

      const optimizedRowsWithContent: Array<{ row: any; contentObj: any }> = [];
      const optimizedValidationItems: any[] = [];

      for (const entry of rowsWithContent) {
        const currentPlatform = normalizePlatformKey(entry.row.platform);
        if (!reduced.has(currentPlatform)) {
          optimizedRowsWithContent.push(entry);
          optimizedValidationItems.push(entry.contentObj);
          continue;
        }

        // Reassign reduced/unstable platforms to preferred platform.
        const reassignedBase = {
          ...(entry.contentObj || {}),
          platform: preferredPlatform,
          contentType: String((entry.contentObj as any)?.contentType || entry.row.content_type || 'post'),
        } as any;

        let validated = await validateDailyItemAgainstPlatformRules(reassignedBase);

      if (autoRebalanceEffective && validated.validation_status === 'invalid') {
          try {
            const bundle = await getPlatformRules(reassignedBase.platform);
            const supported = (bundle?.content_rules || [])
              .map((r: any) => String(r?.content_type || '').toLowerCase().trim())
              .filter(Boolean);
            const preferredType =
              supported.includes('post')
                ? 'post'
                : supported.includes('tweet')
                  ? 'tweet'
                  : supported.sort()[0];
            if (preferredType) {
              validated = await validateDailyItemAgainstPlatformRules({
                ...reassignedBase,
                contentType: preferredType,
              });
              (validated.dailyItem as any).validation_notes = [
                ...(validated.dailyItem as any).validation_notes || [],
                `auto_rebalance: reassigned unsupported contentType to "${preferredType}"`,
              ];
              (validated.dailyItem as any).validation_status =
                validated.validation_status === 'invalid' ? 'invalid' : 'adjusted';
            }
          } catch {
            // ignore
          }
        }

      if (validated.validation_status === 'invalid') {
          // Reduce invalid items automatically by dropping them under auto optimization.
          optimizedValidationItems.push(validated.dailyItem);
          continue;
        }

        const enriched = await enrichDailyItemWithPlatformRequirements(validated.dailyItem as any);
        (enriched as any).validation_notes = [
          ...((enriched as any).validation_notes || []),
          `auto_optimize_distribution: moved platform "${currentPlatform}" -> "${preferredPlatform}"`,
        ];
        (enriched as any).validation_status = (enriched as any).validation_status === 'invalid' ? 'invalid' : 'adjusted';
        if ((entry.contentObj as any)?.creator_card != null) {
          (enriched as any).creator_card = (entry.contentObj as any).creator_card;
        }
        if ((entry.contentObj as any)?.creative_guidance != null) {
          (enriched as any).creative_guidance = (entry.contentObj as any).creative_guidance;
        }
        // CAMPAIGN-IMPL-004: platform adaptation is a downstream transformation —
        // the Master Idea it derives from stays UNCHANGED. Carry the identity
        // bundle forward untouched rather than re-deriving it.
        for (const k of ['master_idea', 'variant', 'fingerprint', 'master_idea_version'] as const) {
          if ((entry.contentObj as any)?.[k] != null) (enriched as any)[k] = (entry.contentObj as any)[k];
        }

        // ── Carry-forward creator payload stub ────────────────────────────
        // The main row-building loop above stamps intent_type / asset_type /
        // asset_payload / packaging / asset_instruction onto `enriched` for
        // creator-intent rows so the DB-level
        // `daily_content_plans_creator_payload_check` constraint passes.
        // The auto-optimize branch builds a FRESH `enriched` here from
        // `enrichDailyItemWithPlatformRequirements` and stringifies it
        // — without those stubs the reassigned row's content JSON no
        // longer satisfies the constraint and the whole insert batch
        // rolls back with "Failed to save daily plans … violates
        // creator_payload_check". The row's intent_type column is
        // inherited from `entry.row` (which is `'creator'`), so the
        // constraint fires.
        //
        // Carry the structural fields from the ORIGINAL `entry.contentObj`
        // (which was correctly stamped upstream) onto the new `enriched`.
        // asset_type stays consistent because the inherited `entry.row`
        // still has the original platform-agnostic asset_type column.
        const originalContent = entry.contentObj as Record<string, unknown> | null;
        const inheritedIntentType = (entry.row as { intent_type?: unknown }).intent_type;
        if (inheritedIntentType === 'creator' && originalContent) {
          const e = enriched as Record<string, unknown>;
          e.intent_type = 'creator';
          if (originalContent.asset_type) e.asset_type = originalContent.asset_type;
          if (typeof e.asset_payload !== 'object' || e.asset_payload === null) {
            e.asset_payload = (originalContent.asset_payload as object) ?? {};
          }
          if (typeof e.packaging !== 'object' || e.packaging === null) {
            e.packaging = (originalContent.packaging as object) ?? {};
          }
          if (typeof e.asset_instruction !== 'object' || e.asset_instruction === null) {
            e.asset_instruction =
              (originalContent.asset_instruction as object) ??
              ((enriched as any).creator_card as object) ??
              {};
          }

          // ── Step-7/4: route through the SAME planning + adapter
          // helpers as the main loop (no branch divergence). Carry-
          // forward above is the legacy-parity baseline that keeps the
          // row constraint-valid (both flags OFF ⇒ nothing below
          // changes). Step-7 planning takes precedence for the
          // reassigned `preferredPlatform`; Step-4 adapter is the
          // fallback. Identical entry points, which is what eliminates
          // the prior branch-drift class of bug.
          const reassignedSeeds = {
            topic: String(entry.row.topic || entry.row.title || ''),
            objective: String(entry.row.objective || ''),
            contentType: String(entry.row.content_type || 'post'),
            platforms: [preferredPlatform],
            campaignTheme: String(entry.row.topic || entry.row.title || ''),
            creativeObjective: String(entry.row.objective || ''),
            coreMessage: String(entry.row.summary || entry.row.topic || ''),
            tone: String(entry.row.brand_voice || ''),
            cta: String(entry.row.cta || 'Learn more'),
            distributionMode: 'unique' as const,
            continuityContext: { campaign_id: campaignId, week_index: weekNumber },
          };
          const reassignPlanned = applyCreatorPlanningFlow({
            enriched: e,
            assetType: (originalContent.asset_type as string) ?? null,
            platform: preferredPlatform,
            weekIndex: weekNumber,
            context: reassignedSeeds,
          });
          if (!reassignPlanned && isCreatorBlueprintAdapterEnabled()) {
            applyCreatorBlueprint({
              enriched: e,
              assetType: (originalContent.asset_type as string) ?? null,
              platform: preferredPlatform,
              context: reassignedSeeds,
            });
          }
        }

        const nextRow = {
          ...entry.row,
          platform: preferredPlatform,
          content_type: entry.row.content_type || 'post', // preserve original content type, not validator's mapped type
          content: JSON.stringify(enriched),
        };
        optimizedRowsWithContent.push({ row: nextRow, contentObj: enriched });
        optimizedValidationItems.push(enriched);
      }

      // Recompute summaries after auto optimization is applied (one deterministic iteration).
      executionValidationItems = optimizedValidationItems;
      executionSummary = analyzeValidationResults(executionValidationItems);
      recommendations = generatePlanningFeedback(executionSummary);
      execution_feedback = { summary: executionSummary, recommendations };
      feedbackHistory = [...history, { week_number: weekNumber, summary: executionSummary }];
      optimizationSummary = analyzeExecutionFeedback(feedbackHistory as any);
      strategy_adjustments = suggestPublishingStrategy(weeklyPlanForOptimization, optimizationSummary);
      publishing_optimization = { summary: optimizationSummary, strategy_adjustments };

      // Overwrite rowsWithContent for persistence
      rowsWithContent.length = 0;
      rowsWithContent.push(...optimizedRowsWithContent);
    }

    if (enableCampaignWaves) {
      const stable = new Set<string>((publishing_optimization?.summary?.stable_platforms || []).map(normalizePlatformKey));
      const unstable = new Set<string>((publishing_optimization?.summary?.unstable_platforms || []).map(normalizePlatformKey));

      const waveItems = rowsWithContent.map(({ row }) => {
        const platform = normalizePlatformKey(row.platform);
        const stability = stable.has(platform) ? 'stable' : unstable.has(platform) ? 'unstable' : 'unknown';
        return {
          platform,
          topic: String(row.topic || row.title || ''),
          base_date: String(row.date || '').slice(0, 10),
          stability,
        } as const;
      });

      const waveSchedule = generatePlatformWaveSchedule(waveItems as any);

      for (const entry of rowsWithContent) {
        const platform = normalizePlatformKey(entry.row.platform);
        const base_date = String(entry.row.date || '').slice(0, 10);
        const topicKey = String(entry.row.topic || entry.row.title || '').trim();
        const groupKey =
          `${base_date}::${topicKey.toLowerCase().replace(/[^a-z0-9\\s]/g, ' ').replace(/\\s+/g, ' ').trim()}`;
        const lookupKey = `${groupKey}::${platform}`;
        const assignment = waveSchedule.get(lookupKey);
        if (!assignment) continue;

        const contentObj = entry.contentObj && typeof entry.contentObj === 'object' ? entry.contentObj : {};
        (contentObj as any).wave_info = {
          wave_group_id: assignment.wave_group_id,
          wave_order: assignment.wave_order,
          wave_offset_days: assignment.wave_offset_days,
        };
        entry.contentObj = contentObj;
        // Phase 1: Do not mutate schedule in daily layer. Date comes from weekly plan only.
        // entry.row.date = assignment.scheduled_date;
        entry.row.content = JSON.stringify(contentObj);
      }
    }

    const rows = rowsWithContent.map((r) => r.row);
    if (rows.length > 0) allRowsToInsert.push(...rows);

    lastTopicDayMap = dayTopics.map((topics, idx) => ({
      dayIndex: idx + 1,
      day: DAYS_OF_WEEK[idx],
      topics,
    }));
    lastValidation = validation;
    lastExecutionFeedback = execution_feedback;
    lastPublishingOptimization = publishing_optimization;
    lastAutoRebalanceEffective = autoRebalanceEffective;
    lastAutoOptimizeDistributionEffective = autoOptimizeDistributionEffective;
    allFinalItems.push(...finalItems);

    // Best-effort persistence into weekly plan JSON when weekly_content_refinements has content_plan.
    try {
      const { data: refinement, error: refinementError } = await supabase
        .from('weekly_content_refinements')
        .select('id, content_plan')
        .eq('campaign_id', campaignId)
        .eq('week_number', weekNumber)
        .maybeSingle();

      if (!refinementError && refinement?.id && (refinement as any).content_plan != null) {
        const existing = (refinement as any).content_plan && typeof (refinement as any).content_plan === 'object'
          ? (refinement as any).content_plan
          : {};
        const updated = { ...existing, execution_feedback, publishing_optimization };
        await supabase
          .from('weekly_content_refinements')
          .update({ content_plan: updated, updated_at: new Date().toISOString() } as any)
          .eq('id', refinement.id);
      }
    } catch (err) {
      console.warn('[execution_feedback] unable to persist into weekly_content_refinements.content_plan:', err);
    }
    }

  let plannerReconciliation: PlannerReconciliation | null = null;
  let campaignQuality: CampaignQualityAssessment | null = null;
  let campaignOptimization: OptimizationResult | null = null;
  let campaignValidation: CampaignValidationLanes | null = null;
  if (allRowsToInsert.length > 0) {
    const { saveWeekPlans } = await import('../../../backend/services/executionPlannerService');
    // Phase-2 Step-11: FIRST real generator cutover. Mode-gated source
    // selection — SHADOW (default) returns legacy rows unchanged + diffs;
    // AUTHORITATIVE returns the authoritative weekly rows when the rollback
    // guard passes, else falls back to legacy. Never throws.
    let persistRows: typeof allRowsToInsert = allRowsToInsert;
    try {
      const { resolveWeeklyRowsForPersistence } = await import('../../../backend/services/orchestration');
      persistRows = await resolveWeeklyRowsForPersistence(campaignId, allRowsToInsert) as typeof allRowsToInsert;
      if (!Array.isArray(persistRows) || persistRows.length === 0) persistRows = allRowsToInsert;
    } catch { persistRows = allRowsToInsert; }

    // ── Closure-pass follow-up: row-level validation + diagnostics ────
    // Policy here is SKIP-AND-RECORD. Reason: the planner has already
    // produced these rows; aborting the stage at this point would change
    // generation behavior for rows that historically would have shipped.
    // Instead we record any anomalies into bolt_row_failure_diagnostics
    // (when a BOLT run id is in scope) and let the valid rows persist.
    // The dashboard's row-failure rollup makes silent skips visible.
    //
    // The validator is purely structural (platform present, content_type
    // in registry, week_number integer, CTA warning-class) so a properly-
    // generated row never trips it. The wiring is a safety net.
    const boltRunId = (body.variantMetadata as Record<string, unknown> | undefined)?.runId;
    const diagnosticRecords: RowFailureRecord[] = [];
    const validatedPersistRows: typeof persistRows = [];
    for (const row of persistRows) {
      const r = validateDailyPlanRow(row as any);
      if (r.ok) {
        validatedPersistRows.push(row);
        continue;
      }
      // CTA-only failures are warning-class — the row still persists, but
      // we record the diagnostic so operators see the gap on the dashboard.
      const hardErrors = r.errors.filter((e) => e.code !== BOLT_ERROR_CODES.DAILY_PLAN_INVALID_CTA);
      const shouldKeep = hardErrors.length === 0;
      if (shouldKeep) validatedPersistRows.push(row);

      if (typeof boltRunId === 'string' && boltRunId) {
        const rowAny = row as Record<string, unknown>;
        for (const e of r.errors) {
          diagnosticRecords.push({
            runId: boltRunId,
            campaignId,
            companyId: companyId ?? null,
            weekNumber: typeof rowAny.week_number === 'number' ? rowAny.week_number : null,
            platform: typeof rowAny.platform === 'string' ? rowAny.platform : null,
            contentType: typeof rowAny.content_type === 'string' ? rowAny.content_type : null,
            stage: 'generate-weekly-structure',
            code: e.code,
            message: e.message,
            field: e.field,
            details: { skipped: !shouldKeep && e.code !== BOLT_ERROR_CODES.DAILY_PLAN_INVALID_CTA },
          });
        }
      }
    }
    if (diagnosticRecords.length > 0) {
      // Fire-and-forget batch write. recordRowFailureBatch never throws
      // and never blocks the caller — diagnostics persistence is a
      // best-effort observability channel, not part of the generation
      // contract. We await so logs surface inline; the inner try/catch
      // in the batch writer makes this safe.
      await recordRowFailureBatch(diagnosticRecords);
    }
    persistRows = validatedPersistRows;
    if (persistRows.length === 0) {
      // All rows were rejected. Don't proceed to saveWeekPlans with an
      // empty batch — would be a no-op that masks the failure. Throw the
      // canonical BoltError so the per-stage catch in boltPipelineService
      // records a run-level failure too.
      throw new BoltError(
        BOLT_ERROR_CODES.DAILY_PLAN_ROW_INVALID,
        `All ${allRowsToInsert.length} generated rows failed validation. See bolt_row_failure_diagnostics for details.`,
        { details: { rejected_count: allRowsToInsert.length, sample_run_id: boltRunId ?? null } }
      );
    }
    // ── CAMPAIGN-IMPL-006: pre-generation strategy optimization ────────────
    // Deterministically rebalance the PLAN's strategic metadata (theme, buyer-
    // journey stage, CTA, audience, Master-Idea grouping) to raise campaign
    // quality BEFORE the block-processor generates content — applied to the
    // additive Master-Idea block only, so structure/schedule/format mix stay
    // invariant. Advisory-safe: fail-safe, and it only keeps score-improving
    // changes. Runs before saveWeekPlans so the persisted plan carries the
    // refinement.
    try {
      const preAssets = (persistRows as any[]).map(toPlannedAsset);
      campaignOptimization = optimizeCampaign(preAssets, { maxPasses: DEFAULT_MAX_OPTIMIZATION_PASSES });
      // CAMPAIGN-OPS-001: Optimization Engine metrics (before/after/delta/passes/changes).
      emitOptimizationMetrics(campaignOptimization, { mode: 'weekly' });
      if (campaignOptimization.improved) {
        campaignOptimization.assets.forEach((opt, i) => applyOptimizationToRow((persistRows as any[])[i], opt));
        if (process.env.NODE_ENV !== 'test') {
          console.log('[campaign-optimization]', { campaignId, before: campaignOptimization.before.overall, after: campaignOptimization.after.overall, changes: campaignOptimization.changes.length, passes: campaignOptimization.passes_run });
        }
      }
    } catch { /* optimization is advisory + metadata-only — never block generation */ }

    const byWeek = new Map<number, typeof persistRows>();
    for (const row of persistRows) {
      const wn = Number((row as { week_number?: number })?.week_number) || 1;
      if (!byWeek.has(wn)) byWeek.set(wn, []);
      byWeek.get(wn)!.push(row);
    }
    for (const [wn, rows] of byWeek) {
      await saveWeekPlans(campaignId, wn, rows as any, 'blueprint');
    }
    if (process.env.NODE_ENV !== 'test') {
      console.log('[EXECUTION_ENGINE] source=blueprint saveWeekPlans completed', { campaignId, weeks: [...byWeek.keys()], totalRows: persistRows.length });
    }
    // Phase-2 Step-3: non-destructive canonical reconcile + invariant pass
    // AFTER persistence (does NOT replace these inserts — compatibility-first).
    try {
      const orch = await import('../../../backend/services/orchestration');
      void orch.reconcileExecution(campaignId, 'generate-weekly-structure').catch(() => {});
      // Phase-2 Step-10: authoritative activation gate (shadow + decision +
      // output diff + rollback). Default SHADOW ⇒ decision is non-binding,
      // behaviour unchanged; AUTHORITATIVE (env opt-in) records the binding
      // decision + rolls back to legacy on incomplete context.
      void orch.runAuthoritativeGenerationGate(campaignId, 'generate-weekly-structure').catch(() => {});
      // Phase-2 Step-13: authoritative DAILY engine — SHADOW (default)
      // computes day-addressable execution cards from the orchestration
      // context and diffs vs the persisted count; non-binding, behaviour
      // unchanged. AUTHORITATIVE (env opt-in) makes the daily plan available
      // with rollback on regression.
      void orch.evaluateAuthoritativeDaily(campaignId, persistRows.length).catch(() => {});
    } catch { /* observability only — never blocks generation */ }

    // ── CAMPAIGN-IMPL-005: advisory pre-generation quality assessment ──────
    // Score the PLANNED campaign (structure built, AI content not yet generated)
    // across nine strategic dimensions. Advisory only — returned in the response,
    // never gating or altering generation. Fail-safe.
    try {
      const plannedAssets = (persistRows as any[]).map(toPlannedAsset);
      campaignQuality = assessCampaignQuality(plannedAssets);
      // CAMPAIGN-OPS-001: Quality Engine metrics (score / grade / per-dimension).
      emitQualityMetrics(campaignQuality, { mode: 'weekly' });
      if (process.env.NODE_ENV !== 'test') {
        console.log('[campaign-quality]', { campaignId, overall: campaignQuality.overall, grade: campaignQuality.grade, recommendations: campaignQuality.recommendations.length });
      }
    } catch { /* advisory only — never block generation */ }

    // ── CAMPAIGN-IMPL-007: pre-generation semantic-validation preview ──────
    // The full content-level gate runs later in the block-processor (captions
    // don't exist yet here). This preview validates the IDEA-level dimensions
    // already available on the plan (semantic idea / headline / CTA / master-idea
    // consistency / cross-platform) so the planner diagnostics can show
    // Generated / Validated / Regenerated / Accepted / Dropped. Advisory, fail-safe.
    try {
      const vctx = new ValidationContext();
      const combined = emptyValidationStats();
      const textLane = emptyValidationStats();
      const creatorLane = emptyValidationStats();
      const CREATOR_TYPES = new Set(['carousel', 'infographic', 'image', 'banner', 'video', 'reel', 'short', 'story', 'slider', 'pdf', 'quote_card']);
      for (const row of persistRows as any[]) {
        const pa = toPlannedAsset(row);
        const genAsset: GeneratedAsset = {
          content_type: pa.content_type,
          platform: String(pa.platform ?? ''),
          text: String(pa.topic_title ?? ''),
          headline: pa.topic_title ?? null,
          cta: pa.cta ?? null,
          idea_fingerprint: pa.idea_fingerprint ?? null,
          narrative_fingerprint: pa.narrative_fingerprint ?? null,
          master_idea_id: pa.master_idea_id ?? null,
        };
        const vr = validateAsset(genAsset, vctx, { flagCrossPlatform: false });
        const isCreator = String(row?.intent_type ?? '').toLowerCase() === 'creator' || CREATOR_TYPES.has(String(pa.content_type).toLowerCase());
        tallyValidation(isCreator ? creatorLane : textLane, vr);
        tallyValidation(combined, vr);
        if (vr.decision === 'ACCEPT' || vr.decision === 'ADAPT') vctx.commit(genAsset);
      }
      campaignValidation = { combined, text: textLane, creator: creatorLane };
    } catch { /* preview only — never block generation */ }

    // ── CAMPAIGN-IMPL-002: planner-integrity reconciliation ────────────────
    // Invariant: planned === generated + dropped.length. Diff the user's
    // selection (rawFormatFrequency × weeks) against the persisted rows and
    // attribute every shortfall with a structured reason + stage — nothing may
    // vanish silently. Only when the user supplied explicit per-format counts
    // (BOLT / Intelligent Mix); the AI-decides path has no fixed planned count.
    if (rawFormatFrequency && Object.keys(rawFormatFrequency).length > 0) {
      const dropped: DroppedItem[] = [];
      const weeksCount = Math.max(1, weekNumbers.length);
      const clampedFreq = formatFrequency ?? rawFormatFrequency;
      const perType = (ff: Record<string, number>, t: string) => Math.max(0, Math.round(Number(ff[t] ?? 0)));
      const candidatePlatforms = Array.isArray(eligiblePlatforms) && eligiblePlatforms.length > 0 ? eligiblePlatforms : [];
      const generatedByType = new Map<string, number>();
      for (const row of persistRows) {
        const ct = String((row as { content_type?: unknown }).content_type ?? '').toLowerCase().trim();
        if (ct) generatedByType.set(ct, (generatedByType.get(ct) ?? 0) + 1);
      }
      // CAMPAIGN-IMPL-003: prefer the REAL reason captured at the drop site over
      // the statistical guess. Per content_type, take the most-common structured
      // reason the trace recorded during generation, so a shortfall is explained
      // by what actually happened (duplicate / no-platform / conflict) instead of
      // a blanket inference.
      const capturedReasonByType = new Map<string, DropReasonCode>();
      {
        const perTypeReason = new Map<string, Map<DropReasonCode, number>>();
        for (const d of plannerTrace.getDrops()) {
          const t = String(d.content_type || '').toLowerCase().trim();
          if (!t) continue;
          const m = perTypeReason.get(t) ?? new Map<DropReasonCode, number>();
          m.set(d.reason, (m.get(d.reason) ?? 0) + 1);
          perTypeReason.set(t, m);
        }
        for (const [t, m] of perTypeReason) {
          const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
          if (best) capturedReasonByType.set(t, best[0]);
        }
      }
      let plannedTotal = 0;
      for (const type of Object.keys(rawFormatFrequency)) {
        plannedTotal += perType(rawFormatFrequency, type) * weeksCount;
        const generatedForType = generatedByType.get(type) ?? 0;
        const clampLost = Math.max(0, (perType(rawFormatFrequency, type) - perType(clampedFreq, type)) * weeksCount);
        for (let i = 0; i < clampLost; i += 1) dropped.push({ content_type: type, platform: null, reason: 'exceeds_limit', stage: 'structure_generation' });
        const shortfall = Math.max(0, perType(clampedFreq, type) * weeksCount - generatedForType);
        if (shortfall <= 0) continue;
        const eligible = candidatePlatforms.length > 0 ? filterPlatformsForFormat(candidatePlatforms, type) : null;
        const reason: DropReasonCode = capturedReasonByType.get(type.toLowerCase())
          ?? (eligible !== null && eligible.length === 0
            ? 'no_eligible_platform'
            : (generatedForType === 0 ? 'generation_failure' : 'duplicate_content'));
        for (let i = 0; i < shortfall; i += 1) dropped.push({ content_type: type, platform: eligible && eligible.length > 0 ? (eligible[0] ?? null) : null, reason, stage: 'structure_generation' });
      }
      const residual = plannedTotal - (persistRows.length + dropped.length);
      for (let i = 0; i < residual; i += 1) dropped.push({ content_type: 'unknown', platform: null, reason: 'unknown_error', stage: 'validation', detail: 'unattributed shortfall' });
      plannerReconciliation = buildReconciliation(plannedTotal, persistRows.length, dropped);
      assertPlannerInvariant(plannerReconciliation, (msg, meta) => console.warn(msg, meta));
      // Observability: route planner integrity + success into the HARDEN-001
      // registry (queryable via getObservabilitySnapshot), replacing standalone
      // logging. Fail-safe — never blocks generation.
      emitPlannerMetrics(plannerReconciliation, plannerTrace.getRegeneration(), { mode: 'weekly' });
      // Drive the lifecycle through this execution boundary: everything that
      // persisted reached GENERATED; everything dropped ended in DROPPED.
      emitLifecycleTransition('GENERATING', 'GENERATED', plannerReconciliation.generated, 'weekly');
      emitLifecycleTransition('ALLOCATED', 'DROPPED', plannerReconciliation.dropped.length, 'weekly');
      if (process.env.NODE_ENV !== 'test') {
        console.log('[weekly-structure][planner-reconciliation]', { planned: plannerReconciliation.planned, generated: plannerReconciliation.generated, dropped: plannerReconciliation.dropped.length, ok: plannerReconciliation.ok });
      }
    }
  }

  // CAMPAIGN-IMPL-003: assemble the explainable diagnostics payload. When the
  // reconciliation ran, enrich it with metrics + the captured drop events + a
  // UI-ready per-reason summary. When it did NOT run (AI-decides path, or a total
  // wipeout where no rows were produced) but the trace still captured drops,
  // surface those so a wipeout is never silent — planned is unknown there, so the
  // reconciliation baseline is 0/0 and the drop_events carry the "where + why".
  const capturedDrops = plannerTrace.getDrops();
  const buildSummary = (items: DroppedItem[]) =>
    summarizeDrops(items).map((s) => ({ ...s, public_reason: publicDropReason(s.reason) }));
  const plannerDiagnosticsPayload = plannerReconciliation
    ? {
        ...plannerReconciliation,
        metrics: computePlannerMetrics(plannerReconciliation, plannerTrace.getRegeneration()),
        drop_events: capturedDrops,
        drop_summary: buildSummary(plannerReconciliation.dropped),
      }
    : capturedDrops.length > 0
      ? (() => {
          const recon = buildReconciliation(0, 0, capturedDrops);
          return {
            ...recon,
            metrics: computePlannerMetrics(recon, plannerTrace.getRegeneration()),
            drop_events: capturedDrops,
            drop_summary: buildSummary(capturedDrops),
          };
        })()
      : null;

  // CAMPAIGN-OPS-001: emit campaign run duration + success on the reached-return path.
  emitCampaignRunMetrics({ durationMs: Date.now() - runStartedAt, success: true }, { mode: 'weekly' });

  return {
    success: true,
    planner_diagnostics: plannerDiagnosticsPayload,
    campaign_quality: campaignQuality,
    campaign_optimization: campaignOptimization,
    campaign_validation: campaignValidation,
    week: weekNumbers.length === 1 ? weekNumbers[0] : undefined,
    weeks: weekNumbers.length > 1 ? weekNumbers : undefined,
    dailyPlan: allFinalItems,
    topicDayMap: lastTopicDayMap,
    validation: lastValidation,
    planning_feedback: lastExecutionFeedback,
    execution_feedback: lastExecutionFeedback,
    publishing_optimization: lastPublishingOptimization,
    auto_rebalance: lastAutoRebalanceEffective,
    auto_optimize_distribution: lastAutoOptimizeDistributionEffective,
    enable_campaign_waves: enableCampaignWaves,
    message: weekNumbers.length === 1
      ? `Generated topic-aligned daily plan skeleton for Week ${weekNumbers[0]}`
      : `Generated topic-aligned daily plan skeleton for Weeks ${weekNumbers.join(', ')}`,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = await generateWeeklyStructure((req.body || {}) as GenerateWeeklyStructureInput);
    return res.status(200).json(result);
  } catch (error) {
    const err = error as { code?: string };
    if (err?.code === 'WEEK_EXECUTION_LOCKED') {
      return res.status(423).json({ error: 'WEEK_EXECUTION_LOCKED', message: 'Week is executing; regeneration blocked.' });
    }
    console.error('Error in generate weekly structure API:', error);
    const msg = error instanceof Error ? error.message : 'Internal server error';
    return res.status(500).json({ error: msg });
  }
}

// Removed legacy daily planning generator. Daily layer is execution-only.
