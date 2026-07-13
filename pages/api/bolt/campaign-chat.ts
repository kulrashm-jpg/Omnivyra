/**
 * POST /api/bolt/campaign-chat
 * AI chat to brainstorm and refine campaign topics for the BOLT strategy builder.
 * Uses the same aiGateway (runCompletionWithOperation) as the rest of the platform.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { runCompletionWithOperation } from '../../../backend/services/aiGateway';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
import { createHash } from 'crypto';
import { wirePhase2Route } from '../../../backend/services/billing/phase2RouteWiring';
import { PaymentRequiredError } from '../../../backend/services/billing/phase2EnforcementGate';
// Phase 6A — blueprint validation derives from the CANONICAL capability layer
// (no second list): platform capability registry, creator governance, BOLT
// text config, and connected-account eligibility.
import {
  PLATFORM_CAPABILITY_REGISTRY,
  getPlatformCapability,
  normalizePlatformKey,
} from '../../../lib/shared/social/platformCapabilities';
import {
  CREATOR_GOVERNANCE_REGISTRY,
  getCreatorGovernance,
  normalizeCreatorFormat,
} from '../../../lib/shared/creatorGovernanceRegistry';
import { BOLT_TEXT_CONTENT_TYPES, isBoltTextContentType } from '../../../backend/utils/boltTextContentConfig';
import { getConnectedPlatformsForCompany } from '../../../backend/utils/platformEligibility';
// Phase 6C-4C — Architect duration aligns with Intelligent Mix execution (1–12).
import { MAX_CAMPAIGN_DURATION_WEEKS } from '../../../lib/shared/campaignDuration';
// Phase 6D-A — read-only intelligence enrichment for the Intelligent Mix Architect.
import { resolveIntelligenceContext, formatIntelligenceContextBlock } from '../../../lib/shared/intelligence/resolveIntelligenceContext';
// Phase 6G-1 — canonical content↔platform assignment authority.
import { getSupportedPlatformsForFormat } from '../../../lib/shared/bolt/contentPlatformAssignment';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

// Hard cap on each company-context field so a verbose profile can't bloat
// the prompt past ~2 KB. The AI doesn't need the full essay version — it
// needs enough to know what the company IS so it stops asking redundant
// "what do you do?" questions.
const COMPANY_FIELD_MAX = 280;

function clip(value: unknown, max = COMPANY_FIELD_MAX): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function clipList(value: unknown, joinWith = ', ', max = COMPANY_FIELD_MAX): string | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
  if (items.length === 0) return null;
  return clip(items.join(joinWith), max);
}

/**
 * Pull the high-signal marketing fields from the company profile and shape
 * them into a compact context block. `null` when the profile lookup fails
 * or the company has nothing populated — caller falls through silently.
 */
async function buildCompanyContextBlock(companyId: string): Promise<string | null> {
  try {
    // autoRefine=false / languageRefine=false → cheap read. We never want
    // the chat endpoint to trigger an expensive AI refinement of the
    // profile as a side effect.
    const profile = await getProfile(companyId, { autoRefine: false, languageRefine: false });
    if (!profile) return null;

    const lines: string[] = [];
    const name = clip((profile as { name?: unknown }).name);
    const industry = clip((profile as { industry?: unknown }).industry)
      ?? clipList((profile as { industry_list?: unknown }).industry_list);
    const productsServices = clip((profile as { products_services?: unknown }).products_services)
      ?? clipList((profile as { products_services_list?: unknown }).products_services_list);
    const targetAudience = clip((profile as { target_audience?: unknown }).target_audience)
      ?? clipList((profile as { target_audience_list?: unknown }).target_audience_list);
    const uniqueValue = clip((profile as { unique_value?: unknown }).unique_value);
    const goals = clip((profile as { goals?: unknown }).goals);
    const growth = clip((profile as { growth_priorities?: unknown }).growth_priorities);
    const geography = clip((profile as { geography?: unknown }).geography)
      ?? clipList((profile as { geography_list?: unknown }).geography_list);

    if (name)              lines.push(`Company: ${name}`);
    if (industry)          lines.push(`Industry: ${industry}`);
    if (productsServices)  lines.push(`Products / services: ${productsServices}`);
    if (targetAudience)    lines.push(`Default target audience: ${targetAudience}`);
    if (uniqueValue)       lines.push(`Unique value: ${uniqueValue}`);
    if (goals)             lines.push(`Company goals: ${goals}`);
    if (growth)            lines.push(`Growth priorities: ${growth}`);
    if (geography)          lines.push(`Geography: ${geography}`);

    if (lines.length === 0) return null;
    return lines.join('\n');
  } catch (err) {
    // Best-effort. A missing/broken profile must not break the chat — the
    // AI just loses company-level grounding and behaves the way it did
    // before this code existed.
    console.warn('[bolt/campaign-chat] company context fetch failed:', (err as Error)?.message);
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      companyId,
      message,
      history,
      context,
      // Campaign Memory — accepted = user committed, passed-over = shown
      // earlier in this session but not accepted (a soft "no" signal).
      accepted_suggestions: acceptedRaw,
      passed_over_suggestions: passedOverRaw,
      // Phase 5 — Intelligent Mix "Campaign Architect" opt-in. ONLY the
      // combined page sends this; BOLT Text/Creator never do, so their prompt
      // and response stay byte-identical (no new fields, no prompt change).
      blueprint: blueprintFlag,
    } = req.body || {};
    const wantBlueprint = blueprintFlag === true;

    if (!companyId || typeof companyId !== 'string') {
      return res.status(400).json({ error: 'companyId is required' });
    }
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: companyId.trim(), requireCampaignId: false });
    if (!access) return;

    const chatHistory: ChatMessage[] = Array.isArray(history) ? history : [];

    // Build context block from current form state
    // Fetch the company profile in parallel with the rest of context-building
    // so the lookup doesn't add latency on top of the LLM call. Profile data
    // is authoritative ("this is who the company IS") and goes on the system
    // prompt; the per-form fields below are user state ("what they've typed
    // so far") and go on the user message.
    const companyContextBlockPromise = buildCompanyContextBlock(companyId.trim());

    const ctx = context && typeof context === 'object' ? context as Record<string, unknown> : {};
    const contextParts: string[] = [];
    if (ctx.topic) contextParts.push(`Current campaign topic: "${ctx.topic}"`);
    if (ctx.description) contextParts.push(`Current campaign description: "${ctx.description}"`);
    // Multi-select Brief fields. Goals + tone come through as arrays from
    // useBoltStrategy; the prior single-string `goal` form is kept for
    // back-compat with older callers.
    if (Array.isArray(ctx.goals) && (ctx.goals as unknown[]).length > 0) {
      contextParts.push(`Campaign goals: ${(ctx.goals as string[]).join(', ')}`);
    } else if (ctx.goal) {
      contextParts.push(`Campaign goal: ${ctx.goal}`);
    }
    if (Array.isArray(ctx.tone) && (ctx.tone as unknown[]).length > 0) {
      contextParts.push(`Tone: ${(ctx.tone as string[]).join(', ')}`);
    }
    if (ctx.audience) contextParts.push(`Target audience: ${ctx.audience}`);
    if (ctx.strategicFocus && Array.isArray(ctx.strategicFocus) && ctx.strategicFocus.length > 0) {
      contextParts.push(`Strategic focus: ${(ctx.strategicFocus as string[]).join(', ')}`);
    }
    if (ctx.duration) contextParts.push(`Duration: ${ctx.duration} weeks`);

    // ── Execution constraints ──────────────────────────────────────────────
    // The AI must not suggest campaign shapes the planner can't execute.
    // E.g. "Tell a 4-part visual reel arc" makes no sense when only
    // LinkedIn-text + Post is selected.
    if (Array.isArray(ctx.selectedPlatforms) && (ctx.selectedPlatforms as unknown[]).length > 0) {
      contextParts.push(`Selected platforms: ${(ctx.selectedPlatforms as string[]).join(', ')}`);
    }
    if (Array.isArray(ctx.selectedFormats) && (ctx.selectedFormats as unknown[]).length > 0) {
      contextParts.push(`Selected content formats: ${(ctx.selectedFormats as string[]).join(', ')}`);
    }
    if (ctx.formatFrequency && typeof ctx.formatFrequency === 'object') {
      const ff = ctx.formatFrequency as Record<string, unknown>;
      const pieces = Object.entries(ff)
        .filter(([, v]) => typeof v === 'number' && (v as number) > 0)
        .map(([k, v]) => `${k}×${v}/wk`);
      if (pieces.length > 0) contextParts.push(`Posting frequency: ${pieces.join(', ')}`);
    }
    if (typeof ctx.outcomeView === 'string') {
      const human = ctx.outcomeView === 'week_plan' ? 'Week Plan only (brainstorming)'
        : ctx.outcomeView === 'daily_plan' ? 'Daily Plan (refining)'
        : ctx.outcomeView === 'schedule' ? 'Schedule (execution-ready)'
        : String(ctx.outcomeView);
      contextParts.push(`Workflow stage: ${human}`);
    }

    const contextBlock = contextParts.length > 0
      ? `Current campaign context:\n${contextParts.join('\n')}\n\n`
      : '';

    const companyContextBlock = await companyContextBlockPromise;

    // Authoritative company facts. The AI must treat these as known and
    // STOP asking "What does the company do?" / "Who do you target?" once
    // a fact is already in scope — that's the source of the user's
    // "the AI keeps asking what we already told it" complaint.
    const companyContextSection = companyContextBlock
      ? `\n\nThe user works at this company. Treat these facts as authoritative — do NOT ask the user to re-supply anything you already have here:\n${companyContextBlock}\n`
      : '';

    // ── Campaign Memory sections ───────────────────────────────────────────
    // Two lists fed in with explicit framing so the AI knows which ones to
    // build on (accepted) and which to avoid repeating (passed-over). Both
    // are CLIPPED at the API boundary as a token-budget defence — the
    // client also clips, but we don't trust the wire payload size blindly.
    const accepted = Array.isArray(acceptedRaw) ? (acceptedRaw as unknown[]).slice(-5) : [];
    const passedOver = Array.isArray(passedOverRaw) ? (passedOverRaw as unknown[]).slice(-5) : [];

    function summarizeAccepted(entry: unknown): string | null {
      if (!entry || typeof entry !== 'object') return null;
      const e = entry as Record<string, unknown>;
      const topic = typeof e.topic === 'string' ? e.topic.trim() : '';
      if (!topic) return null;
      const parts: string[] = [`"${topic.slice(0, 140)}"`];
      if (typeof e.description === 'string' && e.description.trim()) {
        parts.push(`— ${e.description.trim().slice(0, 140)}`);
      }
      if (Array.isArray(e.goals) && e.goals.length > 0) parts.push(`[goals: ${(e.goals as string[]).join(', ')}]`);
      if (Array.isArray(e.tone) && e.tone.length > 0) parts.push(`[tone: ${(e.tone as string[]).join(', ')}]`);
      if (typeof e.audience === 'string' && e.audience.trim()) parts.push(`[audience: ${e.audience.trim().slice(0, 100)}]`);
      return parts.join(' ');
    }
    function summarizePassedOver(entry: unknown): string | null {
      if (!entry || typeof entry !== 'object') return null;
      const e = entry as Record<string, unknown>;
      const topic = typeof e.topic === 'string' ? e.topic.trim() : '';
      if (!topic) return null;
      return typeof e.description_clip === 'string' && e.description_clip.trim()
        ? `"${topic.slice(0, 140)}" — ${e.description_clip.trim().slice(0, 140)}`
        : `"${topic.slice(0, 140)}"`;
    }

    const acceptedLines = accepted.map(summarizeAccepted).filter((l): l is string => l !== null);
    const passedOverLines = passedOver.map(summarizePassedOver).filter((l): l is string => l !== null);

    const acceptedSection = acceptedLines.length > 0
      ? `\n\nDirections the user has ALREADY ACCEPTED in this campaign draft (build on / refine / diversify these — do not propose near-duplicates):\n${acceptedLines.map((l) => `- ${l}`).join('\n')}\n`
      : '';
    const passedOverSection = passedOverLines.length > 0
      ? `\n\nIdeas already shown but NOT accepted by the user this session — avoid repeating them, surface a different angle instead:\n${passedOverLines.map((l) => `- ${l}`).join('\n')}\n`
      : '';

    const systemPrompt = `You are a campaign strategy advisor helping a marketer brainstorm and refine their campaign topic using the BOLT strategy builder.${companyContextSection}${acceptedSection}${passedOverSection}

Your role:
- Suggest specific, compelling campaign titles or topic angles
- Help refine vague ideas into focused campaign concepts
- Ask clarifying questions when the topic is too broad — but ONLY about
  things you don't already know. If the company's products / industry /
  audience are listed above, use them directly instead of asking again.
- Keep responses concise and actionable (2-4 sentences)
- If suggesting a campaign title, make it concrete and specific
- When you suggest a Campaign Brief (description/goals/tone/audience), draw
  defaults from the company context above when the user hasn't typed their
  own — e.g. if the company sells to "B2B HR leaders" and the user hasn't
  specified an audience, suggest that audience for the campaign.

Memory + execution constraints:
- The campaign context below lists "Selected platforms", "Selected content
  formats", and "Posting frequency". DO NOT suggest formats or campaign
  structures the user can't execute. If only "post" + "article" formats are
  selected, don't propose reel/video arcs; if only LinkedIn is selected,
  don't pitch a "go viral on X" angle.
- When "Directions the user has ALREADY ACCEPTED" are listed, treat them as
  the campaign's locked direction. New suggestions should BUILD ON or DIVERSIFY
  from them, not propose near-duplicates of what's already accepted.
- When "Ideas already shown but NOT accepted" are listed, the user has
  passed on those — pick a meaningfully different angle. Do not repeat the
  same topic or close paraphrases.

WHEN YOU SUGGEST A CAMPAIGN TITLE (suggested_topic), also populate the rest
of the Campaign Brief whenever you have confidence:

- suggested_description: 1–2 finished sentences explaining what the campaign
  delivers and to whom. Must read as a finished blurb, NOT a preamble like
  "This campaign…". 220 characters max.

- suggested_goals: zero or more values from this fixed list, chosen ONLY when
  they obviously fit the topic. Empty array if uncertain — never invent. Use
  ONLY these exact labels (they map to the campaign builder's goal chips):
    [Brand Awareness, Lead Generation, Thought Leadership,
     Product Launch, Community Growth, Engagement]

- suggested_tone: zero or more values from this fixed list, chosen ONLY when
  the topic clearly implies a tone. Empty array if uncertain.
    [Professional, Conversational, Educational, Analytical, Bold,
     Inspirational, Authoritative, Friendly]

- suggested_audience: a short free-form audience descriptor (e.g.
  "Series-A SaaS founders", "HR leaders at mid-market companies"). Omit
  when the topic is too generic to infer an audience.

Rules:
- NEVER include items in suggested_goals or suggested_tone that aren't in
  the provided lists.
- Brief fields are optional. Omit / empty-array anything you're not
  confident about. The form's existing user input will NOT be overwritten
  when a field is omitted.

Return a JSON object with:
{
  "reply": "Your conversational response here",
  "suggested_topic": "Optional: a specific campaign title; omit if not suggesting one",
  "suggested_description": "Optional: 1–2 sentence blurb; omit when suggested_topic is omitted",
  "suggested_goals": ["Optional array of goal labels from the fixed list above"],
  "suggested_tone": ["Optional array of tone labels from the fixed list above"],
  "suggested_audience": "Optional free-form audience descriptor"
}

Return only JSON.`;

    // Phase 6A — derive the blueprint vocabularies from the canonical layer so
    // validation can never drift from the planner/publisher. Only computed in
    // blueprint mode.
    const blueprintConnected: string[] = wantBlueprint
      ? await getConnectedPlatformsForCompany(companyId.trim(), null as never).catch(() => [] as string[])
      : [];
    // Platform vocab: the company's CONNECTED platforms (priority-ordered) when
    // known, else the canonical registry's social platforms (exclude 'blog').
    const blueprintPlatformVocab = blueprintConnected.length > 0
      ? blueprintConnected.map((p) => normalizePlatformKey(p))
      : Object.keys(PLATFORM_CAPABILITY_REGISTRY).filter((p) => p !== 'blog');
    // Text vocab = canonical BOLT text registry; Creator vocab = governed
    // non-text creator formats. No hardcoded second list.
    const blueprintTextVocab = [...BOLT_TEXT_CONTENT_TYPES];
    const blueprintCreatorVocab = Object.keys(CREATOR_GOVERNANCE_REGISTRY).filter(
      (k) => getCreatorGovernance(k)?.canonical_asset_family !== 'text',
    );

    // Phase 5/6A — Campaign Architect addendum. Appended ONLY when the caller
    // opted in (`blueprint: true`). For every existing caller this is '', so
    // the system prompt is unchanged.
    const blueprintInstruction = wantBlueprint ? `

────────────────────────────────────────
CAMPAIGN BLUEPRINT MODE (Intelligent Mix):
In ADDITION to the fields above, when you suggest a campaign topic, ALSO
produce a complete, executable campaign blueprint. Choose values that are
company-aware, goal-aware, audience-aware, and execution-aware. Add these
OPTIONAL fields to the SAME JSON object:
- "suggested_strategic_focus": array of 1–3 short strategic angles (free text, e.g. "Thought leadership", "Product education"). Omit if unsure.
- "suggested_platforms": array chosen ONLY from [${blueprintPlatformVocab.join(', ')}].${blueprintConnected.length > 0 ? ' These are the company’s CONNECTED platforms — recommend in this order and DO NOT suggest any platform outside this list.' : ''}
- "suggested_text_formats": array chosen ONLY from [${blueprintTextVocab.join(', ')}].
- "suggested_creator_formats": array chosen ONLY from [${blueprintCreatorVocab.join(', ')}].
- "suggested_duration": integer number of weeks, between 1 and ${MAX_CAMPAIGN_DURATION_WEEKS}. Pick the SHORTEST duration that fully delivers the objective — do NOT default to the maximum. Weigh goal complexity, audience size, platform mix, content frequency, and the campaign objective: a focused single-goal push often needs only 2–4 weeks, while a multi-phase, multi-platform program may warrant 8–12. The length must be justified by the plan's scope.
- "suggested_outcome_view": one of [week_plan, daily_plan, schedule].

EXECUTION AWARENESS — favor mixes the system can actually run:
- carousel / image / infographic are autonomous (rendered automatically).
- video / reel / short / podcast require a human upload before scheduling — recommend them only when the campaign genuinely needs produced media, and keep the autonomous-to-upload ratio realistic for the duration.
- Match formats to platforms (carousel/article → LinkedIn; reel/short → Instagram/TikTok).
- NEVER invent platforms or formats outside the lists above.

Example A (focused thought leadership, one platform): platforms [linkedin]; text [article, post]; creator [carousel]; duration 3; outcome week_plan.
Example B (multi-phase launch, several platforms, high frequency): platforms [linkedin, instagram]; text [post, article]; creator [carousel, video]; duration 10; outcome week_plan.
Blueprint fields are OPTIONAL — omit any you can't choose confidently.` : '';

    // Phase 6D-A — Intelligent Mix intelligence enrichment. Combined-only by
    // contract (gated on wantBlueprint — only the combined page sends it, so
    // BOLT Text/Creator are never affected). Mode flag controls behavior:
    //   off      → resolver not called
    //   shadow   → resolver called + block logged, prompt UNCHANGED (default)
    //   advisory → resolver called + block injected before blueprintInstruction
    // Read-only consumption of existing intelligence signals; never throws.
    let intelligenceContextBlock = '';
    const intelMode = String(process.env.INTELLIGENT_MIX_INTELLIGENCE_MODE || 'shadow').toLowerCase();
    if (wantBlueprint && (intelMode === 'shadow' || intelMode === 'advisory')) {
      const intel = await resolveIntelligenceContext({ companyId: companyId.trim() });
      const block = formatIntelligenceContextBlock(intel);
      if (block) {
        if (intelMode === 'advisory') {
          intelligenceContextBlock = `\n\n${block}`;
        } else {
          // shadow: observe only — prompt stays byte-identical to off/advisory-empty.
          console.info('[6D-A][shadow] intelligence_context_block', { companyId: companyId.trim(), block });
        }
      }
    }

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt + intelligenceContextBlock + blueprintInstruction },
    ];

    for (const turn of chatHistory.slice(-8)) {
      messages.push({ role: turn.role, content: turn.text });
    }

    messages.push({
      role: 'user',
      content: `${contextBlock}${message.trim()}`,
    });

    const result = await wirePhase2Route({
      surface:        'bolt.campaign-chat',
      organizationId: companyId,
      action:         'campaign_chat',
      referenceType:  'campaign_chat',
      referenceId:    createHash('sha256')
        .update([companyId, message.trim(), String(chatHistory.length)].join('|'))
        .digest('hex').slice(0, 40),
      run: () => runCompletionWithOperation({
      companyId,
      model: 'gpt-4o-mini',
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages,
      operation: 'generatePlatformVariants',
      }),
    });

    let parsed: {
      reply?: string;
      suggested_topic?: string;
      suggested_description?: string;
      suggested_goals?: unknown;
      suggested_tone?: unknown;
      suggested_audience?: string;
      // Phase 5 — blueprint fields (only populated in blueprint mode).
      suggested_strategic_focus?: unknown;
      suggested_platforms?: unknown;
      suggested_text_formats?: unknown;
      suggested_creator_formats?: unknown;
      suggested_duration?: unknown;
      suggested_outcome_view?: unknown;
    } = {};
    try {
      const raw = typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? {});
      parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
    } catch {
      return res.status(500).json({ error: 'AI returned malformed response' });
    }

    // Fixed vocabularies — anything outside these gets dropped. Keeps the
    // multi-select chips on the client side from rendering arbitrary AI text.
    // Kept in sync with the campaign builder's GOAL_OPTIONS chips so suggested
    // goals always map onto a selectable chip (Phase: goal-vocabulary alignment).
    const VALID_GOALS = new Set([
      'Brand Awareness', 'Lead Generation', 'Thought Leadership',
      'Product Launch', 'Community Growth', 'Engagement',
    ]);
    const VALID_TONES = new Set([
      'Professional', 'Conversational', 'Educational', 'Analytical',
      'Bold', 'Inspirational', 'Authoritative', 'Friendly',
    ]);
    function sanitizeList(raw: unknown, allowed: Set<string>): string[] {
      if (!Array.isArray(raw)) return [];
      const seen = new Set<string>();
      const out: string[] = [];
      for (const item of raw) {
        if (typeof item !== 'string') continue;
        const trimmed = item.trim();
        if (!trimmed || !allowed.has(trimmed) || seen.has(trimmed)) continue;
        seen.add(trimmed);
        out.push(trimmed);
      }
      return out;
    }

    const suggestedTopic = parsed.suggested_topic?.trim() || null;
    // Pair contract: brief fields only meaningful alongside a topic. If the AI
    // returns brief details without a topic (system-prompt drift), drop them
    // rather than letting the UI apply an orphan suggestion.
    const suggestedDescription = suggestedTopic ? (parsed.suggested_description?.trim() || null) : null;
    const suggestedGoals = suggestedTopic ? sanitizeList(parsed.suggested_goals, VALID_GOALS) : [];
    const suggestedTone = suggestedTopic ? sanitizeList(parsed.suggested_tone, VALID_TONES) : [];
    const suggestedAudience = suggestedTopic ? (typeof parsed.suggested_audience === 'string' ? parsed.suggested_audience.trim() : '') || null : null;

    const responsePayload: Record<string, unknown> = {
      reply: parsed.reply?.trim() || 'Let me help you refine that.',
      suggested_topic: suggestedTopic,
      suggested_description: suggestedDescription,
      // Empty arrays kept (not coerced to null) so the client can safely
      // iterate without nullish guards.
      suggested_goals: suggestedGoals,
      suggested_tone: suggestedTone,
      suggested_audience: suggestedAudience,
    };

    // Phase 6A — blueprint validation derived from the CANONICAL capability
    // layer (no second list). A suggestion the planner/DB/publisher would
    // reject can never survive validation. Discard invalid, never throw. Only
    // attached when the caller opted in AND a topic was suggested.
    if (wantBlueprint && suggestedTopic) {
      // outcome_view is a UI view mode (not a platform/format capability) — kept local.
      const VALID_OUTCOME_VIEWS = new Set(['week_plan', 'daily_plan', 'schedule']);
      // Connected-platform restriction (Section C): when the company's connected
      // set is known, the AI may not recommend anything outside it.
      const allowedConnected = blueprintConnected.length > 0
        ? new Set(blueprintConnected.map((p) => normalizePlatformKey(p)))
        : null;
      // Strategic focus is free-form (company-specific angles), not a registry.
      const freeFocus = Array.isArray(parsed.suggested_strategic_focus)
        ? (parsed.suggested_strategic_focus as unknown[])
            .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
            .map((v) => v.trim().slice(0, 60))
            .slice(0, 5)
        : [];
      // Platforms: canonical PLATFORM_CAPABILITY_REGISTRY membership + connected.
      const normPlatforms = (raw: unknown): string[] => {
        if (!Array.isArray(raw)) return [];
        const out: string[] = [];
        for (const item of raw) {
          if (typeof item !== 'string') continue;
          const key = normalizePlatformKey(item);
          if (!key || !getPlatformCapability(key)) continue;                 // must be a registered platform
          if (allowedConnected && !allowedConnected.has(key)) continue;      // must be connected (when known)
          if (!out.includes(key)) out.push(key);
        }
        return out;
      };
      // Text formats: canonical BOLT text registry predicate.
      const normTextFormats = (raw: unknown): string[] => {
        if (!Array.isArray(raw)) return [];
        const out: string[] = [];
        for (const item of raw) {
          if (typeof item !== 'string') continue;
          const norm = item.trim().toLowerCase().replace(/[\s-]+/g, '_');
          if (isBoltTextContentType(norm) && !out.includes(norm)) out.push(norm);
        }
        return out;
      };
      // Creator formats: governed AND a non-text asset family (creator governance).
      const normCreatorFormats = (raw: unknown): string[] => {
        if (!Array.isArray(raw)) return [];
        const out: string[] = [];
        for (const item of raw) {
          if (typeof item !== 'string') continue;
          const norm = normalizeCreatorFormat(item);
          const gov = getCreatorGovernance(norm);
          if (gov && gov.canonical_asset_family !== 'text' && !out.includes(norm)) out.push(norm);
        }
        return out;
      };
      // Phase 6C-4C: this block runs ONLY in blueprint mode, which is the
      // Intelligent Mix (combined) Architect by contract (blueprint:true is sent
      // exclusively by the combined page — BOLT Text/Creator never reach here).
      // The accepted range therefore derives from the shared authority's combined
      // ceiling (1–MAX_CAMPAIGN_DURATION_WEEKS). Non-numeric → null; out-of-range
      // is clamped into the valid window. No free-form / duplicated limits.
      const durationNum = Number(parsed.suggested_duration);
      const suggestedDuration = Number.isFinite(durationNum)
        ? Math.min(Math.max(Math.round(durationNum), 1), MAX_CAMPAIGN_DURATION_WEEKS)
        : null;
      const outcomeRaw = typeof parsed.suggested_outcome_view === 'string' ? parsed.suggested_outcome_view.trim() : '';
      const suggestedOutcomeView = VALID_OUTCOME_VIEWS.has(outcomeRaw) ? outcomeRaw : null;

      // Phase 6G-1: drop suggested formats that NO suggested platform can run
      // (e.g. carousel suggested alongside only YouTube). Discard, never
      // auto-correct; log counts only. When the platform set is unknown/empty
      // we keep formats (nothing to validate against).
      const blueprintPlatforms = normPlatforms(parsed.suggested_platforms);
      const rawTextFormats = normTextFormats(parsed.suggested_text_formats);
      const rawCreatorFormats = normCreatorFormats(parsed.suggested_creator_formats);
      const formatRunsOnSuggested = (fmt: string): boolean => {
        if (blueprintPlatforms.length === 0) return true;
        const supported = getSupportedPlatformsForFormat(fmt);
        return supported.length > 0 && supported.some((p) => blueprintPlatforms.includes(p));
      };
      const validTextFormats = rawTextFormats.filter(formatRunsOnSuggested);
      const validCreatorFormats = rawCreatorFormats.filter(formatRunsOnSuggested);
      const assignmentPairsRemoved =
        (rawTextFormats.length - validTextFormats.length) + (rawCreatorFormats.length - validCreatorFormats.length);
      console.info('[bolt/assignment-enforcement]', JSON.stringify({
        surface: 'architect',
        assignment_rules_checked: rawTextFormats.length + rawCreatorFormats.length,
        invalid_platform_format_pairs_removed: assignmentPairsRemoved,
        supported_platform_count: blueprintPlatforms.length,
        supported_format_count: validTextFormats.length + validCreatorFormats.length,
      }));

      responsePayload.suggested_strategic_focus = freeFocus;
      responsePayload.suggested_platforms = blueprintPlatforms;
      responsePayload.suggested_text_formats = validTextFormats;
      responsePayload.suggested_creator_formats = validCreatorFormats;
      responsePayload.suggested_duration = suggestedDuration;
      responsePayload.suggested_outcome_view = suggestedOutcomeView;
    }

    return res.status(200).json(responsePayload);
  } catch (err: unknown) {
    if (err instanceof PaymentRequiredError) {
      return res.status(402).json({ error: err.message, code: err.code });
    }
    console.error('[bolt/campaign-chat]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to process request',
    });
  }
}
