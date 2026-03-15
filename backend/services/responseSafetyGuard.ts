/**
 * Response Safety Guard
 * Blocks auto-reply for sensitive intents.
 */

export type SafetyCheckInput = {
  intent?: string | null;
  sentiment?: string | null;
};

export type SafetyCheckResult = {
  allowed: boolean;
  requires_human_review: boolean;
  reason?: string;
};

const BLOCKED_INTENTS = new Set([
  'complaint',
  'negative_feedback',
  'spam',
]);

/**
 * Check whether auto-reply is allowed.
 */
export function checkResponseSafety(input: SafetyCheckInput): SafetyCheckResult {
  const intent = (input.intent ?? '').toString().trim().toLowerCase();
  const sentiment = (input.sentiment ?? '').toString().trim().toLowerCase();

  if (BLOCKED_INTENTS.has(intent)) {
    return {
      allowed: false,
      requires_human_review: true,
      reason: `Intent "${intent}" requires human review`,
    };
  }

  if (sentiment === 'negative') {
    return {
      allowed: false,
      requires_human_review: true,
      reason: 'Negative sentiment requires human review',
    };
  }

  return { allowed: true, requires_human_review: false };
}
