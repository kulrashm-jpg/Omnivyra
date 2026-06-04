/**
 * Credit Deduction Service — Utilities Only
 *
 * This file provides:
 *   - CreditAction type
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
import { reviewableResults } from '../../lib/auth/domainEligibilityModel';
import { getTotalAvailable } from './creditPriorityService';
import { getFeatureDisplayGroup, resolveMonetizationFeature } from '../../shared/monetization/featureRegistry';

// ── Credit cost map ───────────────────────────────────────────────────────────

export type CreditAction =
  // Low — frequent
  | 'ai_reply'            // 1
  | 'auto_post'           // 2
  | 'content_rewrite'     // 3
  | 'content_basic'       // 5
  | 'content_generation'  // token-priced master content generation (activity workspace)
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
  | 'campaign_generation' // 50 — autonomous campaign generation
  // Phase 2 §C.4 coverage (catalog rows: migration 20260665). Resolved via
  // getCreditCost DB fallback (?? action); no registry feature entry needed.
  | 'blog_generation'
  | 'blog_rewrite_hook'
  | 'blog_brief_suggestions'
  | 'content_repurpose'
  | 'content_suggestions'
  | 'quick_platform_adapt'
  | 'creator_content'
  | 'chat_theme_refine'
  | 'engagement_refine'
  | 'campaign_chat'
  | 'campaign_suggest_update'
  | 'campaign_suggest_duration'
  | 'campaign_preplanning'
  | 'skeleton_command'
  | 'async_campaign_planning'
  | 'recommendations_generate'
  | 'recommendations_opportunities'
  | 'recommendations_preview_strategy'
  | 'recommendations_group_preview'
  // Lead-capture intelligence (catalog rows: migration 20260821). Value-gated,
  // charged per qualified lead — see leadQualifier.ts / leadPredictiveQualifier.ts.
  | 'lead_qualification'
  | 'lead_predictive_scoring'
  // Asset / image / video generation (Phase 10D — activity-economy catalog
  // coverage). Settled via per-asset cost profiles (creator/costProfiles.ts),
  // not a flat credit_cost_config row — like content_generation, getCreditCost
  // is never called for these (callers pass amountOverride from the estimator).
  | 'image_generation'
  | 'video_generation';
export const CREDIT_ACTIONS: CreditAction[] = [
  'ai_reply',
  'auto_post',
  'content_rewrite',
  'content_basic',
  'content_generation',
  'reply_generation',
  'trend_analysis',
  'market_insight_manual',
  'campaign_creation',
  'website_audit',
  'prediction',
  'insight_generation',
  'pattern_detection',
  'market_positioning',
  'competitor_signals',
  'lead_detection',
  'daily_insight_scan',
  'campaign_optimization',
  'optimization_loop',
  'portfolio_decision',
  'strategy_evolution',
  'voice_per_minute',
  'deep_analysis',
  'full_strategy',
  'campaign_generation',
  // Phase 2 §C.4 coverage
  'blog_generation',
  'blog_rewrite_hook',
  'blog_brief_suggestions',
  'content_repurpose',
  'content_suggestions',
  'quick_platform_adapt',
  'creator_content',
  'chat_theme_refine',
  'engagement_refine',
  'campaign_chat',
  'campaign_suggest_update',
  'campaign_suggest_duration',
  'campaign_preplanning',
  'skeleton_command',
  'async_campaign_planning',
  'recommendations_generate',
  'recommendations_opportunities',
  'recommendations_preview_strategy',
  'recommendations_group_preview',
  // Lead-capture intelligence (migration 20260821)
  'lead_qualification',
  'lead_predictive_scoring',
  // Asset / image / video generation (Phase 10D)
  'image_generation',
  'video_generation',
];

// ── DB-driven cost getter (overrides hardcoded map when config row exists) ─────

/** Returns the credit cost for an action from credit_cost_config. */
export async function getCreditCost(action: CreditAction): Promise<number> {
  const feature = resolveMonetizationFeature({ action_key: action });
  const costConfigKey = feature?.feature.pricing_keys.credit_cost_config ?? action;
  const { data, error } = await supabase
    .from('credit_cost_config')
    .select('credits')
    .eq('action_type', costConfigKey)
    .maybeSingle();
  if (error) {
    throw new Error(`[creditDeduction] credit cost lookup failed for ${costConfigKey}: ${error.message}`);
  }
  if (!data || typeof (data as any).credits !== 'number') {
    throw new Error(`[creditDeduction] missing credit cost config for ${costConfigKey}`);
  }
  return (data as any).credits as number;
}

// ── Smart Mode dedup windows (seconds) ────────────────────────────────────────
// Skip re-running the same background action within this window.
export async function getSmartModeDedupSeconds(action: CreditAction): Promise<number | undefined> {
  const feature = resolveMonetizationFeature({ action_key: action });
  const costConfigKey = feature?.feature.pricing_keys.credit_cost_config ?? action;
  const { data, error } = await supabase
    .from('credit_cost_config')
    .select('smart_dedup_seconds')
    .eq('action_type', costConfigKey)
    .maybeSingle();

  if (error) {
    throw new Error(`[creditDeduction] dedup lookup failed for ${costConfigKey}: ${error.message}`);
  }

  const seconds = typeof (data as any)?.smart_dedup_seconds === 'number'
    ? (data as any).smart_dedup_seconds
    : 0;

  return seconds > 0 ? seconds : undefined;
}

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
  const required = Math.round((await getCreditCost(action)) * multiplier);
  const balance = await getTotalAvailable(orgId);
  return { sufficient: (balance ?? 0) >= required, balance, required };
}

// ── Cost estimation (pure, no DB) ─────────────────────────────────────────────

/**
 * Calculate credit cost for display (e.g. voice: cost × minutes).
 * Pure function — no DB access.
 */
export function estimateCreditCost(action: CreditAction, multiplier = 1): number {
  throw new Error(`[creditDeduction] estimateCreditCost is no longer supported for ${action}; use getCreditCost()`);
}

/**
 * Returns all action costs grouped by tier for display in UI.
 */
export async function getCreditCostTiers() {
  const { data, error } = await supabase
    .from('credit_cost_config')
    .select('action_type, credits, category, description')
    .order('category')
    .order('action_type');

  if (error) {
    throw new Error(`[creditDeduction] failed to load credit tiers: ${error.message}`);
  }

  const buckets: Record<string, { label: string; color: string; actions: Array<Record<string, unknown>>; note?: string }> = {
    low: { label: 'Low — frequent actions', color: 'emerald', actions: [] },
    medium: { label: 'Medium — value actions', color: 'blue', actions: [] },
    high: { label: 'High — smart background actions', color: 'amber', note: 'Charged only when actionable output is found', actions: [] },
    heavy: { label: 'Heavy — LLM / voice / multi-step', color: 'violet', actions: [] },
  };

  for (const row of (data ?? []) as Array<{ action_type: CreditAction; credits: number; category: string; description: string }>) {
    const bucket = buckets[row.category] ?? buckets.medium;
    const registryDisplay = getFeatureDisplayGroup(row.action_type);
    bucket.actions.push({
      action: row.action_type,
      label: row.description || registryDisplay.label || row.action_type.replace(/_/g, ' '),
      credits: row.credits,
      ...(row.action_type === 'voice_per_minute' ? { unit: '/min' } : {}),
    });
  }

  return buckets;
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
    allowed: result.eligible,
    status: result.eligible ? 'eligible' : (reviewableResults.has(result.result) ? 'pending_review' : 'blocked'),
    reason: result.result,
  };
}
