/**
 * Learning Orchestration Service
 * Phase 5: Orchestrates outcomes, feedback, learning, theme reinforcement.
 */

import { getOutcomeHistory } from './outcomeTrackingEngine';
import { getFeedbackForCompany } from './recommendationFeedbackEngine';
import { computeLearningForCompany } from './intelligenceLearningEngine';
import { computeThemeReinforcement } from './themeReinforcementEngine';

const DEFAULT_LIMIT = 100;

/**
 * Get outcome history for a company.
 */
export async function getOutcomesForCompany(
  companyId: string,
  options?: { limit?: number }
) {
  const outcomes = await getOutcomeHistory(companyId, {
    limit: options?.limit ?? DEFAULT_LIMIT,
  });
  return { outcomes };
}

/**
 * Get learning adjustments for a company.
 */
export async function getLearningForCompany(companyId: string) {
  const adjustments = await computeLearningForCompany(companyId);
  const reinforcement = await computeThemeReinforcement(companyId);
  return {
    learning: adjustments,
    theme_reinforcement: reinforcement,
  };
}
