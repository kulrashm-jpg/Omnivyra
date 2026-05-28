import { generateCampaignPlanAI } from '../aiPlanningService';
import { parseAndValidateCampaignPlan } from '../campaignPlanCore';
import { buildPlaceholderPlanFromSkeleton, validatePlanAgainstSkeleton } from '../campaign-ai/campaignAiPlanSkeleton';
import { canonicalJsonStringify } from '../viralitySnapshotBuilder';
import { logger } from '../logger';
import { getRequestContext } from '../requestContext';
import { recordPlannerAlertCounter } from '../plannerAlerting';

type GenerationMode = 'llm-generated' | 'fallback-placeholder';

type RepairStage = 'parse_repair' | 'skeleton_repair' | 'validation_repair';

interface PlanRecoveryArgs {
  companyId: string;
  inputMode: string;
  raw: string;
  planText: string;
  planningInput: Record<string, unknown>;
  planSkeleton: any;
  prefilledPlanning: Record<string, unknown> | null | undefined;
  hasDeterministicPlanSkeleton: boolean;
  /**
   * Optional substage emitter so parse-repair and skeleton-repair steps can
   * surface progress to the UI instead of sitting silently under the
   * drafting label.
   */
  onSubStage?: (substage: string) => void;
  /**
   * Outer AbortSignal forwarded into the repair LLM calls. Independent from
   * (and ANDed with) the local repair-budget AbortController.
   */
  signal?: AbortSignal;
  /**
   * Total budget (ms) shared across ALL repair phases combined. When this
   * budget expires we abort any in-flight repair, skip remaining repairs, and
   * fall back to the deterministic placeholder. Falls back to env
   * REPAIR_BUDGET_MS (default 30s) when not supplied.
   */
  repairBudgetMs?: number;
}

interface PlanRecoveryResult {
  structured: any;
  conversationalResponse?: string;
  didParseFail: boolean;
  didValidationFail: boolean;
  regenerationTriggered: boolean;
  fallbackTriggered: boolean;
  generationMode: GenerationMode;
  validationReasons: string[];
  /**
   * Set when the shared repair budget was exhausted before all repair stages
   * could finish. The orchestrator surfaces this on the omnivyre_decision so
   * ops can correlate against drafting / alignment budget exceedances.
   */
  repairBudgetExceeded: boolean;
  /** Repair stages that ran (regardless of success). For forensic logs. */
  completedRepairStages: RepairStage[];
}

function buildPlaceholder(planSkeleton: any, prefilledPlanning: Record<string, unknown> | null | undefined) {
  return buildPlaceholderPlanFromSkeleton({
    skeleton: planSkeleton,
    prefilledPlanning: prefilledPlanning ?? null,
  }) as any;
}

export async function parseStructuredPlanWithRecovery({
  companyId,
  inputMode,
  raw,
  planText,
  planningInput,
  planSkeleton,
  prefilledPlanning,
  hasDeterministicPlanSkeleton,
  onSubStage,
  signal,
  repairBudgetMs,
}: PlanRecoveryArgs): Promise<PlanRecoveryResult> {
  const emit = (substage: string): void => {
    if (!onSubStage) return;
    try { onSubStage(substage); } catch { /* observer errors are swallowed */ }
  };

  // ── Shared repair budget ─────────────────────────────────────────────────
  // One AbortController, one timer, covers every repair LLM call in this
  // recovery pass. Pre-fix, parse-repair + skeleton-repair were each bounded
  // only by the gateway's per-call provider timeout (30s × 2 = 60s worst).
  // The shared budget tightens that to a single configurable ceiling.
  const repairBudget = Math.max(
    1000,
    Number(repairBudgetMs ?? process.env.REPAIR_BUDGET_MS ?? 30_000),
  );
  const repairController = new AbortController();
  const repairStartedAt = Date.now();
  const completedRepairStages: RepairStage[] = [];

  // If the OUTER signal (e.g. global planner budget) fires, propagate to the
  // repair controller so any in-flight repair call also aborts.
  const onOuterAbort = (): void => {
    try { repairController.abort(); } catch { /* already aborted */ }
  };
  if (signal) signal.addEventListener('abort', onOuterAbort, { once: true });

  // Combined signal for the repair LLM calls.
  const repairSignal = repairController.signal;

  let repairTimerHandle: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    try { repairController.abort(); } catch { /* already aborted */ }
  }, repairBudget);
  let repairBudgetExceeded = false;
  const markBudgetExceededIfAborted = (): void => {
    if (repairController.signal.aborted && !signal?.aborted) {
      // Aborted by OUR timer, not by an outer abort.
      repairBudgetExceeded = true;
    }
  };

  const repairBudgetRemaining = (): number =>
    Math.max(0, repairBudget - (Date.now() - repairStartedAt));

  const cleanupRepairTimer = (): void => {
    if (repairTimerHandle) {
      clearTimeout(repairTimerHandle);
      repairTimerHandle = null;
    }
    if (signal) {
      // Remove the outer listener so the outer signal does not retain a
      // reference to our local handler after we return.
      signal.removeEventListener('abort', onOuterAbort);
    }
  };

  let structured: any;
  let didParseFail = false;
  let didValidationFail = false;
  let regenerationTriggered = false;
  let fallbackTriggered = false;
  let generationMode: GenerationMode = 'llm-generated';
  let validationReasons: string[] = [];

  const emitBudgetExceededLog = (): void => {
    logger.warn('repair_budget_exceeded_using_placeholder', {
      request_id: getRequestContext().requestId,
      company_id: companyId,
      duration_ms: Date.now() - repairStartedAt,
      completed_repair_stages: completedRepairStages,
      budget_ms: repairBudget,
    });
    recordPlannerAlertCounter('repair_budget_exceeded');
  };

  try {
    try {
      structured = await parseAndValidateCampaignPlan({
        companyId,
        rawOutput: raw,
      });
    } catch (parseError) {
      didParseFail = true;
      const detectedWeeks =
        (planText.match(/(?:\*\*?\s*Week\s+\d+\s*\*\*?:?|(?:^|\n)\s*Week\s+\d+\s*:|(?:^|\n)\s*\d+\.\s*Week Number:\s*Week\s+\d+)/gim) || [])
          .length;
      const missingSections: string[] = [];
      if (!/week/i.test(planText)) missingSections.push('week headers');
      if (!/objective/i.test(planText)) missingSections.push('objective');
      if (!/theme|topics?\s*to\s*cover/i.test(planText)) missingSections.push('theme/topic');
      console.warn('[campaign-ai][parse-debug]', {
        rawLength: planText.length,
        parserStage: 'parseAiPlanToWeeks-throw',
        detectedWeeks,
        parseError: parseError instanceof Error ? parseError.message : String(parseError),
        missingSections,
      });

      if (inputMode === 'generate_plan' && hasDeterministicPlanSkeleton) {
        throw parseError;
      }

      if (inputMode === 'generate_plan' && planSkeleton) {
        // ── Parse repair, inside shared repair budget ──────────────────────
        if (repairBudgetRemaining() <= 0) {
          repairBudgetExceeded = true;
          emitBudgetExceededLog();
          fallbackTriggered = true;
          generationMode = 'fallback-placeholder';
          structured = buildPlaceholder(planSkeleton, prefilledPlanning);
        } else {
          emit('repairing-malformed-structure');
          const parseRepairStartedAt = Date.now();
          let parseRepairSuccess = false;
          try {
            regenerationTriggered = true;
            const repairInstruction =
              'Your previous output could not be parsed. Regenerate using the deterministic skeleton exactly. Keep BEGIN_12WEEK_PLAN/END_12WEEK_PLAN and output a strict weekly blueprint.\n' +
              `Skeleton JSON:\n${canonicalJsonStringify(planSkeleton)}`;
            const repairInput = {
              ...planningInput,
              repair_instruction: repairInstruction,
            };
            const { rawOutput: repairedRaw } = await generateCampaignPlanAI(
              repairInput as any,
              { signal: repairSignal, pool: 'repair' },
            );
            completedRepairStages.push('parse_repair');
            emit('validating-repaired-campaign');
            structured = await parseAndValidateCampaignPlan({
              companyId,
              rawOutput: repairedRaw,
            });
            completedRepairStages.push('validation_repair');
            parseRepairSuccess = true;
          } catch (regenParseErr) {
            markBudgetExceededIfAborted();
            if (repairBudgetExceeded) {
              emitBudgetExceededLog();
            } else {
              logger.warn('plan_parse_repair_failed_using_placeholder', {
                request_id: getRequestContext().requestId,
                company_id: companyId,
                error: regenParseErr instanceof Error ? regenParseErr.message : String(regenParseErr),
              });
            }
            fallbackTriggered = true;
            generationMode = 'fallback-placeholder';
            structured = buildPlaceholder(planSkeleton, prefilledPlanning);
          } finally {
            logger.info('campaign_ai_plan_phase', {
              request_id: getRequestContext().requestId,
              company_id: companyId,
              stage: 'parse_repair',
              duration_ms: Date.now() - parseRepairStartedAt,
              success: parseRepairSuccess,
              repair_budget_remaining_ms: repairBudgetRemaining(),
            });
          }
        }
      } else {
        console.warn('Plan parse failed, treating as conversational:', parseError);
        return {
          structured: null,
          conversationalResponse: planText || raw,
          didParseFail,
          didValidationFail,
          regenerationTriggered,
          fallbackTriggered,
          generationMode,
          validationReasons,
          repairBudgetExceeded,
          completedRepairStages,
        };
      }
    }

    if (inputMode === 'generate_plan' && planSkeleton) {
      const validation = validatePlanAgainstSkeleton(structured, planSkeleton);
      if (!validation.ok) {
        didValidationFail = true;
        validationReasons = validation.reasons;
        logger.warn('plan_skeleton_validation_failed', {
          request_id: getRequestContext().requestId,
          company_id: companyId,
          reasons: validation.reasons,
        });

        if (repairBudgetRemaining() <= 0) {
          repairBudgetExceeded = true;
          emitBudgetExceededLog();
          fallbackTriggered = true;
          generationMode = 'fallback-placeholder';
          structured = buildPlaceholder(planSkeleton, prefilledPlanning);
        } else {
          emit('repairing-campaign-skeleton');
          const repairInstruction =
            `Your previous plan violated deterministic skeleton constraints: ${validation.reasons.join('; ')}.\nRegenerate the plan exactly with this skeleton and keep the same wrapper markers.\n` +
            `Skeleton JSON:\n${canonicalJsonStringify(planSkeleton)}`;
          const skeletonRepairStartedAt = Date.now();
          let skeletonRepairSuccess = false;
          try {
            regenerationTriggered = true;
            const repairInput = {
              ...planningInput,
              repair_instruction: repairInstruction,
            };
            const { rawOutput: repairedRaw } = await generateCampaignPlanAI(
              repairInput as any,
              { signal: repairSignal, pool: 'repair' },
            );
            completedRepairStages.push('skeleton_repair');
            emit('validating-repaired-campaign');
            structured = await parseAndValidateCampaignPlan({
              companyId,
              rawOutput: repairedRaw,
            });
            const repairedValidation = validatePlanAgainstSkeleton(structured, planSkeleton);
            if (!repairedValidation.ok) {
              validationReasons = repairedValidation.reasons;
              fallbackTriggered = true;
              generationMode = 'fallback-placeholder';
              structured = buildPlaceholder(planSkeleton, prefilledPlanning);
            } else {
              completedRepairStages.push('validation_repair');
              skeletonRepairSuccess = true;
            }
          } catch (regenErr) {
            markBudgetExceededIfAborted();
            if (repairBudgetExceeded) {
              emitBudgetExceededLog();
            } else {
              logger.warn('plan_skeleton_repair_failed_using_placeholder', {
                request_id: getRequestContext().requestId,
                company_id: companyId,
                error: regenErr instanceof Error ? regenErr.message : String(regenErr),
              });
            }
            fallbackTriggered = true;
            generationMode = 'fallback-placeholder';
            structured = buildPlaceholder(planSkeleton, prefilledPlanning);
          } finally {
            logger.info('campaign_ai_plan_phase', {
              request_id: getRequestContext().requestId,
              company_id: companyId,
              stage: 'skeleton_repair',
              duration_ms: Date.now() - skeletonRepairStartedAt,
              success: skeletonRepairSuccess,
              repair_budget_remaining_ms: repairBudgetRemaining(),
            });
          }
        }
      }
    }

    return {
      structured,
      didParseFail,
      didValidationFail,
      regenerationTriggered,
      fallbackTriggered,
      generationMode,
      validationReasons,
      repairBudgetExceeded,
      completedRepairStages,
    };
  } finally {
    cleanupRepairTimer();
  }
}
