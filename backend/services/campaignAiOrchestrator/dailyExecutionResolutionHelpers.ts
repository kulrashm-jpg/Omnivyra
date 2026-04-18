import { inferExecutionMode, isExecutionMode } from '../executionModeInference';
import type { DailyExecutionItem } from './types';
import {
  deterministicAlignmentReasonDefaults,
  ensureWriterFormatRequirements,
  hasNumericAlignmentScore,
  narrativePositionFromIndex,
  narrativeRoleFromPosition,
  validateContentTypeFormatPlatform,
} from './contentFormatHelpers';

export function warnDailyExecutionNormalization(input: Partial<DailyExecutionItem>, context: string): void {
  if (!String(input.execution_id ?? '').trim()) {
    console.warn('[daily-normalization][missing-execution-id]', { context });
  }
  if (!String(input.platform ?? '').trim()) {
    console.warn('[daily-normalization][missing-platform]', { context, execution_id: input.execution_id ?? null });
  }
  if (!String(input.content_type ?? '').trim()) {
    console.warn('[daily-normalization][missing-content-type]', { context, execution_id: input.execution_id ?? null });
  }
}

export function normalizeToDailyExecutionItem(input: Partial<DailyExecutionItem>): DailyExecutionItem {
  const normalized: DailyExecutionItem = {
    execution_id: String(input.execution_id ?? '').trim(),
    source_type: input.source_type === 'planned' ? 'planned' : 'manual',
    campaign_id: input.campaign_id ? String(input.campaign_id) : undefined,
    week_number: Number.isFinite(Number(input.week_number)) ? Number(input.week_number) : undefined,
    platform: String(input.platform ?? '').trim().toLowerCase(),
    content_type: String(input.content_type ?? '').trim().toLowerCase(),
    topic: typeof input.topic === 'string' ? input.topic : undefined,
    title: typeof input.title === 'string' ? input.title : undefined,
    content: typeof input.content === 'string' ? input.content : undefined,
    intent: input.intent && typeof input.intent === 'object' ? input.intent : undefined,
    writer_content_brief:
      input.writer_content_brief && typeof input.writer_content_brief === 'object'
        ? input.writer_content_brief
        : undefined,
    narrative_role: typeof input.narrative_role === 'string' ? input.narrative_role : undefined,
    progression_step: Number.isFinite(Number(input.progression_step)) ? Number(input.progression_step) : undefined,
    global_progression_index: Number.isFinite(Number(input.global_progression_index))
      ? Number(input.global_progression_index)
      : undefined,
    status: 'draft',
    scheduled_time: typeof input.scheduled_time === 'string' ? input.scheduled_time : undefined,
    master_content_id: typeof input.master_content_id === 'string' ? input.master_content_id : undefined,
    execution_mode: isExecutionMode(input.execution_mode) ? input.execution_mode : undefined,
    creator_instruction:
      input.creator_instruction && typeof input.creator_instruction === 'object' ? input.creator_instruction : undefined,
  };
  warnDailyExecutionNormalization(normalized, 'normalizeToDailyExecutionItem');
  return normalized;
}

export function normalizeResolvedPostingToDailyItem(
  posting: any,
  meta: { campaign_id?: string; week_number?: number } = {}
): DailyExecutionItem {
  const weeklyIntent =
    posting?.intent && typeof posting.intent === 'object'
      ? posting.intent
      : posting?.topic_slot_ref?.intent && typeof posting.topic_slot_ref.intent === 'object'
        ? posting.topic_slot_ref.intent
        : undefined;
  return normalizeToDailyExecutionItem({
    execution_id: String(posting?.execution_id ?? posting?.posting_id ?? '').trim(),
    source_type: 'planned',
    campaign_id: meta.campaign_id,
    week_number: meta.week_number,
    platform: String(posting?.platform ?? '').trim(),
    content_type: String(posting?.content_type ?? '').trim(),
    topic: typeof posting?.topic === 'string' ? posting.topic : undefined,
    title: typeof posting?.topic === 'string' ? posting.topic : undefined,
    content: typeof posting?.content === 'string' ? posting.content : undefined,
    intent: weeklyIntent,
    writer_content_brief:
      posting?.writer_content_brief && typeof posting.writer_content_brief === 'object'
        ? posting.writer_content_brief
        : undefined,
    narrative_role: typeof posting?.narrative_role === 'string' ? posting.narrative_role : undefined,
    progression_step: Number(posting?.progression_step),
    global_progression_index: Number(posting?.global_progression_index),
    execution_mode: isExecutionMode(posting?.execution_mode) ? posting.execution_mode : undefined,
    creator_instruction:
      posting?.creator_instruction && typeof posting.creator_instruction === 'object'
        ? posting.creator_instruction
        : undefined,
    status: 'draft',
    scheduled_time: typeof posting?.scheduled_time === 'string' ? posting.scheduled_time : undefined,
    master_content_id: typeof posting?.master_content_id === 'string' ? posting.master_content_id : undefined,
  });
}

export function alignDailyExecutionItemsAsSingleSource(args: {
  weeks: any[];
  campaignId: string;
  currentPlanWeeks?: any[];
}): void {
  const weeks = Array.isArray(args.weeks) ? args.weeks : [];
  const existingDailyByWeek = new Map<number, any[]>();
  const currentWeeks = Array.isArray(args.currentPlanWeeks) ? args.currentPlanWeeks : [];
  for (const week of currentWeeks) {
    const weekNo = Number((week as any)?.week ?? (week as any)?.week_number ?? (week as any)?.weekNumber ?? 0) || 0;
    if (weekNo <= 0) continue;
    if (Array.isArray((week as any)?.daily)) {
      existingDailyByWeek.set(weekNo, (week as any).daily);
    }
  }

  for (const week of weeks) {
    const weekNo = Number((week as any)?.week ?? (week as any)?.week_number ?? (week as any)?.weekNumber ?? 0) || 0;
    const resolvedPostings: any[] = Array.isArray((week as any)?.resolved_postings) ? (week as any).resolved_postings : [];
    (week as any).daily_execution_items = resolvedPostings.map((posting: any) =>
      normalizeResolvedPostingToDailyItem(posting, { campaign_id: args.campaignId, week_number: weekNo || undefined })
    );

    if (existingDailyByWeek.has(weekNo)) {
      (week as any).daily = existingDailyByWeek.get(weekNo);
    } else if (Array.isArray((week as any)?.daily)) {
      (week as any).daily = [];
    }
  }
}

export function attachResolvedPostingsToWeeks(weeks: any[]): void {
  if (!Array.isArray(weeks) || weeks.length === 0) return;

  for (const week of weeks) {
    const map: any[] = Array.isArray((week as any)?.posting_execution_map) ? (week as any).posting_execution_map : [];
    if (map.length === 0) {
      if ((week as any)?.resolved_postings == null) (week as any).resolved_postings = [];
      if ((week as any)?.daily_execution_items == null) (week as any).daily_execution_items = [];
      continue;
    }

    const existing = (week as any)?.resolved_postings;
    if (Array.isArray(existing) && existing.length > 0) {
      if (!Array.isArray((week as any)?.daily_execution_items) || (week as any).daily_execution_items.length === 0) {
        const weekNoExisting = Number((week as any)?.week ?? (week as any)?.week_number ?? (week as any)?.weekNumber ?? 0) || 0;
        (week as any).daily_execution_items = existing.map((posting: any) =>
          normalizeResolvedPostingToDailyItem(posting, { week_number: weekNoExisting || undefined })
        );
      }
      continue;
    }

    const execItems: any[] = Array.isArray((week as any)?.execution_items) ? (week as any).execution_items : [];
    const resolved: any[] = [];
    let invalid = 0;
    const weekNo = Number((week as any)?.week ?? (week as any)?.week_number ?? (week as any)?.weekNumber ?? 0) || 0;
    const safeWeekNo = weekNo > 0 ? weekNo : 1;
    const totalPostings = map.length;

    for (const entry of map) {
      const ref = entry?.topic_slot_ref ?? {};
      const execution_index = Number(ref?.execution_index);
      const slot_index = Number(ref?.slot_index);
      if (!Number.isFinite(execution_index) || execution_index < 0 || execution_index >= execItems.length) {
        invalid += 1;
        continue;
      }
      const exec = execItems[execution_index];
      const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
      if (!Number.isFinite(slot_index) || slot_index < 0 || slot_index >= slots.length) {
        invalid += 1;
        continue;
      }
      const slot = slots[slot_index];
      if (!slot || typeof slot !== 'object') {
        invalid += 1;
        continue;
      }

      const postingOrderRaw = Number(entry?.posting_order);
      const postingOrder = Number.isFinite(postingOrderRaw) && postingOrderRaw > 0 ? Math.floor(postingOrderRaw) : resolved.length + 1;
      const progression_step_raw = Number(slot?.progression_step);
      const progression_step = Number.isFinite(progression_step_raw) && progression_step_raw > 0 ? Math.floor(progression_step_raw) : postingOrder;
      const global_index_raw = Number(slot?.global_progression_index);
      const global_progression_index = Number.isFinite(global_index_raw) && global_index_raw > 0 ? Math.floor(global_index_raw) : progression_step;
      const narrative_position = narrativePositionFromIndex(global_progression_index, totalPostings);
      const narrative_role = narrativeRoleFromPosition(narrative_position);
      const writerBrief =
        (slot as any)?.writer_content_brief && typeof (slot as any).writer_content_brief === 'object'
          ? (slot as any).writer_content_brief
          : null;
      const incomingFormat = writerBrief?.format_requirements?.format_family;
      const validated = validateContentTypeFormatPlatform({
        content_type: entry?.content_type,
        platform: entry?.platform,
        format_family: incomingFormat,
      });
      if (writerBrief) ensureWriterFormatRequirements(writerBrief, validated.content_type, validated.format_family);
      const execution_mode = (slot as any)?.execution_mode ?? inferExecutionMode(validated.content_type);

      const post = {
        posting_id: entry?.posting_id,
        posting_order: postingOrder,
        execution_id: `wk${safeWeekNo}-exec-${postingOrder}`,
        platform: entry?.platform,
        content_type: validated.content_type,
        format_validation_warning: validated.format_validation_warning,
        topic: slot?.topic,
        progression_step,
        global_progression_index,
        narrative_position,
        narrative_role,
        intent: slot?.intent,
        writer_content_brief: writerBrief,
        execution_mode,
        ...(typeof (slot as any)?.master_content_id === 'string' ? { master_content_id: (slot as any).master_content_id } : {}),
        ...(typeof (slot as any)?.creator_instruction === 'object' && (slot as any).creator_instruction != null
          ? { creator_instruction: (slot as any).creator_instruction }
          : {}),
      };
      if (hasNumericAlignmentScore(post)) {
        const alignmentReason = Array.isArray((post as any)?.alignment_reason)
          ? (post as any).alignment_reason.map((v: unknown) => String(v ?? '').trim()).filter(Boolean)
          : [];
        if (alignmentReason.length === 0) (post as any).alignment_reason = deterministicAlignmentReasonDefaults();
      }
      resolved.push(post);
    }

    (week as any).resolved_postings = resolved;
    (week as any).daily_execution_items = resolved.map((posting: any) =>
      normalizeResolvedPostingToDailyItem(posting, { week_number: weekNo || undefined })
    );

    if (resolved.length !== map.length) {
      console.warn('[weekly-resolved-postings][mismatch]', {
        week: weekNo || null,
        mapEntries: map.length,
        resolvedEntries: resolved.length,
        invalidRefs: invalid,
      });
    }
  }
}
