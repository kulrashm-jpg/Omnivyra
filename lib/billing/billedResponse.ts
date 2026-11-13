/**
 * THE canonical client mapping for every billed AI response (e9 ruling, 2026-11-13).
 *
 * Every billed route answers with one shape (55/e1 keep it consistent):
 *   402 { error, message?, required?, balance? | available? }  → not enough credits
 *   409 { code: 'ALREADY_PROCESSED' } → this exact request was already done AND charged
 *       (double-click / network retry). It's SUCCESS: refresh, don't show an error.
 *   409 { code: 'ALREADY_RELEASED' } → an earlier attempt failed and wasn't charged:
 *       offer "try again".
 * Keyed on HTTP status and `code` only, never on message text. Raw snake_case codes are
 * never shown to users.
 *
 * Used by Market Pulse run start, blog-card chat, content regenerate and activity
 * refine_variant. Future billed paths reuse it.
 */

/** Where users top up; the same page the credit-alert emails link to. */
export const TOP_UP_HREF = '/company/billing';

export type BilledOutcome =
  | { kind: 'ok' }
  | { kind: 'credits'; code: string; message: string; required?: number; available?: number }
  | { kind: 'already_processed'; message: string }
  | { kind: 'retry'; message: string }
  | { kind: 'error'; message: string };

const CREDIT_CODES = new Set(['insufficient_credits', 'no_credit_account', 'pricing_unavailable']);

const CREDIT_FALLBACK: Record<string, string> = {
  insufficient_credits: 'You don’t have enough credits for this.',
  no_credit_account: 'Your company doesn’t have a credit account yet.',
  pricing_unavailable: 'Pricing is temporarily unavailable, so this wasn’t started. Please try again shortly.',
};

const isCodeLike = (s: string) => /^[A-Za-z0-9_]+$/.test(s) && /_/.test(s);

/**
 * Classify a billed AI response. `fallback` is the human message for a generic failure.
 * 2xx → ok.
 */
export function classifyBilledResponse(status: number, body: unknown, fallback: string): BilledOutcome {
  if (status >= 200 && status < 300) return { kind: 'ok' };
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const code = typeof b.code === 'string' ? b.code : '';
  const errorField = typeof b.error === 'string' ? b.error : '';
  const message = typeof b.message === 'string' && b.message.trim() ? b.message.trim() : '';
  const detail = typeof b.detail === 'string' && b.detail.trim() ? b.detail.trim() : '';
  // Final shape (55, 2026-11-13): `error` is the readable sentence and `code` is the machine
  // key (INSUFFICIENT_CREDITS / NO_CREDIT_ACCOUNT / PRICING_UNAVAILABLE / ALREADY_*).
  // Older bodies put a snake_case reason in `error` and the sentence in `message`;
  // both are accepted.
  const human = message || (errorField && !isCodeLike(errorField) ? errorField : '') || (detail && !isCodeLike(detail) ? detail : '');

  if (status === 409 && code === 'ALREADY_PROCESSED') {
    return { kind: 'already_processed', message: 'This was already done. Refreshing to show the result.' };
  }
  if (status === 409 && code === 'ALREADY_RELEASED') {
    return { kind: 'retry', message: 'The earlier attempt didn’t finish and wasn’t charged. Please try again.' };
  }
  const creditKey = [code, errorField].map((c) => c.toLowerCase()).find((c) => CREDIT_CODES.has(c));
  if (status === 402 || creditKey) {
    const creditCode = creditKey ?? 'insufficient_credits';
    const available = typeof b.balance === 'number' ? b.balance : typeof b.available === 'number' ? b.available : undefined;
    return {
      kind: 'credits',
      code: creditCode,
      message: human || CREDIT_FALLBACK[creditCode] || CREDIT_FALLBACK.insufficient_credits,
      ...(typeof b.required === 'number' ? { required: b.required } : {}),
      ...(available !== undefined ? { available } : {}),
    };
  }
  return { kind: 'error', message: human || fallback };
}

/** One plain-text line for surfaces that can only show text (toasts, chat bubbles). */
export function billedOutcomeText(outcome: BilledOutcome): string {
  switch (outcome.kind) {
    case 'ok':
      return '';
    case 'credits': {
      const numbers =
        typeof outcome.required === 'number' && typeof outcome.available === 'number'
          ? ` (needs ${outcome.required} credits; you have ${outcome.available})`
          : '';
      const topUp = outcome.code === 'pricing_unavailable' ? '' : ' Top up credits on the Billing page.';
      const sentence = `${outcome.message}${numbers}`;
      return `${/[.!?]$/.test(sentence) ? sentence : `${sentence}.`}${topUp}`;
    }
    default:
      return outcome.message;
  }
}
