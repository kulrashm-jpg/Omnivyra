/**
 * Global Chat Policy — applies to all chat interfaces.
 * Uses LLM-based moderation for abuse, misleading, off-topic, etc.
 * Fast checks (empty, length) run first; LLM handles semantic evaluation.
 */

import type { GlobalPolicyResult } from './types';
import { moderateChatMessage } from '../services/aiGateway';

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
export async function validateAndModerateUserMessage(
  message: string,
  options?: { chatContext?: string }
): Promise<GlobalPolicyResult> {
  const fastResult = validateUserMessage(message);
  if (!fastResult.allowed) return fastResult;

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
