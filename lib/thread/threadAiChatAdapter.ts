/**
 * G19 — Thread AI Chat adapter.
 *
 * Bridges AIBlogCardModal's BlogCardPreview output to ThreadIntelligenceView's
 * form state, mapping the blog-vocabulary intent enum to the thread-vocabulary
 * intent enum and projecting freeform fields (topic / tone / audience /
 * reason / writingStyle) into the thread form's pre-fill slots.
 *
 * Thread-specific structured fields (anchor, executionMode, platform, format)
 * are NOT captured by the chat modal and remain user-controlled on the form.
 * The adapter does not touch them. Per G19 strict rule "DO NOT flatten thread
 * semantics into post semantics" / "DO NOT discard anchor / executionMode."
 *
 * Pure functions; no side effects. Easy to revise the mapping in one place.
 */

import type { ThreadIntentValue } from './threadFlow';

export type BlogCardIntent = 'awareness' | 'authority' | 'conversion' | 'retention';

/**
 * BlogCardPreview shape we accept (subset of what AIBlogCardModal returns).
 * Re-typed locally to avoid coupling to the modal's internal interface.
 */
export type AiChatCardForThread = {
  topic: string;
  intent: BlogCardIntent;
  audience?: string;
  reason?: string;
  priority?: 'high' | 'medium' | 'low';
  tone?: string;
  writingStyle?: string;
  relatedTopics?: string[];
};

/**
 * Map blog-vocabulary intent to thread-vocabulary intent.
 *
 * Mapping is semantic-best-effort. Thread has a fifth value ('story') that has
 * no blog-side equivalent; user can pick it manually on the form after the
 * chat returns.
 *
 * | Blog       | Thread    | Why                                              |
 * |------------|-----------|--------------------------------------------------|
 * | awareness  | educate   | "introduce a concept" → "teach clearly"          |
 * | authority  | breakdown | "establish expertise" → "break down a strategy"  |
 * | conversion | launch    | "drive action" → "support a launch"              |
 * | retention  | lessons   | "deepen practice" → "share lessons learned"      |
 */
export function mapBlogIntentToThreadIntent(blogIntent: BlogCardIntent): ThreadIntentValue {
  switch (blogIntent) {
    case 'awareness':  return 'educate';
    case 'authority':  return 'breakdown';
    case 'conversion': return 'launch';
    case 'retention':  return 'lessons';
    default:           return 'educate';
  }
}

/**
 * Pre-fill shape ThreadIntelligenceView can apply to its form state.
 * Fields are optional so the caller can decide whether to overwrite existing
 * non-empty values (preserves manual edits the user already made before
 * opening the chat).
 */
export type ThreadAiChatPrefill = {
  topic?: string;
  intent?: ThreadIntentValue;
  tone?: string;
  audience?: string;
  /**
   * Combined freeform context the chat surfaced — reason and writingStyle
   * concatenated as a hint to the AI generation step. ThreadIntelligenceView
   * already has an `extraInstruction` textarea for this purpose.
   */
  extraInstruction?: string;
};

export function buildThreadPrefillFromCard(card: AiChatCardForThread): ThreadAiChatPrefill {
  const topic = String(card.topic ?? '').trim();
  const tone = card.tone ? String(card.tone).trim() : '';
  const audience = card.audience ? String(card.audience).trim() : '';
  const reason = card.reason ? String(card.reason).trim() : '';
  const writingStyle = card.writingStyle ? String(card.writingStyle).trim() : '';

  const extraParts = [reason, writingStyle].filter(Boolean);
  const extraInstruction = extraParts.length > 0 ? extraParts.join('\n\n') : undefined;

  return {
    topic: topic || undefined,
    intent: card.intent ? mapBlogIntentToThreadIntent(card.intent) : undefined,
    tone: tone || undefined,
    audience: audience || undefined,
    extraInstruction,
  };
}
