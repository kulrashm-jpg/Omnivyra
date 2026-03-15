/**
 * Campaign Plan Core
 * Parse and validate only. No AI execution.
 */

import { parseAiPlanToWeeks } from './campaignPlanParser';
import { validateWeeklyPlan } from './aiOutputValidationService';
import type { ParsedPlan } from './campaignPlanParser';
import type { PlanningParseInput } from '../types/campaignPlanning';

export type { ParsedPlan };

/**
 * Parse raw AI output and validate weekly structure.
 */
export async function parseAndValidateCampaignPlan(input: PlanningParseInput): Promise<ParsedPlan> {
  const planMatch = input.rawOutput.match(/BEGIN_12WEEK_PLAN([\s\S]*?)END_12WEEK_PLAN/);
  const planText = planMatch ? planMatch[1].trim() : input.rawOutput;
  let parsed = await parseAiPlanToWeeks(planText);
  try {
    parsed = validateWeeklyPlan(parsed);
  } catch {
    // use as-is if validation throws
  }
  return parsed;
}
