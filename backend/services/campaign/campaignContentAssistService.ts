/**
 * Strategic Mix R3-P1 — Campaign Content assist (SPEC-001 §4: AI assists,
 * never owns; field-assist is the template).
 *
 * PURE service: the LLM is injected (the route wires the billed gateway;
 * tests run offline). Every action is an explicit, user-invoked proposal —
 * the service returns candidate copy, the client applies it as a distinct
 * act. Nothing here mutates state, generates whole campaigns, or persists.
 * This is an assist verb-set over ONE content body, not a generator: the
 * campaign/week/activity generation lanes stay on the existing
 * generate-workspace-content seam.
 */

export const CONTENT_ASSIST_ACTIONS = [
  'improve',
  'shorten',
  'expand',
  'more_technical',
  'more_executive',
  'more_emotional',
  'alternatives',
  'platform_adapt',
  'audience_adapt',
  'improve_cta',
  'improve_hook',
  'improve_image_prompt',
] as const;
export type ContentAssistAction = (typeof CONTENT_ASSIST_ACTIONS)[number];

const ACTION_INSTRUCTIONS: Record<ContentAssistAction, string> = {
  improve: 'Improve the overall quality, clarity and flow of the content. Keep the same message, format and approximate length.',
  shorten: 'Shorten the content significantly while keeping the core message, the hook and the call-to-action. Target roughly half the length.',
  expand: 'Expand the content with more depth, concrete detail or examples. Keep the same voice and structure. Target roughly 1.5× the length.',
  more_technical: 'Rewrite for a technical audience: precise terminology, concrete specifics, no fluff. Keep the format.',
  more_executive: 'Rewrite for an executive audience: outcome-first, concise, strategic framing, minimal jargon. Keep the format.',
  more_emotional: 'Rewrite with more emotional resonance: human stakes, vivid language, relatable framing. Keep the format.',
  alternatives: 'Produce distinct alternative versions of the content. Each must take a genuinely different angle or hook — not a paraphrase.',
  platform_adapt: 'Adapt the content to be native to the target platform: its conventions, length norms, formatting, hashtag and emoji culture.',
  audience_adapt: 'Adapt the content to the target audience described. Adjust vocabulary, examples and framing to resonate with them.',
  improve_cta: 'Rewrite ONLY to strengthen the call-to-action: clearer next step, lower friction, stronger motivation. Keep everything else.',
  improve_hook: 'Rewrite ONLY to strengthen the opening hook: the first line must stop the scroll. Keep everything else.',
  improve_image_prompt: 'Treat the content as an image-generation prompt or visual brief. Rewrite it to be more specific and visually evocative: subject, composition, style, mood.',
};

export interface ContentAssistRequest {
  action: ContentAssistAction;
  /** The current content body the user targeted. */
  content: string;
  platform?: string;
  contentType?: string;
  audience?: string;
  /** Optional free-text steer from the user (explicit, visible). */
  instruction?: string;
  /** alternatives only — how many proposals (2–4). */
  count?: number;
}

export interface ContentAssistValidation {
  ok: boolean;
  request?: ContentAssistRequest;
  errors: string[];
}

const cap = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
};

export function validateContentAssistRequest(body: unknown): ContentAssistValidation {
  const errors: string[] = [];
  const b = (body ?? {}) as Record<string, unknown>;
  const action = typeof b.action === 'string' ? (b.action.trim() as ContentAssistAction) : undefined;
  if (!action || !CONTENT_ASSIST_ACTIONS.includes(action)) {
    errors.push(`action must be one of: ${CONTENT_ASSIST_ACTIONS.join(', ')}`);
  }
  const content = cap(b.content, 8000);
  if (!content) errors.push('content is required');
  if (action === 'platform_adapt' && !cap(b.platform, 40)) errors.push('platform is required for platform_adapt');
  if (action === 'audience_adapt' && !cap(b.audience, 300)) errors.push('audience is required for audience_adapt');
  if (errors.length > 0 || !action || !content) return { ok: false, errors };
  const rawCount = typeof b.count === 'number' && Number.isFinite(b.count) ? Math.floor(b.count) : 3;
  return {
    ok: true,
    errors: [],
    request: {
      action,
      content,
      platform: cap(b.platform, 40),
      contentType: cap(b.content_type ?? b.contentType, 40),
      audience: cap(b.audience, 300),
      instruction: cap(b.instruction, 500),
      count: Math.min(4, Math.max(2, rawCount)),
    },
  };
}

/* ── Prompt (pure) ── */

export type ContentAssistMessage = { role: 'system' | 'user'; content: string };

export function buildContentAssistMessages(request: ContentAssistRequest): ContentAssistMessage[] {
  const proposalCount = request.action === 'alternatives' ? (request.count ?? 3) : 1;
  const system = `You are an expert social media copywriter assisting a marketing team inside their campaign workspace.
You NEVER change the user's intent — you execute exactly the requested transformation on the provided content.
Return ONLY a valid JSON object: {"proposals": [${proposalCount > 1 ? `${proposalCount} strings` : 'one string'}]}.
Each proposal is the COMPLETE transformed content, ready to publish — no commentary, no markdown fences, no labels.`;
  const contextLines: string[] = [];
  if (request.platform) contextLines.push(`Platform: ${request.platform}`);
  if (request.contentType) contextLines.push(`Content type: ${request.contentType}`);
  if (request.audience) contextLines.push(`Target audience: ${request.audience}`);
  if (request.instruction) contextLines.push(`Additional user instruction: ${request.instruction}`);
  const user = `TASK: ${ACTION_INSTRUCTIONS[request.action]}
${contextLines.length > 0 ? `\nCONTEXT:\n${contextLines.join('\n')}\n` : ''}
CONTENT:
${request.content}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/* ── Deterministic fallbacks (LLM/billing failure never breaks the UX) ── */

const sentences = (text: string): string[] => text.match(/[^.!?\n]+[.!?]*\s*/g) ?? [text];

/** shorten/expand are genuinely computable; every other verb has no honest
 *  deterministic transform — those return NO proposals (the UI reports the
 *  degradation instead of presenting a fake improvement). */
export function deterministicContentTransform(request: ContentAssistRequest): string[] {
  if (request.action === 'shorten') {
    const parts = sentences(request.content);
    const keep = Math.max(1, Math.ceil(parts.length / 2));
    return [parts.slice(0, keep).join('').trim()];
  }
  if (request.action === 'expand') {
    const first = sentences(request.content)[0]?.trim() ?? request.content.trim();
    return [`${request.content.trim()}\n\nIn short: ${first}`];
  }
  return [];
}

/* ── Runner ── */

export type ContentAssistLlm = (messages: ContentAssistMessage[]) => Promise<string>;

export interface ContentAssistResult {
  proposals: string[];
  usedFallback: boolean;
  fallbackReason?: string;
}

function parseProposals(raw: string, max: number): string[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const parsed = JSON.parse(cleaned) as { proposals?: unknown };
  const list = Array.isArray(parsed.proposals) ? parsed.proposals : [];
  return list
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .map((p) => p.trim().slice(0, 12000))
    .slice(0, max);
}

export async function runCampaignContentAssist(args: {
  request: ContentAssistRequest;
  llm: ContentAssistLlm;
}): Promise<ContentAssistResult> {
  const { request, llm } = args;
  const max = request.action === 'alternatives' ? (request.count ?? 3) : 1;
  try {
    const raw = await llm(buildContentAssistMessages(request));
    const proposals = parseProposals(raw, max);
    if (proposals.length === 0) {
      return { proposals: deterministicContentTransform(request), usedFallback: true, fallbackReason: 'llm_empty_response' };
    }
    return { proposals, usedFallback: false };
  } catch (error) {
    return {
      proposals: deterministicContentTransform(request),
      usedFallback: true,
      fallbackReason: error instanceof Error ? `llm_error: ${error.message}` : 'llm_error',
    };
  }
}
