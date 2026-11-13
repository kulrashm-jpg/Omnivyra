/**
 * The STANDARD billed HTTP shape for every refusal a wirePhase2Route-billed route can raise (e9 2026-11-13: the UI's
 * shared helper shows ONE consistent "top up" / "already done" / "try again" message):
 *   402 { error, code: 'INSUFFICIENT_CREDITS', required?, balance? }   not enough credits
 *   402 { error, code: 'NO_CREDIT_ACCOUNT' }                           the organization has no credit account
 *   409 { error, code: 'ALREADY_PROCESSED' }   this exact request (same Idempotency-Key) was already charged and
 *                                               answered - it is NOT re-run for free
 *   409 { error, code: 'ALREADY_RELEASED' }    every retry slot of this request failed uncharged - start again
 *   503 { error, code: 'PRICING_UNAVAILABLE' } the action has no active price - a configuration gap, never "top up"
 * Returns null for any other error - the route's own handling applies.
 */
import { PaymentRequiredError } from './phase2EnforcementGate';
import {
  BilledRouteAlreadyProcessedError,
  BilledRouteAlreadyReleasedError,
  BilledRoutePaymentRequiredError,
  BilledRoutePricingUnavailableError,
} from './phase2RouteWiring';

export type BilledRouteHttpBody = { error: string; code: string; required?: number; balance?: number };

export function billedRouteHttpError(err: unknown): { status: number; body: BilledRouteHttpBody } | null {
  if (err instanceof BilledRoutePaymentRequiredError) {
    const body: BilledRouteHttpBody = { error: err.message, code: err.billedCode };
    if (typeof err.required === 'number') body.required = err.required;
    if (typeof err.balance === 'number') body.balance = err.balance;
    return { status: 402, body };
  }
  if (err instanceof PaymentRequiredError) {
    // the gate / admission boundary: insufficient credits without a measured balance
    return { status: 402, body: { error: err.message, code: 'INSUFFICIENT_CREDITS' } };
  }
  if (err instanceof BilledRouteAlreadyProcessedError) {
    return { status: 409, body: { error: err.message, code: 'ALREADY_PROCESSED' } };
  }
  if (err instanceof BilledRouteAlreadyReleasedError) {
    return { status: 409, body: { error: err.message, code: 'ALREADY_RELEASED' } };
  }
  if (err instanceof BilledRoutePricingUnavailableError) {
    return { status: 503, body: { error: err.message, code: 'PRICING_UNAVAILABLE' } };
  }
  return null;
}
