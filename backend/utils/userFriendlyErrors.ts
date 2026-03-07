/**
 * User-Friendly Error Messages
 *
 * Maps technical errors → plain-language messages for users.
 * Reads from user_friendly_error_mappings table; falls back to built-in defaults.
 *
 * Usage:
 *   const msg = await getUserFriendlyMessage(err, 'campaign');
 *   return res.status(500).json({ error: msg });
 */

import {
  resolveUserFriendlyMessage,
  type ErrorContext,
} from '../services/userFriendlyErrorService';

export type { ErrorContext };

/** Built-in defaults when DB is unavailable or table is empty */
const BUILTIN_FALLBACKS: Record<ErrorContext, string> = {
  login: "We're having trouble signing you in. Please try again in a few minutes.",
  company: 'We could not complete that action. Please try again.',
  campaign:
    'Your campaign plan was disrupted due to a technical glitch. Please try again. If the problem persists, try again later or reach out for support.',
  strategic_themes: 'We could not generate themes. Please try again.',
  recommendations: 'Recommendation generation was interrupted. Please try again.',
  publish: 'Publishing was interrupted. Please try again.',
  external_api: 'An external service is temporarily unavailable. Please try again later.',
  generic: "We're facing technical difficulties. Please try again in a few minutes.",
};

/** Messages that look already user-friendly; pass through as-is */
const FRIENDLY_PREFIXES = [
  'please ',
  "you don't have permission",
  'bolt execution blocked',
  'campaign duration must',
  'complete the execution bar',
  'select a company first',
];

function isAlreadyUserFriendly(msg: string): boolean {
  const lower = msg.toLowerCase().trim();
  if (lower.length > 200) return false;
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|\[object\]|Error:/i.test(msg)) return false;
  return FRIENDLY_PREFIXES.some((p) => lower.startsWith(p) || lower.includes(p));
}

/**
 * Get the user-facing message for any error.
 * Uses DB table first; falls back to built-in defaults if table empty or DB unavailable.
 */
export async function getUserFriendlyMessage(
  err: unknown,
  context: ErrorContext = 'generic'
): Promise<string> {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (raw && isAlreadyUserFriendly(raw)) return raw;

  const resolved = await resolveUserFriendlyMessage(err, context);
  if (resolved) return resolved.message;

  return BUILTIN_FALLBACKS[context];
}
