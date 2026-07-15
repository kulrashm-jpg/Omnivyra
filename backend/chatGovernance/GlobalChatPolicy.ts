/**
 * Global Chat Policy — applies to all chat interfaces.
 * Uses LLM-based moderation for abuse, misleading, off-topic, etc.
 * Fast checks (empty, length) run first; LLM handles semantic evaluation.
 */

import type { GlobalPolicyResult } from './types';
import { moderateChatMessage } from '../services/aiGateway';
import { defineRolloutFlag, resolveRolloutSync } from '../../lib/platform/rollout';
import { recordRawCounter } from '../observability';

/** Max user message length to prevent abuse/overflow */
const MAX_MESSAGE_LENGTH = 4000;

/** Min meaningful length */
const MIN_MEANINGFUL_LENGTH = 1;

/**
 * Fast sync checks only: empty, length.
 * Use for client-side or when you need instant validation.
 */
export function validateUserMessage(message: string): GlobalPolicyResult {
  if (!message || typeof message !== 'string') {
    return { allowed: false, reason: 'Message is required', code: 'empty' };
  }

  const trimmed = message.trim();
  if (trimmed.length < MIN_MEANINGFUL_LENGTH) {
    return { allowed: false, reason: 'Please enter a message', code: 'empty' };
  }

  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return {
      allowed: false,
      reason: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters)`,
      code: 'too_long',
    };
  }

  return { allowed: true };
}

/**
 * Full validation + LLM moderation.
 * Call before passing user message to the main chat/plan flow.
 * The LLM evaluates: abuse, profanity, misleading, off-topic (gambling etc.), spam, gibberish.
 */
// ── W3-5 (audit B-64): deterministic moderation fast path ─────────────────────
// Every interactive planner turn paid a full LLM moderation round-trip — even
// for "yes" / "2" / "continue". Under the 'moderation-fast-path' flag,
// messages matching a DELIBERATELY NARROW allow-list of trivially-safe
// conversational tokens skip the LLM. The list is conservative by
// construction: short, closed-vocabulary or purely numeric/option-selection
// inputs that cannot express abuse/spam/off-topic content. Anything else —
// including anything containing letters outside the closed vocabulary —
// still goes to the LLM. Flag off (default) = every message moderated by LLM.
const MODERATION_FAST_PATH_FLAG = defineRolloutFlag({
  key: 'moderation-fast-path',
  description: 'W3-5: skip LLM moderation for trivially-safe planner replies (audit B-64)',
});

const FAST_PATH_EXACT = new Set([
  'yes', 'no', 'ok', 'okay', 'sure', 'continue', 'next', 'skip', 'done',
  'go ahead', 'sounds good', 'looks good', 'confirm', 'confirmed', 'proceed',
  'yes please', 'no thanks', 'not sure', 'start', 'generate', 'regenerate',
]);
// Pure option-selection inputs: numbers, number lists/ranges, single option
// letters ("a"/"b"), or "option N" — max 24 chars.
const FAST_PATH_PATTERN = /^(?:option\s*)?(?:[0-9]{1,3}(?:\s*[,&+-]\s*[0-9]{1,3}){0,4}|[a-d])$/i;

/** True when the message is trivially safe (metrics-counted; exported for tests). */
export function isTriviallySafeMessage(message: string): boolean {
  const trimmed = message.trim().toLowerCase().replace(/[.!?]+$/, '');
  if (trimmed.length === 0 || trimmed.length > 24) return false;
  return FAST_PATH_EXACT.has(trimmed) || FAST_PATH_PATTERN.test(trimmed);
}

export async function validateAndModerateUserMessage(
  message: string,
  options?: { chatContext?: string }
): Promise<GlobalPolicyResult> {
  const fastResult = validateUserMessage(message);
  if (!fastResult.allowed) return fastResult;

  if (resolveRolloutSync(MODERATION_FAST_PATH_FLAG).mode !== 'off') {
    try {
      if (isTriviallySafeMessage(message)) {
        recordRawCounter('moderation.fast_path', 1, { result: 'allowed' });
        return { allowed: true };
      }
      recordRawCounter('moderation.fast_path', 1, { result: 'llm' });
    } catch { /* fail-safe → LLM path */ }
  }

  const llmResult = await moderateChatMessage({
    message: message.trim(),
    chatContext: options?.chatContext,
  });

  if (llmResult.allowed) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: llmResult.reason ?? 'Your message was not appropriate for this chat.',
    code: (llmResult.code as GlobalPolicyResult['code']) ?? 'abuse',
  };
}
