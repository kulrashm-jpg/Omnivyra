import { normalizeDeliverableType } from './planSkeletonHelpers';
import {
  approximateDepthForTarget,
  ctaToDesiredAction,
  getPlatformWordLimit,
  normalizePlatformKey,
  platformToPrimaryFormat,
} from './weeklyWritingHelpers';

interface EnrichDeterministicWeekBriefsArgs {
  structured: any;
  campaignId: string;
  recommendationContext: any;
  effectivePrefilledPlanning: Record<string, unknown> | null | undefined;
}

function ensureNonEmptyString(value: unknown): string | null {
  const s = typeof value === 'string' ? value : String(value ?? '');
  const t = s.trim();
  return t ? t : null;
}

export function enrichDeterministicWeekBriefs({
  structured,
  campaignId,
  recommendationContext,
  effectivePrefilledPlanning,
}: EnrichDeterministicWeekBriefsArgs): any {
  const weeksForEnrichment: any[] = Array.isArray(structured?.weeks) ? (structured.weeks as any[]) : [];
  for (const week of weeksForEnrichment) {
    const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : [];
    if (execItems.length === 0) continue;

    const weekCapsule =
      (week as any)?.weeklyContextCapsule ??
      (week as any)?.week_extras?.weeklyContextCapsule ??
      (week as any)?.weekly_context_capsule ??
      null;
    const toneGuidance =
      ensureNonEmptyString((weekCapsule as any)?.toneGuidance) ||
      ensureNonEmptyString((weekCapsule as any)?.tone_guidance) ||
      'clear, practical, outcome-driven';

    const theme = ensureNonEmptyString((week as any)?.theme) || `Week ${Number((week as any)?.week ?? 1) || 1} focus`;
    const objective = ensureNonEmptyString((week as any)?.primary_objective ?? (week as any)?.objective) || 'Execute weekly objective.';
    const cta_type = ensureNonEmptyString((week as any)?.cta_type ?? (week as any)?.ctaType) || 'Soft CTA';
    const weekly_kpi_focus =
      ensureNonEmptyString((week as any)?.weekly_kpi_focus ?? (week as any)?.weeklyKpiFocus) || 'Reach growth';
    const target_audience =
      ensureNonEmptyString((week as any)?.target_audience ?? (week as any)?.targetAudience ?? (effectivePrefilledPlanning as any)?.target_audience) ||
      'Target audience from campaign context';

    const platform_content_breakdown: Record<string, Array<{ type: string; count: number; topic?: string; topics?: string[]; platforms?: string[] }>> =
      {};
    const platform_topics: Record<string, string[]> = {};
    const topicBriefs: any[] = [];

    for (let execIdx = 0; execIdx < execItems.length; execIdx += 1) {
      const exec = execItems[execIdx];
      const selectedPlatformsRaw: string[] = Array.isArray(exec?.selected_platforms) ? exec.selected_platforms : [];
      const fallbackPlatform = (Array.isArray(exec?.platform_options) && exec.platform_options[0]) || 'linkedin';
      const selectedPlatforms = (selectedPlatformsRaw.length > 0 ? selectedPlatformsRaw : [fallbackPlatform])
        .map((p: any) => normalizePlatformKey(String(p)))
        .filter(Boolean);
      const primaryPlatform = selectedPlatforms[0] || normalizePlatformKey(String(fallbackPlatform));
      const wordTarget = getPlatformWordLimit(primaryPlatform);

      const rawType = String(exec?.content_type ?? '').trim();
      const normalizedType = normalizeDeliverableType(rawType) || rawType.toLowerCase() || 'post';
      const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
      const topics: string[] = slots.map((s) => ensureNonEmptyString(s?.topic)).filter(Boolean) as string[];

      const countRaw = Number(exec?.count_per_week ?? 0);
      const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : Math.max(1, topics.length);

      const platformCountsRaw =
        exec?.platform_counts && typeof exec.platform_counts === 'object' && !Array.isArray(exec.platform_counts)
          ? (exec.platform_counts as Record<string, unknown>)
          : null;
      const platformCounts: Record<string, number> = {};
      if (platformCountsRaw) {
        for (const [p, v] of Object.entries(platformCountsRaw)) {
          const n = Number(v);
          if (!p || !Number.isFinite(n) || n <= 0) continue;
          platformCounts[normalizePlatformKey(p)] = Math.floor(n);
        }
      } else {
        platformCounts[primaryPlatform] = count;
      }

      const slotPlatforms: string[][] = Array.isArray(exec?.slot_platforms)
        ? (exec.slot_platforms as any[]).map((arr) =>
            Array.isArray(arr) ? arr.map((p) => normalizePlatformKey(String(p))).filter(Boolean) : []
          )
        : [];

      const topicsByPlatform: Record<string, string[]> = {};
      for (const p of selectedPlatforms) topicsByPlatform[p] = [];
      for (let slotIdx = 0; slotIdx < slots.length; slotIdx += 1) {
        const topic = ensureNonEmptyString(slots[slotIdx]?.topic);
        if (!topic) continue;
        const platformsForSlot =
          slotPlatforms[slotIdx] && slotPlatforms[slotIdx]!.length > 0 ? slotPlatforms[slotIdx]! : selectedPlatforms;
        for (const p of platformsForSlot) {
          topicsByPlatform[p] = topicsByPlatform[p] || [];
          topicsByPlatform[p]!.push(topic);
        }
      }

      for (const p of selectedPlatforms) {
        const cP = Number(platformCounts[p] ?? 0) || 0;
        if (cP <= 0) continue;
        platform_content_breakdown[p] = platform_content_breakdown[p] || [];
        const tP = topicsByPlatform[p] || [];
        platform_content_breakdown[p]!.push({
          type: normalizedType,
          count: cP,
          topic: tP[0] || topics[0] || undefined,
          topics: tP.length > 0 ? tP : topics.length > 0 ? topics : undefined,
          platforms: selectedPlatforms.length > 1 ? selectedPlatforms : [p],
        });
        platform_topics[p] = Array.from(new Set([...(platform_topics[p] || []), ...tP]));
      }

      const contentTypeGuidance = {
        primaryFormat: platformToPrimaryFormat(primaryPlatform),
        maxWordTarget: wordTarget,
        platformWithHighestLimit: primaryPlatform,
        adaptationRequired: true as const,
      };
      for (let slotIdx = 0; slotIdx < slots.length; slotIdx += 1) {
        const slot = slots[slotIdx];
        const topicTitle = ensureNonEmptyString(slot?.topic) || `Topic ${slotIdx + 1}`;
        const intent = slot?.intent ?? {};
        const brief_summary =
          ensureNonEmptyString(intent?.brief_summary ?? intent?.briefSummary ?? intent?.writing_intent) ||
          `Address "${topicTitle}" within the "${theme}" narrative for ${target_audience}.`;
        const pain_point = ensureNonEmptyString(intent?.pain_point ?? intent?.painPoint) || `Uncertainty about ${topicTitle}`;
        const outcome_promise =
          ensureNonEmptyString(intent?.outcome_promise ?? intent?.outcomePromise) || `Reader understands ${topicTitle} and why it matters.`;

        topicBriefs.push({
          topicTitle,
          topicContext: {
            topicTitle,
            topicGoal: objective,
            audienceAngle: target_audience,
            painPointFocus: pain_point,
            transformationIntent: outcome_promise,
            messagingAngle: theme,
            expectedOutcome: weekly_kpi_focus,
            recommendedContentTypes: [normalizedType],
            platformPriority: selectedPlatforms,
            writingIntent: brief_summary,
          },
          whoAreWeWritingFor: target_audience,
          whatProblemAreWeAddressing: pain_point,
          whatShouldReaderLearn: outcome_promise,
          desiredAction: ctaToDesiredAction(cta_type),
          approximateDepth: approximateDepthForTarget(wordTarget),
          narrativeStyle: toneGuidance,
          contentTypeGuidance,
          execution_meta: {
            primary_platform: primaryPlatform,
            platforms: slotPlatforms[slotIdx] && slotPlatforms[slotIdx]!.length > 0 ? slotPlatforms[slotIdx]! : selectedPlatforms,
            content_type: normalizedType,
            progression_step: Number(slot?.progression_step ?? slotIdx + 1),
            global_progression_index: Number(slot?.global_progression_index ?? 0),
            exec_index: execIdx,
            slot_index: slotIdx,
          },
        });
      }
    }

    topicBriefs.sort((a, b) => {
      const ga = Number(a?.execution_meta?.global_progression_index ?? 0) || 0;
      const gb = Number(b?.execution_meta?.global_progression_index ?? 0) || 0;
      if (ga !== gb) return ga - gb;
      const wa = Number(a?.execution_meta?.exec_index ?? 0) || 0;
      const wb = Number(b?.execution_meta?.exec_index ?? 0) || 0;
      if (wa !== wb) return wa - wb;
      return (Number(a?.execution_meta?.slot_index ?? 0) || 0) - (Number(b?.execution_meta?.slot_index ?? 0) || 0);
    });

    const existingTopicsToCover: string[] = Array.isArray((week as any)?.topics_to_cover)
      ? ((week as any).topics_to_cover as any[]).map((t) => String(t ?? '').trim()).filter(Boolean)
      : [];
    const computedTopicsToCover =
      existingTopicsToCover.length > 0
        ? existingTopicsToCover
        : Array.from(new Set(topicBriefs.map((b) => String(b?.topicTitle ?? '').trim()).filter(Boolean))).slice(0, 8);

    (week as any).platform_content_breakdown = platform_content_breakdown;
    (week as any).platform_topics = platform_topics;
    (week as any).topics = topicBriefs;
    (week as any).topics_to_cover = computedTopicsToCover;
    (week as any).week_extras = {
      ...(typeof (week as any).week_extras === 'object' && (week as any).week_extras ? (week as any).week_extras : {}),
      writer_brief: {
        objective,
        theme,
        weekly_kpi_focus,
        target_audience,
        cta_type,
        narrative_spine: ensureNonEmptyString((week as any)?.weekly_narrative_spine) || null,
        campaign_stage: ensureNonEmptyString((week as any)?.campaign_stage) || null,
        audience_awareness_target: ensureNonEmptyString((week as any)?.audience_awareness_target) || null,
        tone_guidance: toneGuidance,
      },
    };
  }

  return structured;
}
