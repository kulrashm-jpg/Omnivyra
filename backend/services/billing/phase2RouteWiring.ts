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

import { runWithPhase2Enforcement, PaymentRequiredError, type BillingSurface } from './phase2EnforcementGate';
import {
  executeWithCredits,
  executeWithEntryConsumption,
  makeIdempotencyKey,
} from '../creditExecutionService';
import { getCreditEconomyExecutionMode } from './creditEconomyActivation';
import { hasEnoughCredits, type CreditAction } from '../creditDeductionService';
import { incrCounter } from './billingMetrics';
import { emitCreditEconomyShadowEvaluation } from './creditEconomyShadow';
import { logger } from '../logger';

/**
 * REPLAY POLICY (2026-11-12, e9 ruling; MONEY, enforce go-live gate).
 * The referenceIds callers pass are CONTENT hashes (same inputs -> same id), and
 * the settled replay used to re-run the work FREE - forever. Two holes:
 *  (a) after a FAILED attempt (hold released) the successful retry with the same
 *      inputs found `already_released` and ran free;
 *  (b) an identical refresh any time later found `already_confirmed` and ran free.
 * Now: the key carries a REPLAY WINDOW bucket (10 min) and an ATTEMPT counter.
 *  - already_released -> the next attempt key (a retry after a failure is
 *    charged exactly once);
 *  - already_confirmed / already_settled -> a free replay, but only inside the
 *    window; a new window is a new key, so a later identical request charges.
 * referenceId itself (ledger lineage) is unchanged; only the idempotency key
 * moves. A retry that straddles a window boundary is charged again (accepted).
 */
export const REPLAY_WINDOW_MS = 10 * 60 * 1000;
/** Bound on failed attempts inside one window before refusing (never loops). */
export const MAX_ATTEMPTS_PER_WINDOW = 20;

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

  // Phase 8E — shadow adoption. Fire-and-forget, dark by default
  // (PHASE2_CREDIT_ECONOMY_SHADOW). Evaluates the credit economy for telemetry
  // BEFORE execution; never awaited, never blocks/throws, never mutates.
  void emitCreditEconomyShadowEvaluation({
    organizationId: args.organizationId,
    activity: args.action,
    surface: String(args.surface),
    dedupeKey: args.referenceId,
  });

  // Phase 11D — admission boundary BEFORE execution, for ALL gate modes. Dark by
  // default (passthrough; no wallet read). On a future enforce-block it raises the
  // SAME PaymentRequiredError the gate uses, so the wired routes' existing 402
  // mapping applies unchanged — enforce becomes a config decision, not a code one.
  try {
    const { evaluateActivityAdmission } = await import('./admissionControl');
    await evaluateActivityAdmission({
      organizationId: args.organizationId,
      activity:       String(args.action),
      surface:        String(args.surface),
      referenceId:    args.referenceId,
    });
  } catch (admErr: any) {
    if (admErr?.name === 'AdmissionBlockedError') {
      throw new PaymentRequiredError(args.surface, 'admission: insufficient credits for this action');
    }
    // Non-enforcement errors must never break the route.
  }

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
      const ecMode = await getCreditEconomyExecutionMode({ organizationId: args.organizationId, surface: args.surface });
      const windowBucket = Math.floor(Date.now() / REPLAY_WINDOW_MS);
      const runAttempt = (attempt: number) => {
        const idempotencyKey = makeIdempotencyKey(
          effectiveUserId,
          args.action,
          args.referenceId,
          `w${windowBucket}:a${attempt}`,
        );
        const baseArgs = {
          userId: effectiveUserId,
          orgId: args.organizationId,
          action: args.action,
          referenceType: args.referenceType,
          referenceId: args.referenceId,
          idempotencyKey,
          validateMembership: hasActor, // system/admin context skips membership
        };
        return ecMode === 'enforce'
          ? executeWithEntryConsumption<T>({ ...baseArgs, executor: args.run })
          : executeWithCredits<T>({ ...baseArgs, executor: args.run });
      };
      // (a) a released attempt is spent: move to the next attempt key, so the
      // retry is charged (once) instead of running free.
      let result = await runAttempt(0);
      let attempt = 0;
      while (result.status === 'already_released') {
        attempt += 1;
        if (attempt >= MAX_ATTEMPTS_PER_WINDOW) {
          logger.error('phase2_route_attempt_limit', { surface: args.surface, org: args.organizationId, attempts: attempt });
          return { ok: false, reason: 'attempt_limit' };
        }
        result = await runAttempt(attempt);
      }

      switch (result.status) {
        case 'executed':
          incrCounter('billing_operations_confirmed');
          return { ok: true, result: result.result };
        case 'already_confirmed':   // executeWithCredits replay
        case 'already_settled':     // entry-consumption replay
          // (b) Same key already settled INSIDE the replay window (client
          // retry / double submit): do NOT re-charge; re-run the work so the
          // caller still gets a response. Outside the window the key differs
          // and the request is charged. (already_released never reaches here:
          // it advances the attempt above.)
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
