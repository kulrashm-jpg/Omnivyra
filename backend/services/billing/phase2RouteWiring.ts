/**
 * Phase 2 Task 4 — Reusable route enforcement wiring.
 *
 * Wraps a route's existing AI work so it runs under the canary gate:
 *   OFF (default)  → run() verbatim — ZERO behavior change.
 *   SHADOW         → run() verbatim + precheck telemetry (would-block sizing).
 *   ENFORCE        → executeWithCredits(HOLD→EXECUTE→CONFIRM/RELEASE) with a
 *                    deterministic action_key + idempotency + ledger lineage.
 *
 * STRICT: enforcement is DARK by default (resolveEnforcementMode → 'off' until
 * the org canary flag / env says otherwise). No platform-wide activation. No
 * RPC/ledger/queue/settlement change — delegates to the existing engine.
 * Idempotency key is deterministic (makeIdempotencyKey) so retries/replays
 * never double-charge; resumed HOLD + partial-confirm continuity is whatever
 * executeWithCredits already guarantees (unchanged).
 *
 * Rollback: kill-switch env (instant, global) → disable org flag → revert the
 * one-line route call. OFF mode is a pure passthrough so reverting is safe at
 * any time.
 */

import { runWithPhase2Enforcement, type BillingSurface } from './phase2EnforcementGate';
import { executeWithCredits, makeIdempotencyKey } from '../creditExecutionService';
import { hasEnoughCredits, type CreditAction } from '../creditDeductionService';
import { incrCounter } from './billingMetrics';
import { logger } from '../logger';

export interface WirePhase2RouteArgs<T> {
  surface: BillingSurface;
  organizationId: string;
  /** Authenticated actor. Omit for admin/system contexts → system sentinel
   *  (userId = orgId, validateMembership:false), matching the existing
   *  best-effort/system convention in creditExecutionService. */
  userId?: string | null;
  action: CreditAction;
  referenceType: string;
  /** Deterministic, stable per logical request so retries reuse the HOLD. */
  referenceId: string;
  /** The route's existing AI work, unchanged. */
  run: () => Promise<T>;
}

/**
 * Run `run()` under the Phase-2 canary gate. Never changes behavior in OFF/
 * SHADOW. In ENFORCE, blocks on insufficient credits (throws
 * PaymentRequiredError from the gate → route maps to 402).
 */
export async function wirePhase2Route<T>(args: WirePhase2RouteArgs<T>): Promise<T> {
  const hasActor = !!args.userId && args.userId !== args.organizationId;
  const effectiveUserId = hasActor ? (args.userId as string) : args.organizationId;

  return runWithPhase2Enforcement<T>({
    organizationId: args.organizationId,
    surface: args.surface,
    execute: args.run,
    precheck: async () => {
      try {
        const r = await hasEnoughCredits(args.organizationId, args.action);
        return { sufficient: r.sufficient };
      } catch {
        return { sufficient: true }; // shadow precheck is best-effort
      }
    },
    enforce: async () => {
      const idempotencyKey = makeIdempotencyKey(
        effectiveUserId,
        args.action,
        args.referenceId,
      );
      const result = await executeWithCredits<T>({
        userId: effectiveUserId,
        orgId: args.organizationId,
        action: args.action,
        referenceType: args.referenceType,
        referenceId: args.referenceId,
        idempotencyKey,
        validateMembership: hasActor, // system/admin context skips membership
        executor: args.run,
      });

      switch (result.status) {
        case 'executed':
          incrCounter('billing_operations_confirmed');
          return { ok: true, result: result.result };
        case 'already_confirmed':
        case 'already_released':
          // Same idempotency key already settled (client retry). Do NOT
          // re-charge; re-run the work so the caller still gets a response.
          incrCounter('duplicate_prevention_hits_total');
          logger.info('phase2_route_idempotent_replay', {
            surface: args.surface,
            org: args.organizationId,
            status: result.status,
          });
          return { ok: true, result: await args.run() };
        case 'insufficient_credits':
          return { ok: false, reason: 'insufficient_credits' };
        case 'no_credit_account':
          return { ok: false, reason: 'no_credit_account' };
        default:
          // not_a_member / org_control_blocked / any future status.
          return { ok: false, reason: (result as { status: string }).status };
      }
    },
  });
}
