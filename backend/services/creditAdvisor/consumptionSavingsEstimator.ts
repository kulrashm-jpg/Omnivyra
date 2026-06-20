/**
 * Credit Advisor — Phase 14: Savings Calculation Engine.
 *
 * Pure, deterministic savings math. Given a current monthly consumption and a
 * savings ratio, produce the full savings breakdown. NO AI.
 */

import type { SavingsEstimate } from './creditAdvisorTypes';

/**
 * @param currentMonthlyCredits  observed (monthly-extrapolated) credits for the target
 * @param savingsRatio           fraction removable (0..1)
 */
export function estimateSavings(
  currentMonthlyCredits: number,
  savingsRatio: number,
): SavingsEstimate {
  const current = Math.max(0, Math.round(currentMonthlyCredits));
  const ratio = Math.min(1, Math.max(0, savingsRatio));
  const saved = Math.round(current * ratio);
  const optimized = current - saved;

  return {
    current_monthly_credits: current,
    optimized_monthly_credits: optimized,
    potential_savings_credits: saved,
    potential_savings_pct: current > 0 ? Math.round(ratio * 1000) / 10 : 0,
    potential_monthly_savings_credits: saved,
    potential_annual_savings_credits: saved * 12,
  };
}
