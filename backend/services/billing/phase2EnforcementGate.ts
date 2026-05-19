/**
 * Phase 2 — Canary Enforcement Gate
 *
 * One place that decides, per (org, surface), whether Phase-2 billing
 * enforcement is: 'off' (no behavior change — default), 'shadow' (evaluate +
 * emit telemetry, DO NOT block), or 'enforce' (block on insufficient credits).
 *
 * Design constraints (Phase 2 strict rules):
 *   - Purely additive. Default is 'off' → ZERO behavior change until a route
 *     opts in AND the org is in the canary cohort.
 *   - No new flag system: reuses the existing org feature-flag canary
 *     (BILLING_FLAGS.RESERVATIONS_REQUIRED, default OFF, fail-closed-to-OFF).
 *   - Instant rollback with no deploy: PHASE2_BILLING_KILL_SWITCH forces 'off'
 *     globally.
 *   - Observability-first: PHASE2_BILLING_SHADOW forces 'shadow' everywhere so
 *     we can measure blast radius before enforcing.
 *   - Does NOT call executeWithCredits itself (no guessing that API here):
 *     callers inject `enforce` / `execute` / optional `precheck`. This keeps
 *     the gate self-contained, unit-testable, and rollback-trivial.
 *
 * Rollback paths (fastest → slowest):
 *   1. Set env PHASE2_BILLING_KILL_SWITCH=true   (global, instant, no deploy)
 *   2. Disable billing.reservations_required for the org/cohort (per-org)
 *   3. Revert the route opt-in commit                              (per-surface)
 */

import { isBillingFlagEnabled, BILLING_FLAGS } from './billingFeatureFlags';
import { incrCounter } from './billingMetrics';
import { logger } from '../logger';

export type EnforcementMode = 'off' | 'shadow' | 'enforce';

/** Billing surface identifier — used only for telemetry/grouping. */
export type BillingSurface = string;

function envTrue(name: string): boolean {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'on';
}

/**
 * Resolve the enforcement mode for an org/surface.
 *
 * Precedence:
 *   kill-switch  → 'off'      (global emergency rollback)
 *   force-enforce → 'enforce' (staging/CI/explicit opt-in env)
 *   global-shadow → 'shadow'  (observe everywhere)
 *   org canary flag ON → 'enforce'
 *   shadow opt-in env  → 'shadow'
 *   else → 'off'              (DEFAULT — inert)
 */
export async function resolveEnforcementMode(
  organizationId: string,
  surface: BillingSurface,
): Promise<{ mode: EnforcementMode; reason: string }> {
  if (envTrue('PHASE2_BILLING_KILL_SWITCH')) {
    incrCounter('phase2_gate_killswitch_total');
    incrCounter('phase2_gate_off_total');
    return { mode: 'off', reason: 'kill_switch' };
  }

  if (envTrue('PHASE2_BILLING_FORCE_ENFORCE')) {
    incrCounter('phase2_gate_enforce_total');
    return { mode: 'enforce', reason: 'env_force_enforce' };
  }

  if (envTrue('PHASE2_BILLING_SHADOW')) {
    incrCounter('phase2_gate_shadow_total');
    return { mode: 'shadow', reason: 'env_global_shadow' };
  }

  // Per-org canary. isBillingFlagEnabled is fail-closed-to-false (an eval
  // error returns enabled:false), so any failure degrades to non-enforcing.
  let canaryOn = false;
  try {
    const r = await isBillingFlagEnabled({
      organizationId,
      flag: BILLING_FLAGS.RESERVATIONS_REQUIRED,
    });
    canaryOn = r.enabled;
  } catch {
    canaryOn = false;
  }

  if (canaryOn) {
    incrCounter('phase2_gate_enforce_total');
    return { mode: 'enforce', reason: 'org_canary_flag' };
  }

  if (envTrue('PHASE2_BILLING_SHADOW_DEFAULT')) {
    incrCounter('phase2_gate_shadow_total');
    return { mode: 'shadow', reason: 'shadow_default_optin' };
  }

  incrCounter('phase2_gate_off_total');
  return { mode: 'off', reason: 'default_off' };
}

export class PaymentRequiredError extends Error {
  readonly code = 'INSUFFICIENT_CREDITS';
  readonly httpStatus = 402;
  constructor(
    public readonly surface: BillingSurface,
    public readonly detail?: string,
  ) {
    super(detail || 'Insufficient credits for this action.');
    this.name = 'PaymentRequiredError';
  }
}

export interface EnforceOutcome<T> {
  ok: boolean;
  result?: T;
  reason?: string;
}

/**
 * Run an AI/work operation under Phase-2 enforcement.
 *
 *  - 'off'     : runs `execute()` unchanged (current production behavior).
 *  - 'shadow'  : runs `execute()` (does NOT block). If `precheck` is supplied
 *                and reports insufficient, records phase2_shadow_would_block
 *                so we can size the blast radius before flipping to enforce.
 *  - 'enforce' : runs `enforce()` (the caller's executeWithCredits adapter).
 *                On ok=false, throws PaymentRequiredError (route → 402).
 *
 * `enforce` MUST itself perform HOLD→EXECUTE→CONFIRM/RELEASE via the existing
 * creditExecutionService — this gate never mutates the ledger directly and
 * never weakens idempotency/immutability guarantees.
 */
export async function runWithPhase2Enforcement<T>(args: {
  organizationId: string;
  surface: BillingSurface;
  execute: () => Promise<T>;
  enforce: () => Promise<EnforceOutcome<T>>;
  /** Optional cheap balance read (e.g. hasEnoughCredits) for shadow sizing. */
  precheck?: () => Promise<{ sufficient: boolean }>;
}): Promise<T> {
  const { mode, reason } = await resolveEnforcementMode(
    args.organizationId,
    args.surface,
  );

  if (mode === 'off') {
    return args.execute();
  }

  if (mode === 'shadow') {
    if (args.precheck) {
      try {
        const pc = await args.precheck();
        if (!pc.sufficient) {
          incrCounter('phase2_shadow_would_block_total');
          logger.warn('phase2_shadow_would_block', {
            surface: args.surface,
            org: args.organizationId,
            reason,
          });
        }
      } catch {
        /* precheck is best-effort in shadow; never block here */
      }
    }
    return args.execute();
  }

  // mode === 'enforce'
  const outcome = await args.enforce();
  if (!outcome.ok) {
    incrCounter('billing_operations_insufficient');
    throw new PaymentRequiredError(args.surface, outcome.reason);
  }
  return outcome.result as T;
}
