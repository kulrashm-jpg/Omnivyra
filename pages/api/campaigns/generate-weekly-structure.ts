import { getExecutionCategoryForContentType, executionCategoryToAiGenerated } from '../../../backend/services/plannerActivityCardService';
import { deriveCreatorAssetTypeFromIntent } from '../../../backend/services/creatorTemplateRegistryService';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

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
  } = body || {};
  // Only default to text-only when the adapter explicitly passes that setting.
  const boltTextOnly = boltTextOnlyBody != null ? Boolean(boltTextOnlyBody) : false;
  void variantMetadata;
    const eligiblePlatforms: string[] | undefined =
      Array.isArray(eligiblePlatformsBody) && eligiblePlatformsBody.length > 0
        ? eligiblePlatformsBody.map((p: unknown) => String(p).toLowerCase().replace(/^twitter$/i, 'x'))
        : undefined;
    const postsPerWeek: number | undefined =
      postsPerWeekBody != null && Number.isFinite(Number(postsPerWeekBody))
        ? Math.max(2, Math.min(20, Math.floor(Number(postsPerWeekBody))))  // raised 7→14→20 to support up to 20 activity cards/week
        : undefined;
  // Resolve format_frequency: Record<string, number> or null
  const formatFrequency: Record<string, number> | null =
    formatFrequencyBody && typeof formatFrequencyBody === 'object' && !Array.isArray(formatFrequencyBody)
      ? (formatFrequencyBody as Record<string, number>)
      : null;
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
    throw new Error('campaignId and week (or weeks array) are required');
  }

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
    throw new Error('Campaign start_date is required before generating daily plans');
  }
  // Ensure campaign object has start_date for downstream usage
  if (campaign) (campaign as { start_date: string }).start_date = effectiveStartDate;

  const blueprint = await getUnifiedCampaignBlueprint(String(campaignId));
  if (!blueprint?.weeks?.length) {
    throw new Error('Committed weekly blueprint not found');
  }
  for (const wn of weekNumbers) {
    const wb = blueprint.weeks.find((w) => Number(w.week_number) === wn);
    if (!wb) {
      throw new Error(`Week ${wn} not found in blueprint`);
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
        const selected_platforms = (selected_platforms_raw || [])
          .map((p: any) => normalizePlatformKey(String(p)))
          .filter(Boolean);
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

    // Synthesize execution_items from blueprint data when not present (BOLT campaigns, legacy campaigns).
    // This ensures daily distribution works even when the AI plan did not produce explicit execution_items.
    if (executionItems.length === 0) {
      const synthPlatforms = Object.keys(weekBlueprint.platform_allocation || {})
        .map(normalizePlatformKey)
        .filter(Boolean);
      const platforms = synthPlatforms.length > 0
        ? synthPlatforms
        : (eligiblePlatforms && eligiblePlatforms.length > 0 ? eligiblePlatforms.slice(0, 2) : ['linkedin']);
      // User's explicit format_frequency keys take precedence over AI-generated content_type_mix.
      // This ensures the distribution strictly honours what the user selected on the strategy page.
      const userFormats = formatFrequency && Object.keys(formatFrequency).length > 0
        ? Object.keys(formatFrequency).map((t) => t.trim().toLowerCase()).filter(Boolean)
        : null;
      const contentTypes = (
        userFormats ??
        (Array.isArray(weekBlueprint.content_type_mix) && weekBlueprint.content_type_mix.length > 0
          ? weekBlueprint.content_type_mix
          : ['post'])
      ).map((t) => String(t || '').trim().toLowerCase()).filter(Boolean);
      console.log('[generate-weekly-structure] content type resolution', {
        formatFrequency,
        userFormats,
        contentTypeMix: weekBlueprint.content_type_mix,
        resolvedContentTypes: contentTypes,
      });
      const totalCount = postsPerWeek ?? Math.max(
        2,
        Object.values(weekBlueprint.platform_allocation || {}).reduce((sum: number, n: unknown) => sum + Number(n), 0) || 3
      );
      // 1. Primary: topics_to_cover[] or topics[].topicTitle
      const rawTopics: string[] = Array.isArray(weekBlueprint.topics_to_cover) && (weekBlueprint.topics_to_cover as unknown[]).length > 0
        ? (weekBlueprint.topics_to_cover as unknown[]).map((t) => String(t ?? '').trim()).filter(Boolean)
        : Array.isArray(weekBlueprint.topics) && (weekBlueprint.topics as any[]).length > 0
          ? (weekBlueprint.topics as any[]).map((t: any) => String(t?.topicTitle ?? t ?? '').trim()).filter(Boolean)
          : [];

      // 2. Fallback: extract per-piece topics from platform_content_breakdown.
      //    BOLT AI populates these as ["(1) Topic A", "(2) Topic B"] per content item.
      //    Strip numeric prefixes like "(1) " so they read naturally.
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

      // Use most specific topic list available: topics_to_cover > platform_content_breakdown > phase_label
      const topics = rawTopics.length > 1
        ? rawTopics
        : rawTopics.length === 1 && pcdTopics.length > 0
          ? pcdTopics  // pcd gives more granularity than single topics_to_cover entry
          : rawTopics.length === 1
            ? rawTopics
            : pcdTopics.length > 0
              ? pcdTopics
              : [String(weekBlueprint.phase_label || weekBlueprint.primary_objective || `Week ${weekNumber} content`).trim()];

      const ctaType = String(weekBlueprint.cta_type || 'Engage').trim() || 'Engage';
      const objective = String(weekBlueprint.primary_objective || weekBlueprint.phase_label || 'Build brand awareness').trim() || 'Build brand awareness';
      const defaultCountPerType = Math.max(1, Math.round(totalCount / contentTypes.length));
      let synthGlobalIdx = (weekNumber - 1) * totalCount;
      // Use specific target audience from campaign context (built from execution_config.target_audience); fall back to generic
      const synthTargetAudience = compressedContext?.target_audience || 'our target audience';
      // Track a global topic index so different content types don't all start at topic 0
      let globalTopicIdx = 0;
      console.log('[weekly-structure][synth-topics]', {
        totalCount,
        topicsAvailable: topics.length,
        contentTypes,
        isRepeatedTopicTriggered: topics.length < totalCount,
        firstFewTopics: topics.slice(0, 4),
      });
      for (const contentType of contentTypes) {
        // Honour per-format frequency from user selection; fall back to equal distribution
        const countPerType = formatFrequency?.[contentType] != null
          ? Math.max(1, Math.round(Number(formatFrequency[contentType])))
          : defaultCountPerType;
        const topic_slots: Array<{ topic: string | null; global_progression_index: number; intent: any }> = [];
        for (let k = 0; k < countPerType; k++) {
          synthGlobalIdx++;
          // Each activity card must have a distinct title. When the same raw topic
          // is used across content types (e.g. "Brand Awareness" for both poll and
          // short_story), deriveSubTopic wraps it in a content-type-specific angle
          // so Poll #1, Story #1 get different titles like "Poll: what's your..." vs
          // "Short story: the day...". We ALWAYS apply deriveSubTopic since:
          //  (a) it's designed for this — each angle template is scoped by content_type
          //  (b) topics from the AI plan are usually theme-level, not per-card unique
          //  (c) the prior gate (topics.length < totalCount) left duplicates unchanged
          //      when the AI returned exactly N unique topics for N slots
          const baseTopic = topics[globalTopicIdx % topics.length]!;
          const topic = deriveSubTopic(baseTopic, contentType, k, synthTargetAudience);
          globalTopicIdx++;
          const requiresMediaBrief = ['video', 'reel', 'reels', 'carousel', 'story', 'stories', 'shorts'].includes(contentType);
          topic_slots.push({
            topic,
            global_progression_index: synthGlobalIdx,
            intent: {
              objective,
              cta_type: ctaType,
              target_audience: synthTargetAudience,
              brief_summary: `${topic}: ${objective}`,
              pain_point: deriveSynthPainPoint(topic),
              outcome_promise: deriveSynthOutcomePromise(topic, contentType),
              // Text enrichment (non-creator types)
              ...(!requiresMediaBrief ? {
                hook: deriveTextHook(topic, contentType),
                key_points: deriveKeyPoints(topic, objective, contentType),
                seo_focus: deriveSEOFocus(topic, objective),
                keywords: deriveKeywords(topic, objective),
                hashtags: deriveHashtags(topic, contentType, objective),
                repurpose_angles: deriveRepurposeAngles(topic, contentType),
              } : {}),
              // Creator enrichment
              ...(requiresMediaBrief ? {
                visual_hook: deriveVisualHook(topic, contentType),
                image_prompt: deriveImagePrompt(topic, contentType, platforms),
                video_prompt: contentType !== 'carousel' ? deriveVideoPrompt(topic, contentType, platforms) : undefined,
                scene_direction: deriveSceneDirection(topic, contentType),
                keywords: deriveKeywords(topic, objective),
                hashtags: deriveHashtags(topic, contentType, objective),
              } : {}),
            },
          });
        }
        executionItems.push({ content_type: contentType, selected_platforms: platforms, count_per_week: countPerType, topic_slots });
      }
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
            // Duplicate topic — rewrite with content-type-specific angle
            const derived = deriveSubTopic(currentTopic, ct, idx, synthAudience);
            slot.topic = derived;
            seenTopics.add(derived.toLowerCase());
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
        throw new Error('DETERMINISTIC_TOPIC_INTENT_REQUIRED');
      }
      for (const slot of slots) {
        if (!slot || typeof slot !== 'object' || !slot.intent) {
          throw new Error('DETERMINISTIC_TOPIC_INTENT_REQUIRED');
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
            throw new Error('DETERMINISTIC_TOPIC_INTENT_REQUIRED');
          }
          const rawTopic = slot.topic == null ? '' : String(slot.topic);
          if (!rawTopic.trim()) {
            throw new Error('DETERMINISTIC_TOPIC_INTENT_REQUIRED');
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
          if (typeof dailyObjective !== 'string' || !dailyObjective) throw new Error('DETERMINISTIC_TOPIC_INTENT_REQUIRED');
          if (typeof who !== 'string' || !who) throw new Error('DETERMINISTIC_TOPIC_INTENT_REQUIRED');
          if (typeof briefSummary !== 'string' || !briefSummary) throw new Error('DETERMINISTIC_TOPIC_INTENT_REQUIRED');
          if (typeof ctaType !== 'string' || !ctaType) throw new Error('DETERMINISTIC_TOPIC_INTENT_REQUIRED');
          if (!Number.isFinite(globalProgressionIndex) || globalProgressionIndex < 1) throw new Error('DETERMINISTIC_GLOBAL_PROGRESSION_REQUIRED');

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
    let executionValidationItems: any[] = [];
    const autoRebalanceEffective = useExecutionItems ? false : autoRebalance;
    const autoOptimizeDistributionEffective = useExecutionItems ? false : autoOptimizeDistribution;
    // Per-platform counter so each platform rotates through its own best_days list
    // (LinkedIn → Tue/Wed/Thu, Instagram → Wed/Fri/Sun, X → Tue/Thu, …) instead of
    // every platform clustering on item.dayIndex (which effectively picked Monday
    // for every post under sharing ON).
    const platformDayCursor = new Map<string, number>();

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
      if (useExecutionItems && platforms.length === 0) continue;

      for (const platform of platforms) {
        // Platform-aware day placement. Each platform tracks how many posts we've
        // assigned it this week, and we pick the nth entry from that platform's
        // research-backed best_days list (falls back to Tue/Wed/Thu when unknown).
        const platformKey = normalizePlatformKey(platform);
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
        const requiresMediaIntent = ['video', 'reel', 'short', 'carousel', 'image', 'story', 'podcast'].includes(normalizedContentType);
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
        const derivedAssetType = requiresMediaIntent ? deriveCreatorAssetTypeFromIntent({
          contentType: normalizedContentType,
          targetPlatforms: [normalizePlatformKey(platform)],
        }) : null;
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
          intent_type: requiresMediaIntent ? 'creator' : 'text',
          asset_type: requiresMediaIntent
            ? (
                typeof creatorCardForRow?.asset_type === 'string' && creatorCardForRow.asset_type.trim()
                  ? creatorCardForRow.asset_type.trim()
                  : derivedAssetType
              )
            : null,
          template_id: requiresMediaIntent
            ? (
                typeof creatorCardForRow?.template_id === 'string' && creatorCardForRow.template_id.trim()
                  ? creatorCardForRow.template_id.trim()
                  : null
              )
            : null,
          plan_version: currentPlanVersion,
          retry_count: 0,
          max_retries: 3,
          failure_reason: null,
          failure_type: null,
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

  if (allRowsToInsert.length > 0) {
    const { saveWeekPlans } = await import('../../../backend/services/executionPlannerService');
    const byWeek = new Map<number, typeof allRowsToInsert>();
    for (const row of allRowsToInsert) {
      const wn = Number((row as { week_number?: number })?.week_number) || 1;
      if (!byWeek.has(wn)) byWeek.set(wn, []);
      byWeek.get(wn)!.push(row);
    }
    for (const [wn, rows] of byWeek) {
      await saveWeekPlans(campaignId, wn, rows as any, 'blueprint');
    }
    if (process.env.NODE_ENV !== 'test') {
      console.log('[EXECUTION_ENGINE] source=blueprint saveWeekPlans completed', { campaignId, weeks: [...byWeek.keys()], totalRows: allRowsToInsert.length });
    }
  }

  return {
    success: true,
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

