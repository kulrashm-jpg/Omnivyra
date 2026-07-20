/**
 * WS-1c-3b (PMO-ADR-09) — FAMILY #10 "blueprint" TASK PROFILE.
 *
 * Converges the BLUEPRINT shape (`{ hook, key_points[], cta, metadata }`) that
 * `unifiedContentGenerationEngine.generateMasterContent` (@deprecated) produces via
 * its angle model, onto the ONE runtime. The DIFFERENCE from legacy (accepted,
 * quality-gated): company identity now comes from the ONE canonical context read
 * (`resolveContentContext` → `norm.identity`) instead of the family's own
 * `extractCompanyIdentityFromInput` + auto-fetch precedence. The narrative ANGLE is
 * an INPUT (as in legacy, where the angle is a parameter), so this profile does NOT
 * run the angle model — the caller supplies the selected angle on
 * `req.taskProfileInput.angle`.
 *
 * STATUS (Phase 4): the profile MODULE + its quality harness ship to prove the
 * capability generalizes beyond #9 to the blueprint shape from canonical context.
 * The LIVE cutover of the @deprecated `generateMasterContent` is DEFERRED (see the
 * deliverable report) — that legacy file is intentionally left untouched this pass.
 *
 * SELF-CONTAINED — depends only on the leaf identity builders in
 * lib/content/companyContextBlock and a local content-type config subset, so it
 * introduces NO import cycle with unifiedContentGenerationEngine (which it does not
 * import).
 */

import { config } from '@/config';
import {
  type CompanyIdentity,
  buildIdentityLock,
  buildAntiGenericRules,
  buildValidationChecklist,
  buildCompanyContextBlock,
  buildCompanyContextBlockShort,
} from '@/lib/content/companyContextBlock';
import type { TaskProfile, TaskProfileContext } from './types';

/** The blueprint output shape (mirror of unifiedContentGenerationEngine.ContentBlueprint core). */
export interface BlueprintContentAngle {
  type?: string;
  label?: string;
  title?: string;
  angle_summary?: string;
  hook?: string;
}

export interface Blueprint {
  hook: string;
  key_points: string[];
  cta: string;
  metadata?: Record<string, unknown>;
}

/** The subset of per-type config the blueprint prompt needs (local, documented). */
interface BlueprintTypeConfig {
  target_words: number;
  structure: string[];
  requires_hook: boolean;
  requires_cta: boolean;
  min_key_points: number;
  short_form: boolean;
}

const SHORT_FORM_TYPES = ['post', 'thread', 'carousel', 'video_script', 'engagement_response'];

/**
 * Local content-type config subset (target length / structure / requirements).
 * Values mirror unifiedContentGenerationEngine.CONTENT_TYPE_CONFIG for the shared
 * types; kept local so this additive profile never imports the deprecated engine.
 */
const BLUEPRINT_TYPE_CONFIG: Record<string, BlueprintTypeConfig> = {
  blog: { target_words: 2500, structure: ['hook', 'key_insights', 'sections', 'summary', 'references'], requires_hook: true, requires_cta: true, min_key_points: 5, short_form: false },
  post: { target_words: 150, structure: ['hook', 'key_message', 'cta'], requires_hook: true, requires_cta: true, min_key_points: 1, short_form: true },
  whitepaper: { target_words: 3000, structure: ['executive_summary', 'problem', 'evidence', 'solution', 'framework', 'conclusion'], requires_hook: false, requires_cta: true, min_key_points: 6, short_form: false },
  story: { target_words: 800, structure: ['hook', 'rising_action', 'climax', 'resolution'], requires_hook: true, requires_cta: true, min_key_points: 3, short_form: false },
  newsletter: { target_words: 600, structure: ['subject', 'warm_opening', 'sections', 'takeaway', 'cta'], requires_hook: true, requires_cta: true, min_key_points: 2, short_form: false },
  article: { target_words: 1800, structure: ['headline', 'intro', 'sections', 'conclusion', 'cta'], requires_hook: true, requires_cta: true, min_key_points: 4, short_form: false },
  thread: { target_words: 350, structure: ['opening_tweet', 'insights', 'closing_cta'], requires_hook: true, requires_cta: true, min_key_points: 3, short_form: true },
  carousel: { target_words: 200, structure: ['slide_1_hook', 'slides_content', 'slide_final_cta'], requires_hook: true, requires_cta: true, min_key_points: 2, short_form: true },
  video_script: { target_words: 400, structure: ['intro', 'talking_points', 'closing_cta'], requires_hook: true, requires_cta: true, min_key_points: 2, short_form: true },
  engagement_response: { target_words: 100, structure: ['acknowledgment', 'value_add', 'cta'], requires_hook: false, requires_cta: true, min_key_points: 1, short_form: true },
};

function typeConfigFor(contentType: string): BlueprintTypeConfig {
  return (
    BLUEPRINT_TYPE_CONFIG[contentType] ?? {
      target_words: 500,
      structure: ['hook', 'body', 'cta'],
      requires_hook: true,
      requires_cta: true,
      min_key_points: 2,
      short_form: SHORT_FORM_TYPES.includes(contentType),
    }
  );
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Build the blueprint SYSTEM prompt from canonical identity (mirrors buildPromptForType). */
function buildBlueprintSystemPrompt(
  contentType: string,
  tone: string,
  identity: CompanyIdentity,
  intent?: string,
): string {
  const cfg = typeConfigFor(contentType);
  const identityBlock =
    identity.companyName || identity.industry
      ? buildIdentityLock(identity, contentType)
      : `You are a professional content writer creating ${contentType} content.`;
  const enforcementBlock =
    identity.companyName || identity.coreProblem ? buildAntiGenericRules(identity) : '';
  const base = `${identityBlock}

## CONSTRAINTS
- Target length: approximately ${cfg.target_words} words (±10%)
- Tone: ${tone}
- Structure: ${cfg.structure.join(' → ')}
- MUST have hook: ${cfg.requires_hook ? 'Yes' : 'No'}
- MUST include CTA: ${cfg.requires_cta ? 'Yes' : 'No'}
- Minimum key points: ${cfg.min_key_points}

## RULES
- No hallucination — only reference real, verifiable information
- Clear narrative arc — each section builds on the previous
- No jargon without explanation
- Active voice preferred
- Punchy, scannable formatting where possible
- End with clear next steps or CTA
${enforcementBlock}
${intent ? `## INTENT\nWrite to achieve: ${intent}` : ''}

Return valid JSON with: { hook: string, key_points: string[], cta: string }`;
  return `${base}\n${buildValidationChecklist(identity, contentType)}`;
}

export const blueprintProfile: TaskProfile<Blueprint> = {
  key: 'blueprint',
  // The content-type superset family #10 serves.
  contentTypes: [
    'blog', 'post', 'whitepaper', 'story', 'newsletter',
    'article', 'thread', 'carousel', 'video_script', 'engagement_response',
  ],

  policy(ctx: TaskProfileContext): ReturnType<TaskProfile['policy']> {
    const input = ctx.input;
    const temperature =
      typeof input.temperature === 'number' ? (input.temperature as number) : 0;
    return {
      model: str(input.model) || process.env.OPENAI_MODEL || config.OPENAI_MODEL || 'gpt-4o-mini',
      temperature,
      operation: 'generateMasterContent',
      responseFormat: { type: 'json_object' },
    };
  },

  buildMessages(ctx: TaskProfileContext) {
    const input = ctx.input;
    const identity = ctx.norm.identity; // THE canonical identity read
    const contentType = str(input.content_type) || str(ctx.req.contentType) || 'post';
    const cfg = typeConfigFor(contentType);
    const angle = (input.angle ?? {}) as BlueprintContentAngle;
    const tone = str(input.tone_preference) || 'professional';
    const targetWords = typeof input.target_word_count === 'number'
      ? (input.target_word_count as number)
      : cfg.target_words;
    const contextBlock = cfg.short_form
      ? buildCompanyContextBlockShort(identity)
      : buildCompanyContextBlock(identity);

    const system = buildBlueprintSystemPrompt(contentType, tone, identity, str(input.intent) || undefined);
    const topic = str(input.topic);
    const audience = str(input.audience);
    const writingStyle = str(input.writing_style_instructions);
    const user = `
TOPIC: ${topic}

ANGLE: ${str(angle.label)} — ${str(angle.angle_summary)}

HOOK TO USE: "${str(angle.hook)}"

${audience ? `AUDIENCE: ${audience}` : ''}
${contextBlock ? `\nCOMPANY CONTEXT:\n${contextBlock}` : ''}
${writingStyle ? `\nWRITING STYLE:\n${writingStyle}` : ''}
${input.context_payload ? `\nADDITIONAL CONTEXT:\n${JSON.stringify(input.context_payload, null, 2)}` : ''}

TARGET LENGTH: ${targetWords} words

Generate the complete content now. Return only the JSON object with hook, key_points (array of 2-5 points), and cta.
  `;
    return { system, user };
  },

  parse(raw: string, ctx: TaskProfileContext): Blueprint {
    const input = ctx.input;
    const trimmed = str(raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    let parsed: Partial<Blueprint> = {};
    try {
      parsed = JSON.parse(trimmed || '{}');
    } catch {
      parsed = {};
    }
    const angle = (input.angle ?? {}) as BlueprintContentAngle;
    const topic = str(input.topic);
    return {
      hook: typeof parsed.hook === 'string' && parsed.hook.trim() ? parsed.hook.trim() : `Topic: ${topic}`,
      key_points: Array.isArray(parsed.key_points)
        ? parsed.key_points.map((v) => String(v ?? '').trim()).filter(Boolean)
        : [str(input.intent) || 'Key point'],
      cta: typeof parsed.cta === 'string' && parsed.cta.trim() ? parsed.cta.trim() : '— Learn more when ready.',
      metadata: {
        selected_angle: angle,
        tone_applied: str(input.tone_preference) || 'professional',
        narrative_role: 'primary',
        company_context: {
          companyName: ctx.norm.identity.companyName,
          targetAudience: ctx.norm.identity.idealCustomerProfile || ctx.norm.identity.targetAudience,
          industry: ctx.norm.identity.industry,
          uniqueValue: ctx.norm.identity.uniqueValue,
          competitiveAdvantages: ctx.norm.identity.competitiveAdvantages,
        },
        decision_trace: {
          source_topic: topic,
          why_angle: `Selected ${str(angle.type) || 'angle'} for ${str(input.intent) || 'engagement'}`,
        },
      },
    };
  },
};
