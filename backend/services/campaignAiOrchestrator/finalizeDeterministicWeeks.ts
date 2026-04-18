import { supabase } from '../../db/supabaseClient';
import { getCampaignById } from '../../db/campaignStore';
import { attachGenerationPipelineToDailyItems } from '../contentGenerationPipeline';
import { runAutopilotForPlan } from '../autopilotExecutionPipeline';
import { assignWeeklySchedule } from '../weeklyScheduleAllocator';
import { getEnrichedDistributionInsights } from '../contentDistributionIntelligence';
import { validateWeeklyNarrativeFlow } from '../weeklyNarrativeValidator';
import { balanceWeeklyExecutionLoad } from '../weeklyLoadBalancer';
import { runExecutionPressureBalancer } from '../executionPressureBalancer';
import { analyzeExecutionMomentum } from '../executionMomentumTracker';
import { generateMomentumRecoverySuggestions } from '../momentumRecoveryAdvisor';
import {
  alignDailyExecutionItemsAsSingleSource,
  attachDeterministicWriterBriefsToExecutionSlots,
  attachPostingExecutionMapsToWeeks,
  attachResolvedPostingsToWeeks,
} from './writerBriefBuilders';

interface FinalizeDeterministicWeeksArgs {
  structured: any;
  campaignId: string;
  currentPlanWeeks?: any[] | undefined;
  recommendationContext: any;
  effectivePrefilledPlanning: Record<string, unknown> | null | undefined;
  snapshot: any;
  prefilledPlanning: any;
  autopilot?: boolean;
}

export async function finalizeDeterministicWeeks({
  structured,
  campaignId,
  currentPlanWeeks,
  recommendationContext,
  effectivePrefilledPlanning,
  snapshot,
  prefilledPlanning,
  autopilot,
}: FinalizeDeterministicWeeksArgs): Promise<{ structured: any; autopilotResult?: any }> {
  const weeksArr: any[] = Array.isArray(structured?.weeks) ? (structured.weeks as any[]) : [];
  const orderedWeeks = weeksArr
    .map((w, idx) => {
      const n = Number((w as any)?.week ?? (w as any)?.week_number ?? (w as any)?.weekNumber ?? idx + 1);
      const ord = Number.isFinite(n) && n > 0 ? Math.floor(n) : idx + 1;
      return { w, idx, ord };
    })
    .sort((a, b) => a.ord - b.ord || a.idx - b.idx);

  let globalCounter = 0;
  for (const entry of orderedWeeks) {
    const week = entry.w as any;
    const execItems: any[] = Array.isArray(week?.execution_items) ? week.execution_items : null;
    if (!execItems) throw new Error('DETERMINISTIC_GLOBAL_PROGRESSION_REQUIRED');

    const perWeekSlots: Array<{ execIdx: number; slotIdx: number; progression_step: number; slot: any }> = [];
    for (let execIdx = 0; execIdx < execItems.length; execIdx += 1) {
      const exec = execItems[execIdx];
      const slots: any[] = Array.isArray(exec?.topic_slots) ? exec.topic_slots : null;
      if (!slots) throw new Error('DETERMINISTIC_GLOBAL_PROGRESSION_REQUIRED');
      for (let slotIdx = 0; slotIdx < slots.length; slotIdx += 1) {
        const slot = slots[slotIdx];
        const progression_step = Number(slot?.progression_step);
        if (!slot || !Number.isFinite(progression_step) || progression_step < 1 || !slot.intent) {
          throw new Error('DETERMINISTIC_GLOBAL_PROGRESSION_REQUIRED');
        }
        perWeekSlots.push({ execIdx, slotIdx, progression_step, slot });
      }
    }
    perWeekSlots.sort((a, b) => a.progression_step - b.progression_step || a.execIdx - b.execIdx || a.slotIdx - b.slotIdx);
    for (const s of perWeekSlots) {
      globalCounter += 1;
      s.slot.global_progression_index = globalCounter;
    }
  }

  const weeksForSchedule = Array.isArray(structured?.weeks) ? (structured.weeks as any[]) : [];
  if (weeksForSchedule.length > 0) {
    const region = (effectivePrefilledPlanning as any)?.target_regions
      ? Array.isArray((effectivePrefilledPlanning as any).target_regions)
        ? (effectivePrefilledPlanning as any).target_regions
        : String((effectivePrefilledPlanning as any).target_regions ?? '')
            .split(/[,\s;]+/)
            .map((s: string) => s.trim())
            .filter(Boolean)
      : recommendationContext?.target_regions ?? undefined;
    assignWeeklySchedule({
      weeklyActivities: weeksForSchedule,
      campaignStartDate: undefined,
      region,
    });
    const [versionForSignals, campaignForSignals] = await Promise.all([
      supabase
        .from('campaign_versions')
        .select('company_id')
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      getCampaignById<{ start_date?: string }>(campaignId, 'start_date'),
    ]);
    const signalCompanyId = (versionForSignals.data as { company_id?: string } | null)?.company_id ?? null;
    const signalCampaignStart = campaignForSignals?.start_date ?? null;

    await Promise.all(
      weeksForSchedule.map(async (w) => {
        if (!w || typeof w !== 'object') return;
        const weekNum = Number((w as any).week ?? (w as any).week_number ?? 1);
        (w as any).distribution_insights = await getEnrichedDistributionInsights(w, {
          companyId: signalCompanyId ?? undefined,
          campaignStartDate: signalCampaignStart ?? undefined,
          weekNumber: weekNum,
        });
      })
    );
  }

  validateWeeklyNarrativeFlow(structured?.weeks);
  structured.weeks = balanceWeeklyExecutionLoad(structured?.weeks);
  const executionConfig = (prefilledPlanning as any)?.execution_config ?? (snapshot as any)?.execution_config;
  const pressureResult = runExecutionPressureBalancer(structured.weeks, executionConfig);
  structured.weeks = pressureResult.weeks;
  structured.executionPressureMetadata = {
    ...pressureResult.balanceReport,
    pressureLevel: pressureResult.pressureLevel,
  };
  const momentumResult = analyzeExecutionMomentum(structured.weeks);
  structured.executionMomentumMetadata = {
    state: momentumResult.state,
    signals: momentumResult.signals,
    momentumScore: momentumResult.momentumScore,
    warnings: momentumResult.warnings,
  };
  const momentumRecovery =
    momentumResult.state === 'WEAK' ? generateMomentumRecoverySuggestions(structured.weeks, momentumResult) : null;
  structured.momentumRecoveryMetadata =
    momentumRecovery && momentumRecovery.suggestions.length > 0
      ? { suggestions: momentumRecovery.suggestions, recommendedActions: momentumRecovery.recommendedActions }
      : undefined;

  attachDeterministicWriterBriefsToExecutionSlots(structured?.weeks);
  attachPostingExecutionMapsToWeeks(structured?.weeks);
  attachResolvedPostingsToWeeks(structured?.weeks);
  alignDailyExecutionItemsAsSingleSource({
    weeks: structured?.weeks,
    campaignId,
    currentPlanWeeks,
  });
  await attachGenerationPipelineToDailyItems(structured?.weeks);

  let autopilotResult: any;
  if (autopilot === true) {
    const autopilotRun = await runAutopilotForPlan({ weeks: structured?.weeks }, { timezone: 'UTC' });
    structured.weeks = autopilotRun.plan.weeks;
    autopilotResult = autopilotRun.summary;
  }

  return {
    structured,
    autopilotResult,
  };
}
