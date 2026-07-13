/**
 * refreshPolicyEngine.ts — THE canonical Refresh Policy Engine (CKRE-002 §1).
 *
 * PURE. Deterministic. Retry-safe. Fully testable. Given the CKRE-001 change
 * decision plus refresh context (history, tier, cooldown, budget, overrides),
 * it decides IF / WHEN / WHAT should be refreshed. It performs NO I/O, invokes
 * NO AI, and reads NO env — the config is injected (refreshPolicyConfig).
 *
 * This engine is the SINGLE authority that gates AI enrichment (§3): the
 * refinement path consults it and only runs the LLM chain when the action
 * requires it.
 */

import type { ChangeDecision } from './changeDetectionService';
import type { FingerprintTypeId } from './fingerprintRegistry';
import { cooldownForTier, type CompanyTier, type PlatformState, type RefreshPolicyConfig } from './refreshPolicyConfig';

export type RefreshAction =
  | 'EXECUTE_REFRESH'        // run the full refresh (gating disabled / manual)
  | 'SKIP_REFRESH'           // content unchanged — no AI, no work
  | 'REFRESH_METADATA_ONLY'  // cosmetic — deterministic metadata only, no AI
  | 'REFRESH_BUSINESS_ONLY'  // business fields changed — run AI
  | 'REFRESH_FULL'           // major / first-time — run full AI
  | 'DEFER'                  // cooldown / degraded / no budget — retry later
  | 'UNKNOWN';               // cannot decide

export interface RefreshPolicyInput {
  changeDecision: ChangeDecision | null;
  /** True when a prior knowledge version exists (a baseline to compare against). */
  hasPriorKnowledgeVersion: boolean;
  /** ISO of the last successful refresh, or null. */
  lastRefreshAt: string | null;
  refreshHistoryCount: number;
  /** Explicit user-initiated refresh (bypasses the change gate). */
  manualRefresh: boolean;
  /** Explicit admin/policy override — wins over everything when set. */
  adminOverride?: RefreshAction | null;
  companyTier: CompanyTier;
  platformState: PlatformState;
  /** A refresh is already in flight for this company. */
  pendingRefresh: boolean;
  /** Remaining token budget; null = unmetered. AI actions defer when <= 0. */
  tokenBudgetRemaining?: number | null;
  config: RefreshPolicyConfig;
  /** Injectable clock (ms) for determinism. */
  now: number;
}

export interface RefreshPolicyDecision {
  action: RefreshAction;
  /** True when the action requires the AI enrichment chain. */
  requiresAi: boolean;
  /** The affected knowledge (from the change decision graph closure), for incremental refresh. */
  affectedFingerprints: FingerprintTypeId[];
  reason: string;
}

const AI_ACTIONS: ReadonlySet<RefreshAction> = new Set(['EXECUTE_REFRESH', 'REFRESH_BUSINESS_ONLY', 'REFRESH_FULL']);

function decision(action: RefreshAction, reason: string, affected: FingerprintTypeId[]): RefreshPolicyDecision {
  return { action, requiresAi: AI_ACTIONS.has(action), affectedFingerprints: affected, reason };
}

/**
 * Decide the refresh action. Pure — identical inputs always yield the identical
 * decision. Evaluation order is fixed (overrides → platform → pending → gating
 * off → manual → cooldown → change verdict → budget).
 */
export function decideRefresh(input: RefreshPolicyInput): RefreshPolicyDecision {
  const affected = input.changeDecision?.affectedFingerprints ?? [];

  // 1. Explicit admin/policy override wins.
  if (input.adminOverride) {
    return decision(input.adminOverride, 'admin_override', affected);
  }

  // 2. A refresh already running → defer (idempotency; avoid double work).
  if (input.pendingRefresh) {
    return decision('DEFER', 'refresh_already_pending', affected);
  }

  // 3. Degraded platform → defer non-manual refreshes.
  if (input.platformState === 'degraded' && !input.manualRefresh) {
    return decision('DEFER', 'platform_degraded', affected);
  }

  // 4. Gating disabled (kill-switch) → behave as pre-CKRE-002 (always run).
  if (!input.config.aiGatingEnabled) {
    return decision('EXECUTE_REFRESH', 'gating_disabled', affected);
  }

  // 5. Manual refresh bypasses the change gate → full refresh.
  if (input.manualRefresh) {
    return decision('REFRESH_FULL', 'manual_refresh', affected);
  }

  // 6. Cooldown — too soon since the last refresh for this tier → defer.
  if (input.lastRefreshAt) {
    const last = Date.parse(input.lastRefreshAt);
    if (Number.isFinite(last)) {
      const cooldown = cooldownForTier(input.config, input.companyTier);
      if (input.now - last < cooldown) {
        return decision('DEFER', 'within_cooldown', affected);
      }
    }
  }

  // 7. Change verdict → action.
  const verdict = input.changeDecision?.verdict ?? null;
  let candidate: RefreshAction;
  let reason: string;
  switch (verdict) {
    case 'UNCHANGED':
      if (input.hasPriorKnowledgeVersion) { candidate = 'SKIP_REFRESH'; reason = 'unchanged_with_baseline'; }
      else { candidate = 'REFRESH_FULL'; reason = 'unchanged_but_no_baseline'; }
      break;
    case 'COSMETIC_CHANGE': candidate = 'REFRESH_METADATA_ONLY'; reason = 'cosmetic_change'; break;
    case 'BUSINESS_CHANGE': candidate = 'REFRESH_BUSINESS_ONLY'; reason = 'business_change'; break;
    case 'MAJOR_CHANGE':    candidate = 'REFRESH_FULL'; reason = 'major_change'; break;
    case 'UNKNOWN':
    case null:
    default:
      // Can't prove unchanged → safe default is to refresh fully (first-time
      // enrichment or missing fingerprint).
      candidate = 'REFRESH_FULL'; reason = input.hasPriorKnowledgeVersion ? 'unknown_change_safe_refresh' : 'first_enrichment';
      break;
  }

  // 8. Token budget — AI actions defer when the budget is exhausted.
  if (AI_ACTIONS.has(candidate) && input.tokenBudgetRemaining !== null && input.tokenBudgetRemaining !== undefined && input.tokenBudgetRemaining <= 0) {
    return decision('DEFER', 'token_budget_exhausted', affected);
  }

  return decision(candidate, reason, affected);
}

/** True when an action requires the AI enrichment chain (§3). */
export function actionRequiresAi(action: RefreshAction): boolean {
  return AI_ACTIONS.has(action);
}
