/**
 * Credit Advisor — Phase 19: Upgrade Advisor.
 *
 * Deterministic, factual upgrade guidance. NO SALES LANGUAGE. Weighs current
 * runway against the optimization potential to decide whether optimization
 * alone suffices or an upgrade is warranted, and explains the reasoning.
 * READ-ONLY — never triggers a plan change or purchase.
 */

import type {
  ForecastResult,
  RunwayOptimization,
  UpgradeAdvice,
  UpgradeCategory,
} from './creditAdvisorTypes';

const HEALTHY_DAYS = 30;
const MONITOR_DAYS = 15;
const CRITICAL_DAYS = 7;

export function computeUpgradeAdvice(
  planName: string,
  forecast: ForecastResult,
  runway: RunwayOptimization,
): UpgradeAdvice {
  const days = forecast.days_remaining;
  const optimizedDays = runway.optimized_runway_days;
  const optPotential = runway.monthly_credits_saved;

  let category: UpgradeCategory;
  let reasoning: string;

  const optimizationRestoresHealthy = optimizedDays !== null && optimizedDays >= HEALTHY_DAYS;

  if (days === null || days >= HEALTHY_DAYS) {
    category = 'No Upgrade Needed';
    reasoning =
      days === null
        ? 'Consumption is negligible in this window, so there is no runway pressure.'
        : `Credits are projected to last ~${days} days at the current burn rate, which is a healthy runway.`;
  } else if (days >= MONITOR_DAYS) {
    category = 'Optimization Recommended';
    reasoning = `Runway is ~${days} days (monitor range). The detected optimizations could recover ~${optPotential} credits/month${
      optimizedDays !== null ? ` and extend runway to ~${optimizedDays} days` : ''
    }, so optimization is the recommended first step before any upgrade.`;
  } else if (days >= CRITICAL_DAYS) {
    if (optimizationRestoresHealthy) {
      category = 'Optimization Recommended';
      reasoning = `Runway is short (~${days} days), but applying the detected optimizations would extend it to ~${optimizedDays} days — optimization alone is sufficient, an upgrade is not required yet.`;
    } else {
      category = 'Upgrade Recommended';
      reasoning = `Runway is short (~${days} days) and optimization alone${
        optimizedDays !== null ? ` only reaches ~${optimizedDays} days` : ' is insufficient'
      }. A larger credit allowance would be needed to maintain current activity.`;
    }
  } else {
    if (optimizationRestoresHealthy) {
      category = 'Optimization Recommended';
      reasoning = `Runway is critical (~${days} days), but the detected optimizations would extend it to ~${optimizedDays} days, which avoids the need to upgrade immediately.`;
    } else {
      category = 'Immediate Upgrade Recommended';
      reasoning = `Runway is critical (~${days} days) and optimization alone${
        optimizedDays !== null ? ` only reaches ~${optimizedDays} days` : ' cannot close the gap'
      }. Without more credits, activity will be interrupted${
        forecast.projected_exhaustion_date ? ` around ${forecast.projected_exhaustion_date}` : ''
      }.`;
    }
  }

  return {
    current_plan: planName,
    projected_exhaustion_date: forecast.projected_exhaustion_date,
    days_remaining: days,
    optimization_potential_monthly_credits: optPotential,
    category,
    reasoning,
  };
}
