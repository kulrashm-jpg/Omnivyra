/**
 * Credit Deduction Service — Utilities Only
 *
 * This file provides:
 *   - CreditAction type and CREDIT_COSTS map (hardcoded fallback)
 *   - getCreditCost()       — DB-first cost lookup with hardcoded fallback
 *   - hasEnoughCredits()    — balance pre-check (reads category wallets)
 *   - wasRecentlyRun()      — smart-mode dedup window check
 *   - estimateCreditCost()  — cost estimation for UI display
 *   - getCreditCostTiers()  — grouped tier structure for pricing UI
 *   - hasFreeCreditAccess() — domain eligibility gate
 *   - SMART_MODE_DEDUP_SECONDS — per-action dedup windows
 *
 * ALL credit mutations go through creditExecutionService.
 * This file MUST NOT call any credit-mutating RPC or insert any rows.
 */

import { supabase } from '../db/supabaseClient';
import { checkDomainEligibility } from './domainEligibilityService';
import { getTotalAvailable } from './creditPriorityService';

// ── Credit cost map ───────────────────────────────────────────────────────────

export type CreditAction =
  // Low — frequent
  | 'ai_reply'            // 1
  | 'auto_post'           // 2
  | 'content_rewrite'     // 3
  | 'content_basic'       // 5
  | 'reply_generation'    // 2  — community reply
  // Medium — value actions
  | 'trend_analysis'      // 25
  | 'market_insight_manual' // 30
  | 'campaign_creation'   // 40
  | 'website_audit'       // 50
  | 'prediction'          // 10 — campaign outcome prediction
  | 'insight_generation'  // 8  — intelligence insight
  | 'pattern_detection'   // 12 — pattern detection sweep
  | 'market_positioning'  // 10 — market positioning eval
  | 'competitor_signals'  // 8  — competitor intelligence
  // High — system/background (value-gated)
  | 'lead_detection'      // 15 (only if lead found)
  | 'daily_insight_scan'  // 20 (only if actionable insight found)
  | 'campaign_optimization' // 30 (only if change recommended)
  | 'optimization_loop'   // 15 — live optimization iteration
  | 'portfolio_decision'  // 20 — multi-campaign rebalancing
  | 'strategy_evolution'  // 15 — strategy evolution
  // Heavy — LLM/voice/multi-step
  | 'voice_per_minute'    // 10
  | 'deep_analysis'       // 60
  | 'full_strategy'       // 80
  | 'campaign_generation'; // 50 — autonomous campaign generation

export const CREDIT_COSTS: Record<CreditAction, number> = {
  // Low
  ai_reply:              1,
  auto_post:             2,
  content_rewrite:       3,
  content_basic:         5,
  reply_generation:      2,
  // Medium
  trend_analysis:        25,
  market_insight_manual: 30,
  campaign_creation:     40,
  website_audit:         50,
  prediction:            10,
  insight_generation:    8,
  pattern_detection:     12,
  market_positioning:    10,
  competitor_signals:    8,
  // High (background — charged only when value delivered)
  lead_detection:        15,
  daily_insight_scan:    20,
  campaign_optimization: 30,
  optimization_loop:     15,
  portfolio_decision:    20,
  strategy_evolution:    15,
  // Heavy
  voice_per_minute:      10,
  deep_analysis:         60,
  full_strategy:         80,
  campaign_generation:   50,
};

// ── DB-driven cost getter (overrides hardcoded map when config row exists) ─────

/** Returns the credit cost for an action, preferring DB config over hardcoded map. */
export async function getCreditCost(action: CreditAction): Promise<number> {
  try {
    const { data } = await supabase
      .from('credit_cost_config')
      .select('credits')
      .eq('action_type', action)
      .maybeSingle();
    if (data && typeof (data as any).credits === 'number') {
      return (data as any).credits as number;
    }
  } catch {
    // fall through to hardcoded
  }
  return CREDIT_COSTS[action];
}

// ── Smart Mode dedup windows (seconds) ────────────────────────────────────────
// Skip re-running the same background action within this window.
export const SMART_MODE_DEDUP_SECONDS: Partial<Record<CreditAction, number>> = {
  daily_insight_scan:    86_400, // 24 h
  trend_analysis:        3_600,  // 1 h
  lead_detection:        21_600, // 6 h
  campaign_optimization: 43_200, // 12 h
  website_audit:         86_400, // 24 h
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeductOptions {
  userId?: string;
  campaignId?: string;
  referenceId?: string;
  note?: string;
  /** Override credit cost (e.g. voice = cost × minutes) */
  multiplier?: number;
  /** Metadata stored alongside the transaction */
  metadata?: Record<string, unknown>;
}

export type DeductResult =
  | { success: true; creditsCharged: number; balanceAfter: number; reason?: undefined; detail?: undefined }
  | { success: false; reason: 'insufficient_credits' | 'no_credit_account' | 'error'; detail?: string }
  | { success: true; skipped: true; reason: 'smart_mode_dedup'; detail?: undefined };

// ── Smart Mode dedup check ────────────────────────────────────────────────────

/**
 * Returns true if this action was charged (CONFIRM phase) for this org
 * within the last `windowSeconds` seconds.
 * Reads from credit_transactions — no writes.
 */
export async function wasRecentlyRun(
  orgId: string,
  action: CreditAction,
  windowSeconds: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { data } = await supabase
    .from('credit_transactions')
    .select('id')
    .eq('organization_id', orgId)
    .eq('reference_type', action)
    .eq('execution_phase', 'confirm')
    .gt('created_at', since)
    .limit(1)
    .maybeSingle();
  return !!data;
}

// ── Balance check (no mutation) ───────────────────────────────────────────────

/**
 * Check if an org has enough credits for an action without deducting.
 * Reads category wallets (free + incentive + paid, minus reservations).
 * Use before starting expensive operations.
 */
export async function hasEnoughCredits(
  orgId: string,
  action: CreditAction,
  multiplier = 1,
): Promise<{ sufficient: boolean; balance: number | null; required: number }> {
  const required = Math.round(CREDIT_COSTS[action] * multiplier);
  const balance = await getTotalAvailable(orgId);
  return { sufficient: (balance ?? 0) >= required, balance, required };
}

// ── Cost estimation (pure, no DB) ─────────────────────────────────────────────

/**
 * Calculate credit cost for display (e.g. voice: cost × minutes).
 * Pure function — no DB access.
 */
export function estimateCreditCost(action: CreditAction, multiplier = 1): number {
  return Math.round(CREDIT_COSTS[action] * multiplier);
}

/**
 * Returns all action costs grouped by tier for display in UI.
 * Pure function — no DB access.
 */
export function getCreditCostTiers() {
  return {
    low: {
      label: 'Low — frequent actions',
      color: 'emerald',
      actions: [
        { action: 'ai_reply'       as CreditAction, label: 'AI reply suggestion',      credits: CREDIT_COSTS.ai_reply },
        { action: 'auto_post'      as CreditAction, label: 'Social auto-post',          credits: CREDIT_COSTS.auto_post },
        { action: 'content_rewrite'as CreditAction, label: 'Content rewrite',           credits: CREDIT_COSTS.content_rewrite },
        { action: 'content_basic'  as CreditAction, label: 'Basic content generation',  credits: CREDIT_COSTS.content_basic },
      ],
    },
    medium: {
      label: 'Medium — value actions',
      color: 'blue',
      actions: [
        { action: 'trend_analysis'        as CreditAction, label: 'Trend analysis',            credits: CREDIT_COSTS.trend_analysis },
        { action: 'market_insight_manual' as CreditAction, label: 'Market insight (manual)',   credits: CREDIT_COSTS.market_insight_manual },
        { action: 'campaign_creation'     as CreditAction, label: 'Campaign creation',          credits: CREDIT_COSTS.campaign_creation },
        { action: 'website_audit'         as CreditAction, label: 'Website audit',              credits: CREDIT_COSTS.website_audit },
      ],
    },
    high: {
      label: 'High — smart background actions',
      color: 'amber',
      note: 'Charged only when actionable output is found',
      actions: [
        { action: 'lead_detection'        as CreditAction, label: 'Lead signal detection',       credits: CREDIT_COSTS.lead_detection },
        { action: 'daily_insight_scan'    as CreditAction, label: 'Daily insight scan',           credits: CREDIT_COSTS.daily_insight_scan },
        { action: 'campaign_optimization' as CreditAction, label: 'Campaign optimisation scan',   credits: CREDIT_COSTS.campaign_optimization },
      ],
    },
    heavy: {
      label: 'Heavy — LLM / voice / multi-step',
      color: 'violet',
      actions: [
        { action: 'voice_per_minute' as CreditAction, label: 'Voice interaction',         credits: CREDIT_COSTS.voice_per_minute, unit: '/min' },
        { action: 'deep_analysis'    as CreditAction, label: 'Deep multi-step analysis',  credits: CREDIT_COSTS.deep_analysis },
        { action: 'full_strategy'    as CreditAction, label: 'Full campaign strategy',    credits: CREDIT_COSTS.full_strategy },
      ],
    },
  };
}

// ── Domain eligibility gate ───────────────────────────────────────────────────

/**
 * Returns whether a user's email domain qualifies for free credit access.
 * Eligible   → may claim free credits immediately.
 * Pending    → must submit an access request; admin approval required.
 * Blocked    → not eligible; no access request allowed.
 */
export async function hasFreeCreditAccess(userId: string): Promise<{
  allowed: boolean;
  status: 'eligible' | 'pending_review' | 'blocked';
  reason: string;
}> {
  const { data: userRow, error } = await supabase
    .from('users')
    .select('email')
    .eq('id', userId)
    .maybeSingle();
  if (error || !(userRow as any)?.email) {
    return { allowed: false, status: 'blocked', reason: 'user_not_found' };
  }

  const result = await checkDomainEligibility((userRow as any).email, userId);

  return {
    allowed: result.status === 'eligible',
    status: result.status,
    reason: result.reason,
  };
}
