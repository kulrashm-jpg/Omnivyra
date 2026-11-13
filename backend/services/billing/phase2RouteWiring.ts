/**
 * Phase 2 Task 4 — Reusable route enforcement wiring.
 *
 * Wraps a route's existing AI work so it runs under the canary gate:
 *   OFF (default)  → run() verbatim — ZERO behavior change.
 *   SHADOW         → run() verbatim + precheck telemetry (would-block sizing).
 *   ENFORCE        → executeWithEntryConsumption, TOKEN-METERED (HOLD the prescribed
 *                    upper bound → EXECUTE → settle the ACTUAL collected usage →
 *                    release the rest), keyed per request (inputs + the client's
 *                    Idempotency-Key, else the request id). A charged replay is 409
 *                    ALREADY_PROCESSED - never a free re-run (e1 2026-11-13).
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

import { createHash } from 'crypto';
import { runWithPhase2Enforcement, PaymentRequiredError, type BillingSurface } from './phase2EnforcementGate';
import {
  executeWithEntryConsumption,
  makeIdempotencyKey,
  type ExecuteWithEntryConsumptionResult,
} from '../creditExecutionService';
import { getRequestContext } from '../requestContext';
import { hasEnoughCredits, type CreditAction } from '../creditDeductionService';
import { incrCounter } from './billingMetrics';
import { emitAnomaly } from './billingAuditEmitter';
import { emitCreditEconomyShadowEvaluation } from './creditEconomyShadow';
import { logger } from '../logger';

/** A refusal for money reasons, carrying the STANDARD billed shape's detail (402). Still a PaymentRequiredError,
 *  so any older catch keeps answering 402. */
export class BilledRoutePaymentRequiredError extends PaymentRequiredError {
  constructor(
    surface: BillingSurface,
    public readonly billedCode: 'INSUFFICIENT_CREDITS' | 'NO_CREDIT_ACCOUNT',
    public readonly required?: number,
    public readonly balance?: number,
  ) {
    super(surface, billedCode === 'NO_CREDIT_ACCOUNT'
      ? 'No credit account for this organization.'
      : 'Insufficient credits for this action.');
    this.name = 'BilledRoutePaymentRequiredError';
  }
}

/** The action has no active price (action_pricing_config / model pricing): a CONFIGURATION gap, not the customer's
 *  balance - 503, never charged, never "top up". */
export class BilledRoutePricingUnavailableError extends Error {
  readonly code = 'PRICING_UNAVAILABLE';
  readonly httpStatus = 503;
  constructor(public readonly surface: BillingSurface, public readonly detail: string) {
    super('Pricing for this action is temporarily unavailable. Please try again later.');
    this.name = 'BilledRoutePricingUnavailableError';
  }
}

/** Matched on the machine CODE only (05: the code is the contract, the message is prose - a reworded message must
 *  never turn a pricing outage into a 402 'payment' answer). pricingService's PricingMissingError and
 *  ActionPricingMissingError both carry it. */
const isPricingMissing = (err: unknown): boolean =>
  (err as { code?: unknown } | null)?.code === 'PRICING_UNAVAILABLE';

/** Upper bound on reclaimed (failed, uncharged) attempts for one request identity. */
export const MAX_ROUTE_RECLAIM_ATTEMPTS = 20;

/** A billed route request that was ALREADY charged and answered (same Idempotency-Key): 409, never re-run free. */
export class BilledRouteAlreadyProcessedError extends Error {
  readonly code = 'ALREADY_PROCESSED';
  readonly httpStatus = 409;
  constructor(public readonly surface: BillingSurface) {
    super('This request was already processed and charged. Refresh to see the result.');
    this.name = 'BilledRouteAlreadyProcessedError';
  }
}

/**
 * Every reclaim slot for this request identity is a failed, released attempt. The cause is OURS (the route failed
 * on every attempt), so this is a 5xx with its own code - never the benign 409 a client may retry into (05 d,
 * 2026-11-13). retryable=false: the SAME Idempotency-Key cannot succeed; nothing was charged.
 */
export class BilledRouteReclaimExhaustedError extends Error {
  readonly code = 'RECLAIM_CAP_EXHAUSTED';
  readonly httpStatus = 500;
  readonly retryable = false;
  constructor(public readonly surface: BillingSurface) {
    super('This request failed repeatedly and was not charged. Please start it again.');
    this.name = 'BilledRouteReclaimExhaustedError';
  }
}

/**
 * The HOLD (prescribed upper bound) for a billed route's action - the owner rule: hold the maximum, settle the
 * actual. maxTokens cover ONE billed unit: multi-call units scale by their calls (C83: a campaign plan ~2 calls,
 * a virality assessment 5, the longest blog template 7). Settlement is ALWAYS the actual collected usage.
 */
const ROUTE_UNIT_CALLS: Partial<Record<string, number>> = {
  insight_generation: 5,
  blog_generation: 7,
  campaign_preplanning: 3,
  recommendations_generate: 3,
  recommendations_opportunities: 3,
};
/**
 * Per-CALL token bounds where the route's AI call is known to be small (default 8000 in / 2000 out). The output bound
 * is the call's own max_tokens, so the hold covers the worst case without over-holding a small wallet:
 *   reply_generation - engagementAiAssistantService max_tokens 700; observed avg 760 in / 100 out (C82, 6 calls).
 */
const ROUTE_CALL_TOKENS: Partial<Record<string, { input: number; output: number }>> = {
  reply_generation: { input: 3000, output: 700 },
};
/** A per-request call count (e.g. a bulk batch) is capped so a hostile input cannot inflate a hold. */
export const MAX_ROUTE_UNIT_CALLS = 50;
export function routeLlmPricingFor(action: CreditAction, unitCalls?: number) {
  const requested = Number.isInteger(unitCalls) && (unitCalls as number) >= 1 ? Math.min(unitCalls as number, MAX_ROUTE_UNIT_CALLS) : undefined;
  const calls = requested ?? ROUTE_UNIT_CALLS[String(action)] ?? 1;
  const perCall = ROUTE_CALL_TOKENS[String(action)] ?? { input: 8000, output: 2000 };
  return {
    provider: 'openai',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    actionKey: String(action),
    maxInputTokens: perCall.input * calls,
    maxOutputTokens: perCall.output * calls,
    // a per-request unit size also scales the action's settlement ceiling (pricingService ceilingScale), so a
    // 20-reply batch is not capped at one reply's price; the action's usual unit size needs no scale
    ...(requested ? { ceilingScale: requested } : {}),
  };
}

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
  /** AI calls in THIS request's billed unit when it varies per request (a bulk batch): scales the HOLD only;
   *  settlement is always the actual usage. Integer 1..MAX_ROUTE_UNIT_CALLS, else the action's default. */
  unitCalls?: number;
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
      // e1 2026-11-13 (owner pricing ruling; e9 BLOCKING-for-flip). Three changes to the enforce path:
      //  1. TOKEN-ACTUAL: every billed route settles on ACTUAL provider usage x the action's multiplier
      //     (executeWithEntryConsumption token-metered, collectViaCollector) - never a fixed price. The hold is the
      //     action's prescribed upper bound (routeLlmPricingFor), released down to the actual on completion.
      //  2. NEVER RE-RUN UNBILLED: a charged replay used to re-execute run() for free ("so the caller still gets a
      //     response"); with a referenceId hashed from the INPUTS, every identical request after the first was a
      //     free regeneration. A charged replay is now 409 ALREADY_PROCESSED; a released (failed, uncharged) attempt
      //     is reclaimed under the next attempt slot so a retry runs and is charged once.
      //  3. RETRY vs NEW REQUEST: the identity is the inputs PLUS the client's Idempotency-Key (minted once per user
      //     action by the UI helper; a true retry dedups). Without the header every request is a new charge
      //     (keyed by the per-request id) - logged + counted so a client path that misses the header is visible
      //     before the flip.
      const ctx = getRequestContext();
      const clientKey = typeof ctx.idempotencyKey === 'string' && ctx.idempotencyKey.trim() ? ctx.idempotencyKey.trim() : null;
      if (!clientKey) {
        incrCounter('phase2_route_without_idempotency_key_total');
        logger.warn('phase2_route_without_idempotency_key', { surface: args.surface, org: args.organizationId });
      }
      const requestIdentity = clientKey
        ? `k:${createHash('sha256').update(clientKey).digest('hex').slice(0, 24)}`
        : `r:${ctx.requestId ?? createHash('sha256').update(`${Date.now()}:${Math.random()}`).digest('hex').slice(0, 24)}`;
      const identity = `${args.referenceId}:${requestIdentity}`;

      for (let attempt = 0; attempt < MAX_ROUTE_RECLAIM_ATTEMPTS; attempt++) {
        const referenceId = attempt === 0 ? identity : `${identity}:r${attempt}`;
        let result: ExecuteWithEntryConsumptionResult<T>;
        try {
          result = await executeWithEntryConsumption<T>({
            userId: effectiveUserId,
            orgId: args.organizationId,
            action: args.action,
            referenceType: args.referenceType,
            referenceId,
            idempotencyKey: makeIdempotencyKey(effectiveUserId, args.action, referenceId),
            validateMembership: hasActor, // system/admin context skips membership
            llmPricing: routeLlmPricingFor(args.action, args.unitCalls),
            collectViaCollector: true,
            executor: args.run,
          });
        } catch (err) {
          if (isPricingMissing(err)) {
            logger.error('phase2_route_pricing_unavailable', {
              surface: args.surface, action: args.action, message: (err as Error)?.message,
            });
            throw new BilledRoutePricingUnavailableError(args.surface, String((err as Error)?.message ?? ''));
          }
          throw err;
        }
        switch (result.status) {
          case 'executed':
            incrCounter('billing_operations_confirmed');
            return { ok: true, result: result.result };
          case 'already_settled':
            // This exact request was already charged and answered: never re-run it for free.
            incrCounter('duplicate_prevention_hits_total');
            logger.info('phase2_route_already_processed', { surface: args.surface, org: args.organizationId });
            throw new BilledRouteAlreadyProcessedError(args.surface);
          case 'already_released':
            // That attempt failed and was NOT charged: reclaim the next slot so the retry runs (charged once).
            continue;
          case 'insufficient_credits': {
            incrCounter('billing_operations_insufficient');
            const r = result as { required?: number; available?: number };
            throw new BilledRoutePaymentRequiredError(args.surface, 'INSUFFICIENT_CREDITS', r.required, r.available);
          }
          case 'no_credit_account':
            incrCounter('billing_operations_insufficient');
            throw new BilledRoutePaymentRequiredError(args.surface, 'NO_CREDIT_ACCOUNT');
          default:
            // not_a_member / org_control_blocked / any future status.
            return { ok: false, reason: (result as { status: string }).status };
        }
      }
      // Twenty failed attempts for ONE request identity is almost certainly a bug, not a user retrying: distinct and
      // LOUD (05), never indistinguishable from an ordinary billing refusal.
      incrCounter('phase2_route_reclaim_cap_exhausted_total');
      logger.error('phase2_route_reclaim_cap_exhausted', { surface: args.surface, org: args.organizationId, action: args.action });
      emitAnomaly({
        organizationId: args.organizationId,
        kind: 'reclaim_cap_exhausted',
        severity: 'critical',
        message: 'billed_route_reclaim_cap_exhausted',
        metadata: { surface: String(args.surface), action: String(args.action), attempts: MAX_ROUTE_RECLAIM_ATTEMPTS },
      });
      throw new BilledRouteReclaimExhaustedError(args.surface);
    },
  });
}
