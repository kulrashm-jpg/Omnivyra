/**
 * adaptiveSchedulingService.ts — policy-derived refresh scheduling (CKRE-004 §5).
 *
 * PURE. There is NO fixed schedule — the next refresh time + priority are
 * DERIVED from the company's tier, activity, onboarding state, and refresh
 * signals. Reuses the CKRE-002 refresh config (tier cooldowns) — it does not
 * introduce a second scheduler or duplicate the Refresh Policy Engine's
 * decision (that decides IF/WHAT; this decides WHEN the orchestrator plans).
 */

import { cooldownForTier, type CompanyTier, type RefreshPolicyConfig } from '../crawl/refreshPolicyConfig';

export type ActivityLevel = 'high' | 'low' | 'none';

export interface ScheduleContext {
  tier: CompanyTier;
  activity: ActivityLevel;
  isFirstOnboarding: boolean;
  isNewCompany: boolean;
  manualRefresh: boolean;
  forcedRefresh: boolean;
  lastRefreshAt: string | null;
  lastActivityAt: string | null;
  config: RefreshPolicyConfig;
  now: number;
}

export interface Schedule {
  /** Delay from now (ms) until the next planned refresh. */
  delayMs: number;
  /** Absolute planned time (ms). */
  scheduledAt: number;
  /** Lower = higher priority. */
  priority: number;
  /** Human-readable cadence label. */
  cadence: 'immediate' | 'onboarding' | 'accelerated' | 'baseline' | 'relaxed' | 'dormant';
  reason: string;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function schedule(delayMs: number, priority: number, cadence: Schedule['cadence'], reason: string, now: number): Schedule {
  const d = Math.max(0, delayMs);
  return { delayMs: d, scheduledAt: now + d, priority, cadence, reason };
}

/**
 * Compute the adaptive schedule. Pure — identical context → identical schedule.
 * Evaluation order: forced → manual → onboarding/new → activity-adjusted tier
 * cadence (with long-inactivity relaxation).
 */
export function computeSchedule(ctx: ScheduleContext): Schedule {
  const base = cooldownForTier(ctx.config, ctx.tier);

  if (ctx.forcedRefresh) return schedule(0, 0, 'immediate', 'forced_refresh', ctx.now);
  if (ctx.manualRefresh) return schedule(0, 10, 'immediate', 'manual_refresh', ctx.now);
  if (ctx.isFirstOnboarding || ctx.isNewCompany) return schedule(HOUR, 20, 'onboarding', ctx.isFirstOnboarding ? 'first_onboarding' : 'new_company', ctx.now);

  // Long inactivity → relax cadence (or go dormant when very stale).
  if (ctx.lastActivityAt) {
    const lastActivity = Date.parse(ctx.lastActivityAt);
    if (Number.isFinite(lastActivity)) {
      const inactiveMs = ctx.now - lastActivity;
      if (inactiveMs > 30 * DAY) return schedule(base * 4, 80, 'dormant', 'long_inactivity', ctx.now);
    }
  }

  switch (ctx.activity) {
    case 'high': return schedule(Math.max(HOUR, Math.round(base / 2)), 30, 'accelerated', 'high_activity', ctx.now);
    case 'none': return schedule(base * 2, 70, 'relaxed', 'no_activity', ctx.now);
    case 'low':
    default:     return schedule(base, 50, 'baseline', 'baseline_tier_cadence', ctx.now);
  }
}
