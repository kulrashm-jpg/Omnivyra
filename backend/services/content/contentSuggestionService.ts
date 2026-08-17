/**
 * Content Suggestion Service — "Suggest with AI".
 *
 * Produces ONE concrete, actionable content recommendation from the signals
 * that are actually available today. This is a RECOMMENDATION/BRIEF service:
 * it never produces final content. The existing generation flow
 * (runPostGeneration / the template prefill route) remains solely responsible
 * for writing the content itself.
 *
 * WHY THIS IS NOT A CHAT
 * ----------------------
 * The product requirement is "AI understands what would be useful for me to
 * create", not "AI asks me the same question in a prettier box". So the
 * contract is a STRUCTURED suggestion, and `isActionableSuggestion()` rejects a
 * model reply that merely asks a clarifying question — falling back to a
 * deterministic suggestion derived from the same real signals rather than
 * surfacing a question to the user.
 *
 * SIGNAL HONESTY
 * --------------
 * `context_used` records exactly which signals fed the suggestion. Signals that
 * do not exist yet in production (content history — `content_memory` is empty;
 * generation-time knowledge-graph reads; coverage/gap analysis) are reported as
 * `false` and are NOT claimed in the rationale. They are already named in the
 * contract so they can be switched on later WITHOUT changing the UI contract.
 *
 * BILLING
 * -------
 * Deliberately reuses the EXISTING `creatorFieldAssist` operation key — the key
 * already behind Creator's "Suggest with AI" field-assist, mapped in
 * shared/monetization/featureRegistry.ts to the `content_rewrite` action key.
 * Same billable capability (assistive brief drafting for one company), so this
 * introduces no new action key, no featureRegistry change, no pricing change,
 * and no new `unknown_action_key` anomaly class.
 */

import { runCompletionWithOperation } from '../aiGateway';
import { resolveCompanyGroundingGuard } from '../context/canonicalContentContextResolver';
import { getCanonicalProfile } from '../context/canonicalProfileAdapter';
import { generateContentOpportunities, type ContentOpportunity } from '../contentOpportunityService';
import {
  isActionableSuggestion,
  SUGGESTION_INTENTS,
  SUGGESTION_PRIORITIES,
  type ContentSuggestion,
  type ContentSuggestionContextUsed,
} from '../../../lib/content/contentSuggestionContract';

// The contract itself lives in lib/content/contentSuggestionContract.ts so the
// UI can share it without importing this service (and with it supabase + the AI
// gateway) into the client bundle. Re-exported here for server-side callers.
export type { ContentSuggestion, ContentSuggestionContextUsed };
export { isActionableSuggestion, toGenerationInput } from '../../../lib/content/contentSuggestionContract';

export type ContentSuggestionInput = {
  companyId: string;
  contentType: string;
  formatLabel?: string;
  /** Context only — never used to make the master platform-specific. */
  platform?: string;
  objective?: string;
  audience?: string;
  campaignContext?: string;
  /** Whatever the user has already typed. May be empty — that is the point. */
  userInput?: string;
  /** Present on "Revise": the refinement the user asked for. */
  revisionInstruction?: string;
  /** The suggestion being revised, so the model refines rather than restarts. */
  previousSuggestion?: ContentSuggestion | null;
  revisionIndex?: number;
};

const OPPORTUNITY_WINDOW_HOURS = 72;
const MAX_OPPORTUNITIES_IN_PROMPT = 3;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  const candidate = text(value).toLowerCase();
  return (allowed as string[]).includes(candidate) ? (candidate as T) : fallback;
}

function readProfileContext(profile: unknown): { lines: string[]; present: boolean } {
  const record = (profile && typeof profile === 'object' ? profile : {}) as Record<string, unknown>;
  const fields: Array<[string, unknown]> = [
    ['Industry', record.industry],
    ['Category', record.category],
    ['Products / services', record.products_services],
    ['Target audience', record.target_audience],
    ['Positioning / goals', record.goals],
    ['Content themes', record.content_themes],
    ['Brand voice', record.brand_voice],
  ];
  const lines = fields
    .map(([label, value]) => (text(value) ? `${label}: ${text(value)}` : ''))
    .filter(Boolean);
  return { lines, present: lines.length > 0 };
}

/**
 * Engagement/opportunity signals are tenant-scoped at the source
 * (`generateContentOpportunities` filters every query by organization_id).
 * A tenant with no engagement data simply yields an empty list — which must
 * degrade the suggestion, never break it.
 */
async function readOpportunities(companyId: string): Promise<ContentOpportunity[]> {
  try {
    const opportunities = await generateContentOpportunities(companyId, OPPORTUNITY_WINDOW_HOURS);
    return Array.isArray(opportunities) ? opportunities.slice(0, MAX_OPPORTUNITIES_IN_PROMPT) : [];
  } catch {
    // Missing signals must not break suggestion generation.
    return [];
  }
}

/**
 * Deterministic suggestion built ONLY from signals we actually hold.
 *
 * Used when the model is unavailable or returns something non-actionable. It
 * never fabricates history, traction, or graph coverage — with no signals at
 * all it falls back to the content type and says so in the rationale.
 */
export function buildDeterministicSuggestion(
  input: ContentSuggestionInput,
  signals: { profileLines: string[]; opportunities: ContentOpportunity[]; brand: string },
): ContentSuggestion {
  const { profileLines, opportunities, brand } = signals;
  const contentLabel = input.contentType.replace(/[-_]/g, ' ');
  const topOpportunity = opportunities[0] ?? null;
  const audience = text(input.audience) || 'the decision-makers you sell to';
  const owner = brand || 'your company';

  const topic = topOpportunity
    ? topOpportunity.suggested_title
    : text(input.userInput)
      ? `${text(input.userInput)} — a clear point of view`
      : `The one thing ${owner} should be saying about ${contentLabel === 'post' ? 'its market' : contentLabel} right now`;

  const reason = topOpportunity
    ? `Your engagement signals show recurring interest in "${topOpportunity.topic}" (confidence ${topOpportunity.confidence_score}). Publishing on it answers a question your audience is already asking.`
    : profileLines.length > 0
      ? 'Built from your company positioning and audience. No engagement signals were available for this window, so this leads with your stated point of view.'
      : `No company profile or engagement signals were available, so this is a starting direction for a ${contentLabel} only. Add your angle below to sharpen it.`;

  return {
    topic,
    angle: topOpportunity
      ? `Answer it directly, from ${owner}'s own experience, rather than surveying the category.`
      : 'Lead with a specific, defensible claim and support it with something only you can say.',
    objective: text(input.objective) || (topOpportunity?.opportunity_type === 'landing_page' ? 'conversion' : 'authority'),
    audience,
    brief: [
      `Write a ${contentLabel} for ${audience}.`,
      `Topic: ${topic}.`,
      topOpportunity ? `Anchor it in the "${topOpportunity.topic}" discussion your audience is already having.` : '',
      'Open with the specific claim, support it with concrete detail, and close with one clear next step.',
    ].filter(Boolean).join(' '),
    reason,
    intent: topOpportunity?.opportunity_type === 'landing_page' ? 'conversion' : 'authority',
    priority: topOpportunity ? 'high' : 'medium',
    tone: 'Specific, modern, and high-signal',
    format_guidance: input.formatLabel ? `Shape it for the ${input.formatLabel} format.` : '',
    platform_guidance: '',
    context_used: buildContextUsed(input, profileLines.length > 0, opportunities.length),
    ...(input.revisionInstruction
      ? { revision: { instruction: input.revisionInstruction, revision_index: input.revisionIndex ?? 1 } }
      : {}),
  };
}

function buildContextUsed(
  input: ContentSuggestionInput,
  profilePresent: boolean,
  opportunityCount: number,
): ContentSuggestionContextUsed {
  return {
    company_profile: profilePresent,
    engagement_signals: opportunityCount,
    user_input: Boolean(text(input.userInput)),
    campaign_context: Boolean(text(input.campaignContext)),
    // Declared but not yet readable in production. Reported honestly as false
    // so neither the UI nor the rationale can claim them.
    content_history: false,
    knowledge_graph: false,
    coverage_analysis: false,
  };
}

function buildPrompt(
  input: ContentSuggestionInput,
  signals: { profileLines: string[]; opportunities: ContentOpportunity[] },
): string {
  const contentLabel = input.contentType.replace(/[-_]/g, ' ');
  const opportunityLines = signals.opportunities.map(
    (opportunity) =>
      `- "${opportunity.topic}" (${opportunity.opportunity_type}, confidence ${opportunity.confidence_score}) — signals: ` +
      `${opportunity.signal_summary.questions} questions, ${opportunity.signal_summary.problems} problems, ` +
      `${opportunity.signal_summary.comparisons} comparisons, ${opportunity.signal_summary.feature_requests} feature requests`,
  );

  return [
    `Content type: ${contentLabel}`,
    input.formatLabel ? `Format: ${input.formatLabel}` : '',
    // Platform is CONTEXT for the recommendation only. It must not turn the
    // master draft into a platform-specific artefact.
    input.platform ? `Platform this will eventually be adapted for (context only): ${input.platform}` : '',
    input.objective ? `Stated objective: ${input.objective}` : '',
    input.audience ? `Stated audience: ${input.audience}` : '',
    input.campaignContext ? `Campaign context: ${input.campaignContext}` : '',
    text(input.userInput) ? `What the user has said so far: ${text(input.userInput)}` : 'The user has not provided any input yet.',
    signals.profileLines.length > 0 ? `Company profile:\n${signals.profileLines.join('\n')}` : 'No company profile fields are available.',
    opportunityLines.length > 0
      ? `Engagement/opportunity signals (real, from this company's own threads):\n${opportunityLines.join('\n')}`
      : 'No engagement signals are available for this window.',
    input.previousSuggestion
      ? `Previous suggestion to revise:\n${JSON.stringify({
          topic: input.previousSuggestion.topic,
          angle: input.previousSuggestion.angle,
          objective: input.previousSuggestion.objective,
          audience: input.previousSuggestion.audience,
          brief: input.previousSuggestion.brief,
        })}`
      : '',
    input.revisionInstruction ? `The user asked for this refinement: ${input.revisionInstruction}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

const RESPONSE_SHAPE = `{
  "topic": "concrete, specific title — never a question",
  "angle": "the point of view that makes it worth reading",
  "objective": "what this piece is meant to achieve",
  "audience": "who it is for",
  "brief": "3-5 sentences the writer can act on directly",
  "reason": "why THIS, based only on the signals given above",
  "intent": "awareness | authority | conversion | retention",
  "priority": "high | medium | low",
  "tone": "short tone descriptor",
  "format_guidance": "one line on structure for this format",
  "platform_guidance": "one line of platform context, or empty string"
}`;

export async function generateContentSuggestion(
  input: ContentSuggestionInput,
): Promise<ContentSuggestion> {
  const companyId = text(input.companyId);
  if (!companyId) {
    throw new Error('companyId is required to generate a content suggestion');
  }

  // Every signal read below is tenant-scoped by companyId. A tenant with no
  // profile and no engagement data still gets a suggestion — just a weaker one.
  const [profile, opportunities, grounding] = await Promise.all([
    getCanonicalProfile(companyId, { autoRefine: false, languageRefine: false }).catch(() => null),
    readOpportunities(companyId),
    resolveCompanyGroundingGuard(companyId).catch(() => null),
  ]);

  const { lines: profileLines, present: profilePresent } = readProfileContext(profile);
  const brand = text(grounding?.brand);
  const deterministic = () =>
    buildDeterministicSuggestion(input, { profileLines, opportunities, brand });

  try {
    const response = await runCompletionWithOperation({
      operation: 'creatorFieldAssist',
      companyId,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.7,
      max_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a senior content strategist. You RECOMMEND what the company should publish next — ' +
            'you do NOT write the content, and you do NOT ask the user questions.\n\n' +
            'Non-negotiable rules:\n' +
            '- Always return ONE concrete recommendation, even when the user has given you nothing.\n' +
            '- Never reply with a clarifying question. Never make "topic" a question.\n' +
            '- Ground every claim in the signals provided. Do not invent traction, customers, ' +
            'published history, or performance data that is not in the input.\n' +
            '- The brief must be actionable enough that a writer can start immediately.\n' +
            '- Output valid JSON only.\n\n' +
            (grounding?.directive ?? ''),
        },
        {
          role: 'user',
          content: `${buildPrompt(input, { profileLines, opportunities })}\n\nReturn JSON with exactly this shape:\n${RESPONSE_SHAPE}`,
        },
      ],
    });

    const raw = text(response?.output);
    if (!raw) return deterministic();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return deterministic();
    }

    const candidate: Partial<ContentSuggestion> = {
      topic: text(parsed.topic),
      brief: text(parsed.brief),
    };
    // The model asked a question, or gave us something too thin to act on.
    // Fall back rather than surface it: the whole point of the feature.
    if (!isActionableSuggestion(candidate)) return deterministic();

    const fallback = deterministic();
    return {
      topic: text(parsed.topic),
      angle: text(parsed.angle) || fallback.angle,
      objective: text(parsed.objective) || fallback.objective,
      audience: text(parsed.audience) || fallback.audience,
      brief: text(parsed.brief),
      reason: text(parsed.reason) || fallback.reason,
      intent: pick(parsed.intent, SUGGESTION_INTENTS, fallback.intent),
      priority: pick(parsed.priority, SUGGESTION_PRIORITIES, fallback.priority),
      tone: text(parsed.tone) || fallback.tone,
      format_guidance: text(parsed.format_guidance) || fallback.format_guidance,
      platform_guidance: text(parsed.platform_guidance),
      context_used: buildContextUsed(input, profilePresent, opportunities.length),
      ...(input.revisionInstruction
        ? { revision: { instruction: input.revisionInstruction, revision_index: input.revisionIndex ?? 1 } }
        : {}),
    };
  } catch {
    // AI unavailable — the feature still returns something usable.
    return deterministic();
  }
}
