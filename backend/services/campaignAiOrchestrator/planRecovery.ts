import { generateCampaignPlanAI } from '../aiPlanningService';
import { parseAndValidateCampaignPlan } from '../campaignPlanCore';
import { buildPlaceholderPlanFromSkeleton, validatePlanAgainstSkeleton } from '../campaign-ai/campaignAiPlanSkeleton';
import { canonicalJsonStringify } from '../viralitySnapshotBuilder';

type GenerationMode = 'llm-generated' | 'fallback-placeholder';

interface PlanRecoveryArgs {
  companyId: string;
  inputMode: string;
  raw: string;
  planText: string;
  planningInput: Record<string, unknown>;
  planSkeleton: any;
  prefilledPlanning: Record<string, unknown> | null | undefined;
  hasDeterministicPlanSkeleton: boolean;
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
}: PlanRecoveryArgs): Promise<PlanRecoveryResult> {
  let structured: any;
  let didParseFail = false;
  let didValidationFail = false;
  let regenerationTriggered = false;
  let fallbackTriggered = false;
  let generationMode: GenerationMode = 'llm-generated';
  let validationReasons: string[] = [];

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
      try {
        regenerationTriggered = true;
        const repairInstruction =
          'Your previous output could not be parsed. Regenerate using the deterministic skeleton exactly. Keep BEGIN_12WEEK_PLAN/END_12WEEK_PLAN and output a strict weekly blueprint.\n' +
          `Skeleton JSON:\n${canonicalJsonStringify(planSkeleton)}`;
        const repairInput = {
          ...planningInput,
          repair_instruction: repairInstruction,
        };
        const { rawOutput: repairedRaw } = await generateCampaignPlanAI(repairInput as any);
        structured = await parseAndValidateCampaignPlan({
          companyId,
          rawOutput: repairedRaw,
        });
      } catch (regenParseErr) {
        console.warn('Plan parse + regeneration failed, using deterministic placeholder fallback:', regenParseErr);
        fallbackTriggered = true;
        generationMode = 'fallback-placeholder';
        structured = buildPlaceholder(planSkeleton, prefilledPlanning);
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
      };
    }
  }

  if (inputMode === 'generate_plan' && planSkeleton) {
    const validation = validatePlanAgainstSkeleton(structured, planSkeleton);
    if (!validation.ok) {
      didValidationFail = true;
      validationReasons = validation.reasons;
      console.warn('[campaign-ai][validation-failed]', {
        reasons: validation.reasons,
      });
      const repairInstruction =
        `Your previous plan violated deterministic skeleton constraints: ${validation.reasons.join('; ')}.\nRegenerate the plan exactly with this skeleton and keep the same wrapper markers.\n` +
        `Skeleton JSON:\n${canonicalJsonStringify(planSkeleton)}`;
      try {
        regenerationTriggered = true;
        const repairInput = {
          ...planningInput,
          repair_instruction: repairInstruction,
        };
        const { rawOutput: repairedRaw } = await generateCampaignPlanAI(repairInput as any);
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
        }
      } catch (regenErr) {
        console.warn('Deterministic regeneration failed, using placeholder skeleton:', regenErr);
        fallbackTriggered = true;
        generationMode = 'fallback-placeholder';
        structured = buildPlaceholder(planSkeleton, prefilledPlanning);
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
  };
}
