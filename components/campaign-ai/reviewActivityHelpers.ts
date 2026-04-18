import { PLATFORM_LABELS } from '../../backend/constants/platforms';
import { isCreatorDependentContentType } from '../../utils/contentTaxonomy';
import { getIntentLabelForContentType } from '../../utils/formatLineForContentType';
import { prettyContentTypeLabel } from './planningCatalog';
import type { StructuredWeek } from './types';

const EMPTY_VALUE = '-';

const formatPlatformLabel = (platform: unknown) => {
  const key = String(platform ?? '').trim().toLowerCase();
  if (!key) return '';
  return PLATFORM_LABELS[key as keyof typeof PLATFORM_LABELS] || key.charAt(0).toUpperCase() + key.slice(1);
};

export function buildTopicsWithExecutionForWeek(week: any) {
  const hasEnrichedTopics = Array.isArray(week?.topics) && week.topics.length > 0;
  if (!hasEnrichedTopics) return [];
  const platformTargets = Object.entries(week?.platform_allocation || {})
    .map(([platform, count]) => `${platform}: ${count}`)
    .filter(Boolean);
  const contentTypes = Array.isArray(week?.content_type_mix) ? week.content_type_mix : [];
  return (week.topics as any[]).map((topic, idx) => ({
    ...topic,
    topicExecution: {
      platformTargets: platformTargets.length > 0 ? [platformTargets[idx % platformTargets.length]] : [EMPTY_VALUE],
      contentType: contentTypes[idx % Math.max(contentTypes.length, 1)] || EMPTY_VALUE,
      ctaType: week?.cta_type || EMPTY_VALUE,
      kpiFocus: week?.weekly_kpi_focus || EMPTY_VALUE,
    },
  }));
}

export function buildUniqueActivityCardsForWeek(week: any) {
  const topicBriefs = Array.isArray(week?.topics) ? (week.topics as any[]) : [];
  const executionItems = Array.isArray(week?.execution_items) ? (week.execution_items as any[]) : [];
  const cards: any[] = [];

  for (let execIdx = 0; execIdx < executionItems.length; execIdx += 1) {
    const exec = executionItems[execIdx];
    const contentType = String(exec?.content_type ?? exec?.contentType ?? EMPTY_VALUE).trim() || EMPTY_VALUE;
    const selectedPlatforms = Array.isArray(exec?.selected_platforms)
      ? exec.selected_platforms.map((p: unknown) => String(p ?? '').trim().toLowerCase()).filter(Boolean)
      : [];
    const fallbackPlatforms = Array.isArray(exec?.platform_options)
      ? exec.platform_options.map((p: unknown) => String(p ?? '').trim().toLowerCase()).filter(Boolean)
      : [];
    const slotPlatforms = Array.isArray(exec?.slot_platforms) ? (exec.slot_platforms as any[]) : [];
    const topicSlots = Array.isArray(exec?.topic_slots) ? (exec.topic_slots as any[]) : [];

    for (let slotIdx = 0; slotIdx < topicSlots.length; slotIdx += 1) {
      const slot = topicSlots[slotIdx];
      const platformsForSlot = (
        Array.isArray(slotPlatforms[slotIdx]) && slotPlatforms[slotIdx].length > 0
          ? slotPlatforms[slotIdx]
          : (selectedPlatforms.length > 0 ? selectedPlatforms : fallbackPlatforms)
      )
        .map((p: unknown) => String(p ?? '').trim().toLowerCase())
        .filter(Boolean);
      const intent = slot?.intent && typeof slot.intent === 'object' ? slot.intent : {};
      const matchedTopic = topicBriefs.find((topic) => {
        const meta = (topic as any)?.execution_meta;
        if (meta && Number(meta.exec_index) === execIdx && Number(meta.slot_index) === slotIdx) return true;
        return String(topic?.topicTitle ?? '').trim() === String(slot?.topic ?? '').trim();
      });

      cards.push({
        ...(matchedTopic && typeof matchedTopic === 'object' ? matchedTopic : {}),
        topicTitle: matchedTopic?.topicTitle || String(slot?.topic ?? '').trim() || `Activity ${cards.length + 1}`,
        topicContext: {
          ...(matchedTopic?.topicContext && typeof matchedTopic.topicContext === 'object' ? matchedTopic.topicContext : {}),
          writingIntent:
            matchedTopic?.topicContext?.writingIntent ||
            String((intent as any)?.brief_summary ?? (intent as any)?.writing_intent ?? '').trim() ||
            EMPTY_VALUE,
        },
        whoAreWeWritingFor: matchedTopic?.whoAreWeWritingFor || String((intent as any)?.target_audience ?? '').trim() || EMPTY_VALUE,
        whatProblemAreWeAddressing: matchedTopic?.whatProblemAreWeAddressing || String((intent as any)?.pain_point ?? '').trim() || EMPTY_VALUE,
        whatShouldReaderLearn: matchedTopic?.whatShouldReaderLearn || String((intent as any)?.outcome_promise ?? '').trim() || EMPTY_VALUE,
        desiredAction: matchedTopic?.desiredAction || String((intent as any)?.cta_type ?? week?.cta_type ?? '').trim() || EMPTY_VALUE,
        narrativeStyle: matchedTopic?.narrativeStyle || String(week?.weeklyContextCapsule?.toneGuidance ?? '').trim() || EMPTY_VALUE,
        topicExecution: {
          platformTargets: platformsForSlot.length > 0 ? platformsForSlot.map(formatPlatformLabel) : [EMPTY_VALUE],
          contentType,
          ctaType: String((intent as any)?.cta_type ?? week?.cta_type ?? EMPTY_VALUE).trim() || EMPTY_VALUE,
          kpiFocus: String(week?.weekly_kpi_focus ?? EMPTY_VALUE).trim() || EMPTY_VALUE,
          creator_instruction: slot?.creator_instruction && typeof slot.creator_instruction === 'object' ? slot.creator_instruction : undefined,
          executionMode: String(slot?.execution_mode ?? '').trim() || undefined,
          masterContentId: String(slot?.master_content_id ?? '').trim() || undefined,
          progressionStep: Number(slot?.progression_step ?? slotIdx + 1) || slotIdx + 1,
        },
      });
    }
  }

  return cards.length > 0 ? cards : buildTopicsWithExecutionForWeek(week);
}

export function buildReviewActivityCardsForWeek(
  week: StructuredWeek,
  options: {
    lastCollectedPlanningContextFromApi?: Record<string, unknown> | null;
    prefilledPlanning?: Record<string, unknown> | null;
    collectedPlanningContext?: Record<string, unknown> | null;
    hasProvidedPlatformContentRequests: boolean;
    planningPlatformContentRequests: Record<string, Record<string, string>>;
    planningCrossPlatformSharingEnabled: boolean;
    planningCrossPlatformScheduleMode: 'same_time' | 'staggered' | 'ai_recommended';
  }
) {
  const {
    lastCollectedPlanningContextFromApi,
    prefilledPlanning,
    collectedPlanningContext,
    hasProvidedPlatformContentRequests,
    planningPlatformContentRequests,
    planningCrossPlatformSharingEnabled,
    planningCrossPlatformScheduleMode,
  } = options;

  const directCards = buildUniqueActivityCardsForWeek(week);
  const postingSource = Array.isArray((week as any)?.resolved_postings) && (week as any).resolved_postings.length > 0
    ? ((week as any).resolved_postings as any[])
    : (Array.isArray((week as any)?.daily_execution_items) ? ((week as any).daily_execution_items as any[]) : []);
  const cardsFromPostings: any[] = [];
  if (postingSource.length > 0) {
    const seen = new Set<string>();
    postingSource.forEach((posting: any, idx: number) => {
      const contentType = String(posting?.content_type ?? posting?.contentType ?? 'post').trim().toLowerCase() || 'post';
      const platform = String(posting?.platform ?? '').trim().toLowerCase();
      const isCreator = isCreatorDependentContentType(contentType);
      const uniqueKey =
        String(posting?.master_content_id ?? posting?.posting_id ?? posting?.execution_id ?? '').trim() ||
        `${String(posting?.topic ?? posting?.title ?? '').trim().toLowerCase()}::${contentType}::${platform || 'shared'}::${idx}`;
      if (seen.has(uniqueKey)) return;
      seen.add(uniqueKey);
      const intent = posting?.intent && typeof posting.intent === 'object'
        ? posting.intent
        : posting?.writer_content_brief && typeof posting.writer_content_brief === 'object'
          ? posting.writer_content_brief
          : {};
      cardsFromPostings.push({
        topicTitle: String(posting?.topic ?? posting?.title ?? '').trim() || `Activity ${idx + 1}`,
        topicContext: {
          writingIntent: String((intent as any)?.brief_summary ?? posting?.description ?? posting?.objective ?? '').trim() || EMPTY_VALUE,
        },
        whoAreWeWritingFor: String((intent as any)?.target_audience ?? '').trim() || EMPTY_VALUE,
        whatProblemAreWeAddressing: String((intent as any)?.pain_point ?? posting?.summary ?? '').trim() || EMPTY_VALUE,
        whatShouldReaderLearn: String((intent as any)?.outcome_promise ?? posting?.introObjective ?? '').trim() || EMPTY_VALUE,
        desiredAction: String((intent as any)?.cta_type ?? posting?.cta ?? week?.cta_type ?? '').trim() || EMPTY_VALUE,
        narrativeStyle: String((week as any)?.weeklyContextCapsule?.toneGuidance ?? posting?.brandVoice ?? '').trim() || EMPTY_VALUE,
        topicExecution: {
          platformTargets: platform ? [formatPlatformLabel(platform)] : [EMPTY_VALUE],
          contentType,
          ctaType: String((intent as any)?.cta_type ?? posting?.cta ?? week?.cta_type ?? EMPTY_VALUE).trim() || EMPTY_VALUE,
          kpiFocus: String((week as any)?.weekly_kpi_focus ?? EMPTY_VALUE).trim() || EMPTY_VALUE,
          creator_instruction: posting?.creator_instruction && typeof posting.creator_instruction === 'object' ? posting.creator_instruction : undefined,
          executionMode: String(posting?.execution_mode ?? (isCreator ? 'CREATOR_REQUIRED' : 'AI_AUTOMATED')).trim() || undefined,
          masterContentId: String(posting?.master_content_id ?? '').trim() || undefined,
          progressionStep: Number(posting?.progression_step ?? idx + 1) || idx + 1,
        },
        _creatorCard: posting?.creator_card && typeof posting.creator_card === 'object' ? posting.creator_card : undefined,
      });
    });
  }

  const breakdown = (week as any)?.platform_content_breakdown && typeof (week as any).platform_content_breakdown === 'object'
    ? ((week as any).platform_content_breakdown as Record<string, Array<{ type?: string; count?: number; topic?: string; topics?: string[]; platforms?: string[] }>>)
    : null;
  const cardsFromBreakdown: any[] = [];
  if (breakdown && Object.keys(breakdown).length > 0) {
    const seen = new Set<string>();
    Object.entries(breakdown).forEach(([platformKey, rawItems]) => {
      (Array.isArray(rawItems) ? rawItems : []).forEach((item) => {
        const contentType = String(item?.type ?? 'post').trim().toLowerCase() || 'post';
        const sharedPlatforms = Array.isArray(item?.platforms) && item.platforms.length > 0
          ? item.platforms.map((p) => String(p ?? '').trim().toLowerCase()).filter(Boolean)
          : [platformKey];
        const topics = Array.isArray(item?.topics)
          ? item.topics.map((t) => String(t ?? '').trim()).filter(Boolean)
          : (typeof item?.topic === 'string' && item.topic.trim() ? [item.topic.trim()] : []);
        const count = Number(item?.count ?? 0);
        const uniqueCount = Math.max(topics.length, Number.isFinite(count) && count > 0 ? Math.floor(count) : 1);
        const dedupeKey = `${contentType}::${sharedPlatforms.slice().sort().join('|')}::${topics.join('|') || `count-${uniqueCount}`}`;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        for (let pieceIdx = 0; pieceIdx < uniqueCount; pieceIdx += 1) {
          const topicTitle = topics[pieceIdx] || (topics[0] ? `${topics[0]} (${pieceIdx + 1})` : `${contentType} ${pieceIdx + 1}`);
          cardsFromBreakdown.push({
            topicTitle,
            topicContext: { writingIntent: `${getIntentLabelForContentType(contentType)} for ${sharedPlatforms.map(formatPlatformLabel).join(', ')}` },
            whoAreWeWritingFor: String((week as any)?.weeklyContextCapsule?.audienceProfile ?? '').trim() || EMPTY_VALUE,
            whatProblemAreWeAddressing: String((week as any)?.primary_objective ?? (week as any)?.summary ?? '').trim() || EMPTY_VALUE,
            whatShouldReaderLearn: String((week as any)?.theme ?? (week as any)?.phase_label ?? '').trim() || EMPTY_VALUE,
            desiredAction: String((week as any)?.cta_type ?? '').trim() || EMPTY_VALUE,
            narrativeStyle: String((week as any)?.weeklyContextCapsule?.toneGuidance ?? '').trim() || EMPTY_VALUE,
            topicExecution: {
              platformTargets: sharedPlatforms.map(formatPlatformLabel).filter(Boolean),
              contentType,
              ctaType: String((week as any)?.cta_type ?? EMPTY_VALUE).trim() || EMPTY_VALUE,
              kpiFocus: String((week as any)?.weekly_kpi_focus ?? EMPTY_VALUE).trim() || EMPTY_VALUE,
              progressionStep: pieceIdx + 1,
            },
          });
        }
      });
    });
  }

  const best = [directCards, cardsFromPostings, cardsFromBreakdown]
    .filter((items) => Array.isArray(items) && items.length > 0)
    .sort((a, b) => b.length - a.length)[0];
  if (best && best.length > 0) return best;

  const rawRequests =
    (lastCollectedPlanningContextFromApi as any)?.platform_content_requests ??
    (prefilledPlanning as any)?.platform_content_requests ??
    (collectedPlanningContext as any)?.platform_content_requests ??
    null;
  const requestObject: Record<string, Record<string, number>> = {};
  if (rawRequests && typeof rawRequests === 'object') {
    if (Array.isArray(rawRequests)) {
      for (const entry of rawRequests as any[]) {
        const platform = String(entry?.platform ?? '').trim().toLowerCase();
        const contentType = String(entry?.content_type ?? '').trim().toLowerCase();
        const count = Number(entry?.count_per_week ?? 0);
        if (!platform || !contentType || !Number.isFinite(count) || count <= 0) continue;
        requestObject[platform] = requestObject[platform] || {};
        requestObject[platform]![contentType] = Math.floor(count);
      }
    } else {
      for (const [platform, byType] of Object.entries(rawRequests as Record<string, unknown>)) {
        if (!byType || typeof byType !== 'object') continue;
        const normalizedPlatform = String(platform ?? '').trim().toLowerCase();
        if (!normalizedPlatform) continue;
        const out: Record<string, number> = {};
        for (const [contentType, rawCount] of Object.entries(byType as Record<string, unknown>)) {
          const count = Number(rawCount ?? 0);
          if (!contentType || !Number.isFinite(count) || count <= 0) continue;
          out[String(contentType).trim().toLowerCase()] = Math.floor(count);
        }
        if (Object.keys(out).length > 0) requestObject[normalizedPlatform] = out;
      }
    }
  }
  if (Object.keys(requestObject).length === 0) return [];

  const sharingConfig =
    (lastCollectedPlanningContextFromApi as any)?.cross_platform_sharing ??
    (prefilledPlanning as any)?.cross_platform_sharing ??
    (collectedPlanningContext as any)?.cross_platform_sharing ??
    null;
  const sharingEnabled =
    sharingConfig && typeof sharingConfig === 'object' && 'enabled' in sharingConfig
      ? Boolean((sharingConfig as { enabled?: boolean }).enabled)
      : (hasProvidedPlatformContentRequests || Object.keys(planningPlatformContentRequests || {}).length > 0)
        ? planningCrossPlatformSharingEnabled
        : true;
  const sharingSchedule =
    sharingConfig && typeof sharingConfig === 'object' && typeof (sharingConfig as { schedule?: unknown }).schedule === 'string'
      ? String((sharingConfig as { schedule?: string }).schedule)
      : planningCrossPlatformScheduleMode;

  const perTypePerPlatform: Record<string, Record<string, number>> = {};
  for (const [platform, byType] of Object.entries(requestObject)) {
    for (const [contentType, count] of Object.entries(byType || {})) {
      perTypePerPlatform[contentType] = perTypePerPlatform[contentType] || {};
      perTypePerPlatform[contentType]![platform] = Math.floor(Number(count) || 0);
    }
  }

  const fallbackCards: any[] = [];
  const themeLabel = String((week as any)?.theme ?? (week as any)?.phase_label ?? `Week ${(week as any)?.week ?? 1}`).trim();
  const objectiveLabel = String((week as any)?.primary_objective ?? (week as any)?.objective ?? (week as any)?.summary ?? '').trim();
  const audienceLabel = String((week as any)?.weeklyContextCapsule?.audienceProfile ?? '').trim() || EMPTY_VALUE;
  const toneLabel = String((week as any)?.weeklyContextCapsule?.toneGuidance ?? '').trim() || EMPTY_VALUE;

  Object.entries(perTypePerPlatform).forEach(([contentType, platformCounts]) => {
    const platformEntries = Object.entries(platformCounts).filter(([, count]) => Number(count) > 0);
    if (platformEntries.length === 0) return;
    const counts = platformEntries.map(([, count]) => Number(count) || 0);
    const uniqueCount = sharingEnabled ? Math.max(...counts) : counts.reduce((sum, count) => sum + count, 0);
    if (!Number.isFinite(uniqueCount) || uniqueCount <= 0) return;
    const piecePlatforms: string[][] = Array.from({ length: uniqueCount }, () => []);
    if (sharingEnabled) {
      for (const [platform, countRaw] of platformEntries) {
        const count = Math.floor(Number(countRaw) || 0);
        for (let idx = 0; idx < count; idx += 1) piecePlatforms[idx]!.push(platform);
      }
    } else {
      let cursor = 0;
      for (const [platform, countRaw] of platformEntries) {
        const count = Math.floor(Number(countRaw) || 0);
        for (let idx = 0; idx < count; idx += 1) piecePlatforms[cursor++] = [platform];
      }
    }
    for (let idx = 0; idx < uniqueCount; idx += 1) {
      const assignedPlatforms = (piecePlatforms[idx] || []).filter(Boolean);
      fallbackCards.push({
        topicTitle: `${prettyContentTypeLabel(contentType)} ${idx + 1}`,
        topicContext: { writingIntent: objectiveLabel || themeLabel || `Create ${prettyContentTypeLabel(contentType)} for this week` },
        whoAreWeWritingFor: audienceLabel,
        whatProblemAreWeAddressing: objectiveLabel || themeLabel || EMPTY_VALUE,
        whatShouldReaderLearn: themeLabel || EMPTY_VALUE,
        desiredAction: String((week as any)?.cta_type ?? '').trim() || EMPTY_VALUE,
        narrativeStyle: toneLabel,
        topicExecution: {
          platformTargets: assignedPlatforms.length > 0 ? assignedPlatforms.map(formatPlatformLabel) : [EMPTY_VALUE],
          contentType,
          ctaType: String((week as any)?.cta_type ?? EMPTY_VALUE).trim() || EMPTY_VALUE,
          kpiFocus: String((week as any)?.weekly_kpi_focus ?? EMPTY_VALUE).trim() || EMPTY_VALUE,
          progressionStep: idx + 1,
        },
        contentTypeGuidance: {
          primaryFormat: sharingEnabled ? 'shared_piece' : 'unique_piece',
          adaptationRequired: sharingEnabled && assignedPlatforms.length > 1,
          scheduleMode: sharingSchedule,
        },
      });
    }
  });

  return fallbackCards;
}
