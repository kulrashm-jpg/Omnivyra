/**
 * Credit Guard Service
 *
 * Translates raw credit execution outcomes into structured, user-facing errors
 * and triggers threshold alerts when balances are low.
 *
 * Responsibilities:
 *   1. Format `insufficient_credits` / `no_credit_account` into a consistent
 *      error envelope that API routes return to the client.
 *   2. Fire `checkCreditAlerts` (non-blocking) whenever insufficiency is
 *      detected — the alert service deduplicates within 24 h.
 *   3. Expose `assertCreditsAvailable` for routes that want to pre-flight
 *      the balance BEFORE kicking off expensive work.
 *
 * Error envelope shape:
 *   {
 *     code:             "INSUFFICIENT_CREDITS" | "NO_CREDIT_ACCOUNT",
 *     message:          string,
 *     suggested_action: ("buy_credits" | "upgrade_plan" | "setup_billing")[],
 *     available?:       number,
 *     required?:        number,
 *   }
 */

import { checkCreditAlerts } from './creditAlertService';
import { hasEnoughCredits, type CreditAction } from './creditDeductionService';
import type { ExecuteResult } from './creditExecutionService';

// ── Error envelope ─────────────────────────────────────────────────────────────

export type SuggestedAction = 'buy_credits' | 'upgrade_plan' | 'setup_billing';

export interface CreditExhaustionError {
  code:             'INSUFFICIENT_CREDITS' | 'NO_CREDIT_ACCOUNT';
  message:          string;
  suggested_action: SuggestedAction[];
  available?:       number;
  required?:        number;
}

// ── Suggested action logic ─────────────────────────────────────────────────────

/**
 * Decide which recovery actions to suggest based on the remaining balance.
 *
 *   balance = 0      → buy credits (empty wallet)
 *   0 < balance < N  → buy credits + upgrade plan (have some, not enough)
 *   no account       → setup billing (never configured)
 */
function suggestActions(available?: number): SuggestedAction[] {
  if (available === undefined) return ['setup_billing'];
  if (available === 0)         return ['buy_credits'];
  return ['buy_credits', 'upgrade_plan'];
}

// ── Alert trigger ──────────────────────────────────────────────────────────────

/**
 * Fire credit alerts for the org without blocking the current request.
 * Errors are swallowed — alert failure must never affect the API response.
 */
function fireAlerts(orgId: string): void {
  checkCreditAlerts(orgId).catch(err =>
    console.warn('[creditGuard] alert check failed (non-fatal):', err?.message),
  );
}

// ── Primary formatter ──────────────────────────────────────────────────────────

/**
 * Convert an `ExecuteResult` that indicates a credit problem into a structured
 * `CreditExhaustionError`, and fire threshold alerts in the background.
 *
 * Returns `null` if the result does NOT indicate a credit problem (i.e. the
 * caller should only invoke this when the status is known to be an error).
 *
 * @example
 * ```ts
 * const result = await executeWithCredits({ ... });
 * const creditError = formatCreditError(orgId, result);
 * if (creditError) return res.status(402).json({ error: creditError });
 * ```
 */
export function formatCreditError<T>(
  orgId:  string,
  result: ExecuteResult<T>,
): CreditExhaustionError | null {
  if (result.status === 'insufficient_credits') {
    fireAlerts(orgId);
    return {
      code:             'INSUFFICIENT_CREDITS',
      message:          result.available === 0
        ? 'You have run out of credits. Purchase more to continue.'
        : `You need ${result.required} credits but only have ${result.available} available.`,
      suggested_action: suggestActions(result.available),
      available:        result.available,
      required:         result.required,
    };
  }

  if (result.status === 'no_credit_account') {
    return {
      code:             'NO_CREDIT_ACCOUNT',
      message:          'No credit account found for your organization. Please contact support.',
      suggested_action: ['setup_billing'],
    };
  }

  return null;
}

// ── Pre-flight check ───────────────────────────────────────────────────────────

/**
 * Check whether an org can afford an action BEFORE beginning expensive work.
 * Returns a `CreditExhaustionError` if they cannot, or `null` if they can.
 *
 * Use this in API routes where the executor itself is expensive or has
 * side-effects that should not start if credits are unavailable.
 *
 * @example
 * ```ts
 * const creditErr = await assertCreditsAvailable(orgId, 'campaign_generation');
 * if (creditErr) return res.status(402).json({ error: creditErr });
 * // ... proceed with expensive work
 * ```
 */
export async function assertCreditsAvailable(
  orgId:       string,
  action:      CreditAction,
  multiplier?: number,
): Promise<CreditExhaustionError | null> {
  const { sufficient, balance, required } = await hasEnoughCredits(orgId, action, multiplier);

  if (!sufficient) {
    fireAlerts(orgId);
    return {
      code:             'INSUFFICIENT_CREDITS',
      message:          (balance ?? 0) === 0
        ? 'You have run out of credits. Purchase more to continue.'
        : `You need ${required} credits but only have ${balance ?? 0} available.`,
      suggested_action: suggestActions(balance ?? 0),
      available:        balance ?? 0,
      required,
    };
  }

  return null;
}

// ── HTTP response helper ───────────────────────────────────────────────────────

/**
 * Write a 402 Payment Required response for a credit exhaustion error.
 * Use directly in Next.js API route handlers.
 *
 * HTTP 402 is the semantically correct status for "payment/credits required".
 *
 * @example
 * ```ts
 * const result = await executeWithCredits({ ... });
 * if (respondIfCreditError(res, orgId, result)) return;
 * // result.status === 'executed' here
 * ```
 */
export function respondIfCreditError<T>(
  res:    import('next').NextApiResponse,
  orgId:  string,
  result: ExecuteResult<T>,
): boolean {
  const err = formatCreditError(orgId, result);
  if (!err) return false;
  res.status(402).json({ error: err });
  return true;
}
