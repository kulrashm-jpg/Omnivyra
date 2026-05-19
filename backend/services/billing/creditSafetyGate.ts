/**
 * Task 5H — Pre-HOLD executable-balance safety gate (ADDITIVE, default OFF).
 *
 * Asserts `available_executable_balance >= projected_cost * SAFETY_FACTOR`
 * BEFORE the HOLD is attempted, so an org that cannot safely fund a run is
 * blocked deterministically before any provider spend.
 *
 * INTEGRITY NOTES (reported, not hidden):
 *  - This does NOT introduce a parallel balance system or a new projected-cost
 *    estimator. It is a pure arithmetic assertion over the values the existing
 *    `executeWithCredits` flow ALREADY computed: `resolveDeduction(...).available`
 *    (the canonical wallet read) and `credits` (the engine's already-
 *    deterministic projected cost — fixed cost, amountOverride, or the token-
 *    priced dynamic upper bound).
 *  - For SINGLE-HOLD activities the existing `callCreditReservation('hold')`
 *    already requires the FULL `credits` to be reservable (a ≥100% guarantee,
 *    strictly STRONGER than this 80% gate). This gate's real value is (a) an
 *    earlier, explicit pre-flight signal, and (b) the lever for multi-stage /
 *    long-running envelopes where the total projected cost exceeds a single
 *    HOLD (the caller passes a larger `projectedCredits`).
 *  - Default OFF ⇒ byte-identical behavior / OFF parity preserved. Honors the
 *    shared kill-switch. Returns the EXISTING `insufficient_credits` result
 *    shape at the call site (no new error type, no duplicate gating, no new
 *    propagation path — Task-5A.x already maps insufficient → 402).
 *
 * Modes via env (read at call time):
 *   PHASE2_SAFETY_GATE = off (default) | shadow | enforce
 *   PHASE2_SAFETY_FACTOR = 0.8 (default; clamped to [0,1])
 *   PHASE2_BILLING_KILL_SWITCH = true → forces off (global, no deploy)
 */

import { incrCounter } from './billingMetrics';
import { logger } from '../logger';
import type { ResolvedBillingPolicy } from './billingPolicyResolver';

function envLower(name: string): string {
  return String(process.env[name] ?? '').trim().toLowerCase();
}
function envTrue(name: string): boolean {
  const v = envLower(name);
  return v === 'true' || v === '1' || v === 'on';
}

function safetyFactor(): number {
  const raw = Number(process.env.PHASE2_SAFETY_FACTOR);
  if (!Number.isFinite(raw)) return 0.8;
  return Math.min(1, Math.max(0, raw));
}

export type SafetyGateDecision = 'pass' | 'block';

/**
 * Pure + deterministic: same inputs → same decision. No I/O, no balance read
 * (caller supplies the already-resolved figures), so it is replay-safe and
 * runs identically under retries. It sits BEFORE the HOLD, so the existing
 * resumed-HOLD path (which skips the fresh-HOLD branch) is never double-gated.
 */
export function evaluateCreditSafetyGate(args: {
  orgId: string;
  action: string;
  availableTotal: number;
  projectedCredits: number;
  /**
   * Optional DB-resolved governance policy (Task: billing-policy layer).
   * Precedence per field: policy value → env → compile default. When the
   * field is absent (no active DB row / pre-migration) the EXACT prior env/
   * default path runs ⇒ byte-identical behavior. Resolved ONCE at the
   * fresh-HOLD boundary by the caller; this function stays pure & sync.
   */
  policy?: ResolvedBillingPolicy;
}): SafetyGateDecision {
  const killSwitch = args.policy?.kill_switch ?? envTrue('PHASE2_BILLING_KILL_SWITCH');
  if (killSwitch) return 'pass';

  // '' | 'off' | 'shadow' | 'enforce'
  const mode = args.policy?.safety_gate_mode ?? envLower('PHASE2_SAFETY_GATE');
  if (mode !== 'shadow' && mode !== 'enforce') return 'pass'; // default OFF

  const factor = args.policy?.safety_factor ?? safetyFactor();
  const required = Math.max(0, args.projectedCredits) * Math.min(1, Math.max(0, factor));
  if (args.availableTotal >= required) return 'pass';

  if (mode === 'shadow') {
    incrCounter('phase2_shadow_would_block_total');
    logger.warn('credit_safety_gate_would_block', {
      orgId: args.orgId,
      action: args.action,
      availableTotal: args.availableTotal,
      projectedCredits: args.projectedCredits,
      required,
    });
    return 'pass'; // SHADOW never blocks
  }

  // mode === 'enforce'
  incrCounter('credit_safety_gate_blocked_total');
  logger.warn('credit_safety_gate_blocked', {
    orgId: args.orgId,
    action: args.action,
    availableTotal: args.availableTotal,
    projectedCredits: args.projectedCredits,
    required,
  });
  return 'block';
}
