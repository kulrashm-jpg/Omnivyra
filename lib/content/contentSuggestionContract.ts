/**
 * P1.6 — "Suggest with AI" contract.
 *
 * Deliberately dependency-free: the UI panel and the backend service both need
 * these types and the accept-mapping, and the panel must never pull the backend
 * service (and with it supabase + the AI gateway) into the client bundle.
 *
 * SUGGESTION ≠ FINAL CONTENT. Everything here describes a recommendation/brief;
 * producing the actual content remains the existing generation flow's job.
 */

/**
 * Which signals actually fed a suggestion.
 *
 * Extension point: `content_history` / `knowledge_graph` / `coverage_analysis`
 * are declared now and reported `false` until those readers exist in
 * production, so switching them on later is a service-side change only — this
 * contract, and therefore the UI, does not move.
 */
export type ContentSuggestionContextUsed = {
  company_profile: boolean;
  engagement_signals: number;
  user_input: boolean;
  campaign_context: boolean;
  content_history: boolean;
  knowledge_graph: boolean;
  coverage_analysis: boolean;
};

/**
 * Field names mirror the existing `RecommendationCard` contract
 * (components/content/managed-intelligence/types.ts) wherever they overlap —
 * `topic`, `reason`, `intent`, `priority` — precisely so an accepted suggestion
 * populates the EXISTING generation input instead of opening a second path.
 */
export type ContentSuggestion = {
  topic: string;
  angle: string;
  objective: string;
  audience: string;
  brief: string;
  /** Rationale. Named `reason` to match RecommendationCard.reason. */
  reason: string;
  intent: 'awareness' | 'authority' | 'conversion' | 'retention';
  priority: 'high' | 'medium' | 'low';
  tone: string;
  format_guidance: string;
  /**
   * Platform-aware CONTEXT only. The master draft stays platform-neutral —
   * this never enters the master-generation contract; platform shaping remains
   * the variant step's job.
   */
  platform_guidance: string;
  context_used: ContentSuggestionContextUsed;
  revision?: { instruction: string; revision_index: number };
};

/** The existing generation input shape (RecommendationCard + tone). */
export type SuggestionGenerationInput = {
  topic: string;
  reason: string;
  intent: ContentSuggestion['intent'];
  priority: ContentSuggestion['priority'];
  tone: string;
};

export const SUGGESTION_INTENTS: ContentSuggestion['intent'][] = [
  'awareness',
  'authority',
  'conversion',
  'retention',
];

export const SUGGESTION_PRIORITIES: ContentSuggestion['priority'][] = ['high', 'medium', 'low'];

/**
 * A suggestion is only useful if accepting it lets generation proceed. A reply
 * that asks the user a question does not qualify, however well-formed its JSON.
 */
export function isActionableSuggestion(candidate: Partial<ContentSuggestion> | null | undefined): boolean {
  if (!candidate) return false;
  const topic = typeof candidate.topic === 'string' ? candidate.topic.trim() : '';
  const brief = typeof candidate.brief === 'string' ? candidate.brief.trim() : '';
  if (topic.length < 8 || brief.length < 40) return false;
  // A trailing '?' on the topic is the signature of "What would you like to
  // write about?" reformatted into the response shape.
  if (topic.endsWith('?')) return false;
  return true;
}

/**
 * THE integration point.
 *
 * Converts an accepted suggestion into the EXISTING generation input — the same
 * `RecommendationCard`-shaped object the recommended cards and the AI card modal
 * already hand to `generatePostFromIdea()` / the template prefill route. Accept
 * therefore populates the existing pipeline rather than opening a parallel one.
 *
 * Note what is NOT carried across: `platform_guidance` stays behind, so an
 * accepted suggestion cannot make the platform-neutral master draft
 * platform-specific.
 */
export function toGenerationInput(suggestion: ContentSuggestion): SuggestionGenerationInput {
  return {
    topic: suggestion.topic,
    // The brief is the actionable part — it must reach the generator, not just
    // the rationale the user read on screen.
    reason: [suggestion.brief, suggestion.angle].filter(Boolean).join(' '),
    intent: suggestion.intent,
    priority: suggestion.priority,
    tone: suggestion.tone,
  };
}
