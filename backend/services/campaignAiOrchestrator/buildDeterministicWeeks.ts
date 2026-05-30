import { buildCreatorInstruction } from '../buildCreatorInstruction';
import { BoltError, BOLT_ERROR_CODES } from '../../../lib/shared/bolt/boltErrorCodes';
import { inferExecutionMode } from '../executionModeInference';
import { deriveTopicWeights, weightedAssignment } from './topicAssignmentHelpers';
import {
  buildRecommendationAlignment,
  deriveAudienceAwarenessTarget,
  deriveCampaignStageForWeek,
  deriveOutcomePromise,
  derivePainPoint,
  deriveStrategicRole,
  deriveWeekTheme,
  deriveWeeklyNarrativeSpine,
  deriveWritingAngle,
  ensureNonEmptyString,
  extractRecommendationAlignmentSources,
  pickBriefSummary,
  spreadDaysForCount,
} from './deterministicWeekStrategy';

interface BuildDeterministicWeeksArgs {
  structured: any;
  deterministicPlanSkeleton: any;
  effectivePrefilledPlanning: Record<string, unknown> | null | undefined;
  recommendationContext: any;
  campaignId: string;
}

export function buildDeterministicWeeks({
  structured,
  deterministicPlanSkeleton,
  effectivePrefilledPlanning,
  recommendationContext,
  campaignId,
}: BuildDeterministicWeeksArgs): any {
  const baseExecutionItems: any[] = Array.isArray(deterministicPlanSkeleton?.execution_items)
    ? (deterministicPlanSkeleton.execution_items as any[])
    : [];
  const alignmentSources = extractRecommendationAlignmentSources(recommendationContext);
  const campaignIdForMasterContent = String(campaignId ?? '').trim() || 'campaign';

  return {
    ...structured,
    weeks: (structured.weeks || []).map((w: any, idx: number) => {
      if (!Array.isArray(baseExecutionItems) || baseExecutionItems.length === 0) {
        throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_TOPIC_SLOT_COUNT_MISMATCH');
      }

      const weekOrdinalRaw = Number((w as any)?.week ?? (w as any)?.week_number ?? (w as any)?.weekNumber ?? idx + 1);
      const weekOrdinal = Number.isFinite(weekOrdinalRaw) && weekOrdinalRaw > 0 ? Math.floor(weekOrdinalRaw) : idx + 1;
      const campaign_stage = deriveCampaignStageForWeek(weekOrdinal);
      const audience_awareness_target = deriveAudienceAwarenessTarget(campaign_stage);
      const theme = deriveWeekTheme(w, weekOrdinal);

      const objectiveRaw =
        ensureNonEmptyString((w as any)?.primary_objective ?? (w as any)?.objective) ??
        ensureNonEmptyString((effectivePrefilledPlanning as any)?.campaign_goal ?? (effectivePrefilledPlanning as any)?.key_messages) ??
        ensureNonEmptyString((effectivePrefilledPlanning as any)?.execution_config?.campaign_goal);
      if (!objectiveRaw) throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_WEEKLY_STRATEGY_REQUIRED');

      const weekly_narrative_spine = deriveWeeklyNarrativeSpine({
        campaign_stage,
        audience_awareness_target,
        theme,
        objective: objectiveRaw,
      });

      const okWeekMeta =
        ensureNonEmptyString(theme) &&
        ensureNonEmptyString(campaign_stage) &&
        ensureNonEmptyString(weekly_narrative_spine) &&
        ensureNonEmptyString(audience_awareness_target);
      if (!okWeekMeta) throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_WEEK_META_REQUIRED');

      const weeklyCapsule =
        (w as any)?.weeklyContextCapsule ??
        (w as any)?.week_extras?.weeklyContextCapsule ??
        (w as any)?.weekly_context_capsule ??
        null;
      const topicsWithWeights = deriveTopicWeights(w?.topics_to_cover ?? w?.topicsToCover ?? [], weeklyCapsule);
      const totalSlots = baseExecutionItems.reduce((sum, it) => sum + (Number(it?.count_per_week ?? 0) || 0), 0);
      const allSlots = weightedAssignment(topicsWithWeights, totalSlots);
      let cursor = 0;

      const execution_items = baseExecutionItems.map((it, execIdx: number) => {
        const count = Number(it?.count_per_week ?? 0) || 0;
        const c = Math.max(0, Math.floor(count));
        if (c <= 0) throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_TOPIC_SLOT_COUNT_MISMATCH');
        const slotTopics = allSlots.slice(cursor, cursor + c).map((t) => (t == null ? null : String(t)));
        cursor += c;
        if (slotTopics.length !== c) throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_TOPIC_SLOT_COUNT_MISMATCH');
        const dayIndices = spreadDaysForCount(c, 7);

        const contentTypeForId = String(it?.content_type ?? 'post').toLowerCase().replace(/\s+/g, '_');
        const objective =
          ensureNonEmptyString(w?.primary_objective ?? w?.objective) ??
          ensureNonEmptyString((effectivePrefilledPlanning as any)?.campaign_goal ?? (effectivePrefilledPlanning as any)?.key_messages) ??
          ensureNonEmptyString((effectivePrefilledPlanning as any)?.execution_config?.campaign_goal);
        const cta_type =
          ensureNonEmptyString(w?.cta_type ?? w?.ctaType) ??
          ensureNonEmptyString((effectivePrefilledPlanning as any)?.action_expectation) ??
          ensureNonEmptyString((effectivePrefilledPlanning as any)?.execution_config?.action_expectation);
        const target_audience =
          ensureNonEmptyString(w?.target_audience ?? w?.targetAudience ?? (effectivePrefilledPlanning as any)?.target_audience) ??
          ensureNonEmptyString((effectivePrefilledPlanning as any)?.execution_config?.target_audience);
        if (!objective || !cta_type || !target_audience) throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_WEEKLY_STRATEGY_REQUIRED');

        const keyMessages = (effectivePrefilledPlanning as any)?.key_messages ?? null;
        return {
          ...it,
          topic_slots: slotTopics.map((topic, slotIndex: number) => {
            const topicString = ensureNonEmptyString(topic);
            if (!topicString) throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_WEEKLY_STRATEGY_REQUIRED');
            const writingAngle = deriveWritingAngle({
              themeRaw: theme,
              topicRaw: topicString,
            });
            const strategic_role = deriveStrategicRole(writingAngle);
            const pain_point = derivePainPoint({ keyMessages, topic: topicString });
            const outcome_promise = deriveOutcomePromise(topicString);
            const brief_summary =
              pickBriefSummary(w, topicString) ??
              `Address "${topicString}" within the "${theme}" narrative for ${target_audience}.`;
            const overrideAudienceStage = ensureNonEmptyString((it as any)?.audience_stage ?? null);
            const audience_stage = overrideAudienceStage || audience_awareness_target;
            const recAlign = buildRecommendationAlignment({ topic: topicString, sources: alignmentSources });

            const intent = {
              objective,
              cta_type,
              target_audience,
              writing_angle: topicString ? writingAngle : null,
              brief_summary,
              strategic_role,
              pain_point,
              outcome_promise,
              audience_stage,
              recommendation_alignment: {
                source_type: recAlign.source_type,
                source_value: recAlign.source_value,
                alignment_reason: recAlign.alignment_reason,
              },
            };

            const okIntent =
              ensureNonEmptyString(intent.objective) &&
              ensureNonEmptyString(intent.cta_type) &&
              ensureNonEmptyString(intent.target_audience) &&
              ensureNonEmptyString(intent.strategic_role) &&
              ensureNonEmptyString(intent.pain_point) &&
              ensureNonEmptyString(intent.outcome_promise) &&
              ensureNonEmptyString(intent.audience_stage) &&
              ensureNonEmptyString(intent.recommendation_alignment?.source_type) &&
              ensureNonEmptyString(intent.recommendation_alignment?.source_value) &&
              ensureNonEmptyString(intent.recommendation_alignment?.alignment_reason);
            if (!okIntent) throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_WEEKLY_STRATEGY_REQUIRED');

            const master_content_id = `${campaignIdForMasterContent}_w${weekOrdinal}_${contentTypeForId}_${execIdx}_${slotIndex}`;
            const execution_mode = inferExecutionMode(String(it?.content_type ?? 'post'));
            const creator_instruction =
              execution_mode === 'CREATOR_REQUIRED' || execution_mode === 'CONDITIONAL_AI'
                ? buildCreatorInstruction(topicString, intent, String(it?.content_type ?? 'post'), execution_mode)
                : undefined;
            const day_index = dayIndices[slotIndex] ?? 1;
            return {
              topic: topicString,
              progression_step: slotIndex + 1,
              global_progression_index: 0,
              day_index,
              intent,
              master_content_id,
              execution_mode,
              ...(creator_instruction ? { creator_instruction } : {}),
            };
          }),
        };
      });

      for (const exec of execution_items) {
        const expected = Math.max(0, Math.floor(Number(exec?.count_per_week ?? 0)));
        const actual = Array.isArray(exec?.topic_slots) ? exec.topic_slots.length : 0;
        if (expected !== actual) {
          console.warn('[execution_mode] count_per_week !== topic_slots.length', {
            content_type: exec?.content_type,
            count_per_week: expected,
            topic_slots_length: actual,
          });
        }
      }

      const globalSlots: Array<{ execIdx: number; slotIdx: number; progression_step: number; slot: any }> = [];
      for (let execIdx = 0; execIdx < execution_items.length; execIdx += 1) {
        const exec = execution_items[execIdx];
        const slots = Array.isArray(exec?.topic_slots) ? exec.topic_slots : null;
        if (!slots) throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_GLOBAL_PROGRESSION_REQUIRED');
        for (let slotIdx = 0; slotIdx < slots.length; slotIdx += 1) {
          const slot = slots[slotIdx];
          const progression_step = Number(slot?.progression_step);
          if (!slot || !Number.isFinite(progression_step) || progression_step < 1 || !slot.intent) {
            throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_GLOBAL_PROGRESSION_REQUIRED');
          }
          globalSlots.push({ execIdx, slotIdx, progression_step, slot });
        }
      }
      globalSlots.sort((a, b) => a.progression_step - b.progression_step || a.execIdx - b.execIdx || a.slotIdx - b.slotIdx);
      for (let i = 0; i < globalSlots.length; i += 1) globalSlots[i]!.slot.global_progression_index = i + 1;
      for (const g of globalSlots) {
        const n = Number(g.slot?.global_progression_index);
        if (!Number.isFinite(n) || n < 1) throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_GLOBAL_PROGRESSION_REQUIRED');
      }

      for (const exec of execution_items) {
        const slots = Array.isArray(exec?.topic_slots) ? exec.topic_slots : [];
        const expected = Math.max(0, Math.floor(Number(exec?.count_per_week ?? 0) || 0));
        if (!expected || slots.length !== expected) throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_TOPIC_SLOT_COUNT_MISMATCH');
        for (const slot of slots) {
          const topic = ensureNonEmptyString(slot?.topic);
          if (!topic) throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_WEEKLY_STRATEGY_REQUIRED');
          const progression_step = Number(slot?.progression_step);
          if (!Number.isFinite(progression_step) || progression_step < 1) {
            throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_WEEKLY_STRATEGY_REQUIRED');
          }
          const intent = slot?.intent;
          const ok =
            intent &&
            typeof intent === 'object' &&
            ensureNonEmptyString(intent.objective) &&
            ensureNonEmptyString(intent.cta_type) &&
            ensureNonEmptyString(intent.target_audience) &&
            ensureNonEmptyString(intent.strategic_role) &&
            ensureNonEmptyString(intent.pain_point) &&
            ensureNonEmptyString(intent.outcome_promise) &&
            ensureNonEmptyString(intent.audience_stage) &&
            intent.recommendation_alignment &&
            typeof intent.recommendation_alignment === 'object' &&
            ensureNonEmptyString(intent.recommendation_alignment.source_type) &&
            ensureNonEmptyString(intent.recommendation_alignment.source_value) &&
            ensureNonEmptyString(intent.recommendation_alignment.alignment_reason);
          if (!ok) throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_WEEKLY_STRATEGY_REQUIRED');
        }
        for (let i = 0; i < slots.length; i += 1) {
          const step = Number((slots[i] as any)?.progression_step);
          if (step !== i + 1) throw new BoltError(BOLT_ERROR_CODES.PLAN_STRUCTURE_INVALID, 'DETERMINISTIC_WEEKLY_STRATEGY_REQUIRED');
        }
      }

      return {
        ...w,
        theme,
        campaign_stage,
        weekly_narrative_spine,
        audience_awareness_target,
        platform_allocation: deterministicPlanSkeleton?.platform_allocation ?? w?.platform_allocation,
        content_type_mix: deterministicPlanSkeleton?.content_type_mix ?? w?.content_type_mix,
        total_weekly_content_count: deterministicPlanSkeleton?.total_weekly_content_count ?? w?.total_weekly_content_count,
        execution_items,
      };
    }),
  };
}
