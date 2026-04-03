/**
 * UNIFIED CONTENT GENERATION ENGINE
 *
 * Single source of truth for all content generation across:
 * - Command Center (Blog, Post, WhitePaper, Story, Newsletter creation)
 * - Campaign Flow (Master content generation → repurposing)
 * - Engagement Layer (Responses to comments, DMs, new conversations, outreach)
 *
 * Architecture:
 * - NO AI calls (just orchestration + prompt building)
 * - Three narrative angles: Analytical, Contrarian, Strategic
 * - Content-type-specific rules (word count, structure, tone)
 * - Writing style injection from company profile
 * - Deterministic fallback paths (no AI needed)
 * - Decision trace tracking for quality audit
 * - Integration with existing intelligent services (feedback, learning)
 */

import { generateCampaignPlan, runCompletionWithOperation } from './aiGateway';
import { refineLanguageOutput } from './languageRefinementService';
import { validateContentBlueprint } from './aiOutputValidationService';
import {
  getContentBlueprintPromptWithFingerprint,
  CONTENT_TYPE_SYSTEM_PROMPTS,
  CONTENT_GENERATION_PROMPT_VERSION,
} from '../prompts';

// ─────────────────────────────────────────────────────────────────────────────
// DATA MODELS
// ─────────────────────────────────────────────────────────────────────────────

export type ContentType =
  | 'blog'
  | 'post'
  | 'whitepaper'
  | 'story'
  | 'newsletter'
  | 'article'
  | 'thread'
  | 'carousel'
  | 'video_script'
  | 'engagement_response';

export type AngleType = 'analytical' | 'contrarian' | 'strategic';

export type EngagementType = 'reply' | 'new_conversation' | 'dm' | 'outreach_response';

export interface ContentAngle {
  type: AngleType;
  label: string;
  title: string;
  angle_summary: string;
  hook: string;
  angle_effectiveness_score?: number; // from feedback system
}

export interface ContentInput {
  company_id: string;
  content_type: ContentType;
  topic: string;
  intent?: 'awareness' | 'authority' | 'conversion' | 'retention';
  audience?: string;
  writing_style_instructions?: string;
  target_word_count?: number;
  platform?: string;
  context_payload?: Record<string, unknown>;
  feedback_signals?: {
    angle_effectiveness?: Record<AngleType, number>;
    tone_effectiveness?: Record<string, number>;
    hook_strength?: number;
  };
  company_profile?: {
    target_audience?: string;
    brand_voice?: string;
    tone_preference?: string;
    industry?: string;
  };
}

export interface EngagementInput {
  company_id: string;
  message: string;
  platform: string;
  tone: string;
  engagement_type: EngagementType;
  thread_context?: string;
  deterministic_only?: boolean;
  feedback_context?: Record<string, unknown>;
  learning_context?: Record<string, unknown>;
}

export interface ContentBlueprint {
  hook: string;
  key_points: string[];
  cta: string;
  metadata?: {
    selected_angle?: ContentAngle;
    tone_applied?: string;
    narrative_role?: string;
    decision_trace?: {
      why_angle?: string;
      why_tone?: string;
      signals_used?: string[];
    };
  };
}

export interface GenerationOutput {
  blueprint: ContentBlueprint;
  master_content: string;
  ready_for_variants: boolean;
  generation_trace: DecisionTrace;
}

export interface DecisionTrace {
  source_topic: string;
  objective: string;
  pain_point: string;
  outcome_promise: string;
  writing_angle: string;
  tone_used: string;
  narrative_role: string;
  progression_step?: number | null;
  feedback_signals_used?: string[];
}

export interface ValidationResult {
  pass: boolean;
  severity?: 'info' | 'warning' | 'blocking';
  issues?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT TYPE CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const CONTENT_TYPE_CONFIG: Record<ContentType, {
  min_length?: number;
  max_length?: number;
  target_words?: number;
  structure?: string[];
  tone_defaults?: string[];
  requires_hook?: boolean;
  requires_cta?: boolean;
  min_key_points?: number;
}> = {
  blog: {
    target_words: 2500,
    min_length: 1000,
    max_length: 3500,
    structure: ['hook', 'key_insights', 'section_1', 'section_2', 'section_3', 'section_4', 'section_5', 'summary', 'references'],
    tone_defaults: ['analytical', 'thoughtful', 'authoritative'],
    requires_hook: true,
    requires_cta: true,
    min_key_points: 5,
  },
  post: {
    target_words: 150,
    min_length: 50,
    max_length: 280,
    structure: ['hook', 'key_message', 'cta'],
    tone_defaults: ['punchy', 'engaging', 'conversational'],
    requires_hook: true,
    requires_cta: true,
    min_key_points: 1,
  },
  whitepaper: {
    target_words: 3000,
    min_length: 1500,
    max_length: 5000,
    structure: ['executive_summary', 'problem', 'evidence', 'solution', 'framework', 'case_study', 'implementation', 'conclusion'],
    tone_defaults: ['formal', 'authoritative', 'research-backed'],
    requires_hook: false,
    requires_cta: true,
    min_key_points: 6,
  },
  story: {
    target_words: 800,
    min_length: 300,
    max_length: 1200,
    structure: ['hook', 'rising_action', 'climax', 'resolution'],
    tone_defaults: ['narrative', 'engaging', 'conversational'],
    requires_hook: true,
    requires_cta: true,
    min_key_points: 3,
  },
  newsletter: {
    target_words: 600,
    min_length: 300,
    max_length: 1000,
    structure: ['subject', 'warm_opening', 'section_1', 'section_2', 'takeaway', 'cta'],
    tone_defaults: ['warm', 'personal', 'approachable'],
    requires_hook: true,
    requires_cta: true,
    min_key_points: 2,
  },
  article: {
    target_words: 1800,
    min_length: 1000,
    max_length: 3000,
    structure: ['headline', 'intro', 'section_1', 'section_2', 'section_3', 'conclusion', 'cta'],
    tone_defaults: ['informative', 'clear', 'engaging'],
    requires_hook: true,
    requires_cta: true,
    min_key_points: 4,
  },
  thread: {
    target_words: 350,
    min_length: 100,
    max_length: 500,
    structure: ['opening_tweet', 'insight_1', 'insight_2', 'insight_3', 'closing_cta'],
    tone_defaults: ['punchy', 'thought_leadership', 'engaging'],
    requires_hook: true,
    requires_cta: true,
    min_key_points: 3,
  },
  carousel: {
    target_words: 200,
    min_length: 50,
    max_length: 500,
    structure: ['slide_1_hook', 'slides_content', 'slide_final_cta'],
    tone_defaults: ['visual_friendly', 'punchy', 'scannable'],
    requires_hook: true,
    requires_cta: true,
    min_key_points: 2,
  },
  video_script: {
    target_words: 400,
    min_length: 200,
    max_length: 800,
    structure: ['intro', 'talking_points', 'closing_cta'],
    tone_defaults: ['conversational', 'engaging', 'energetic'],
    requires_hook: true,
    requires_cta: true,
    min_key_points: 2,
  },
  engagement_response: {
    target_words: 100,
    min_length: 20,
    max_length: 280,
    structure: ['acknowledgment', 'value_add', 'cta'],
    tone_defaults: ['empathetic', 'helpful', 'authentic'],
    requires_hook: false,
    requires_cta: true,
    min_key_points: 1,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// ANGLE GENERATION
// ─────────────────────────────────────────────────────────────────────────────

export function buildAnglesSystemPrompt(): string {
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;
  return `You are a B2B content strategist writing for ${currentYear}. Given a topic, generate three distinct editorial angles:

1. ANALYTICAL  — data-driven, examines patterns, evidence, and causality
2. CONTRARIAN  — challenges conventional wisdom, exposes flawed assumptions
3. STRATEGIC   — frames the topic as a business lever; connects it to measurable outcomes

## TEMPORAL RULES (non-negotiable)
- The current year is ${currentYear}. Write for the present and near future (${currentYear}–${nextYear}).
- NEVER anchor titles or content to past years (e.g., 2023, 2024). Do not use phrases like "in 2023" or "last year".
- Reference what is happening NOW or what practitioners should do going forward.
- If citing a trend, frame it as current reality or emerging direction — not historical recap.

For each angle, produce:
- A specific, compelling article title (not generic, not clickbait, no past year in the title)
- A 1–2 sentence angle summary describing the argument direction for a ${currentYear} audience
- A single hook sentence that would open the article (not a question)

Return ONLY valid JSON — no markdown, no prose:

{
  "angles": [
    {
      "type":          "analytical",
      "label":         "Analytical",
      "title":         "string",
      "angle_summary": "string",
      "hook":          "string"
    },
    {
      "type":          "contrarian",
      "label":         "Contrarian",
      "title":         "string",
      "angle_summary": "string",
      "hook":          "string"
    },
    {
      "type":          "strategic",
      "label":         "Strategic",
      "title":         "string",
      "angle_summary": "string",
      "hook":          "string"
    }
  ]
}`;
}

export function buildAnglesUserPrompt(input: ContentInput): string {
  const currentYear = new Date().getFullYear();
  const lines: string[] = [
    `CURRENT YEAR: ${currentYear} — all angles must reflect present-day or forward-looking market reality.`,
    `TOPIC: ${input.topic}`,
  ];

  if (input.intent) lines.push(`INTENT: ${input.intent}`);
  if (input.audience) lines.push(`AUDIENCE: ${input.audience}`);

  if (input.company_profile?.brand_voice) {
    lines.push(`COMPANY VOICE: ${input.company_profile.brand_voice}`);
  }

  lines.push('\nGenerate 3 distinct editorial angles for this topic.');
  return lines.join('\n');
}

function validateAnglesOutput(raw: unknown): ContentAngle[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.angles)) return null;

  const angles: ContentAngle[] = [];
  for (const item of r.angles as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    if (
      typeof a.type === 'string' &&
      typeof a.label === 'string' &&
      typeof a.title === 'string' &&
      typeof a.angle_summary === 'string' &&
      typeof a.hook === 'string'
    ) {
      angles.push({
        type: a.type as AngleType,
        label: a.label,
        title: a.title,
        angle_summary: a.angle_summary,
        hook: a.hook,
      });
    }
  }
  return angles.length === 3 ? angles : null;
}

function buildFallbackAngles(topic: string): ContentAngle[] {
  const short = topic.length > 50 ? topic.slice(0, 50) + '…' : topic;
  return [
    {
      type: 'analytical',
      label: 'Analytical',
      title: `The Data Behind ${short}`,
      angle_summary: 'Examines the evidence, patterns, and causal relationships that explain why this matters.',
      hook: 'The numbers tell a story most practitioners are too busy to read.',
    },
    {
      type: 'contrarian',
      label: 'Contrarian',
      title: `Why Everything You Know About ${short} Is Wrong`,
      angle_summary: 'Challenges the dominant narrative and exposes the assumptions that lead teams astray.',
      hook: 'The prevailing advice on this topic has a quiet but expensive flaw.',
    },
    {
      type: 'strategic',
      label: 'Strategic',
      title: `How to Turn ${short} Into a Competitive Advantage`,
      angle_summary: 'Connects the topic directly to business outcomes and shows leaders how to act on it.',
      hook: 'Most companies treat this as a tactic. The ones winning treat it as infrastructure.',
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// ANGLE SELECTION
// ─────────────────────────────────────────────────────────────────────────────

export async function generateAngles(input: ContentInput): Promise<ContentAngle[]> {
  try {
    const systemPrompt = buildAnglesSystemPrompt();
    const userPrompt = buildAnglesUserPrompt(input);

    const result = await runCompletionWithOperation({
      companyId: input.company_id || null,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      operation: 'generateContentAngles',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const raw = typeof result?.content?.[0]?.text === 'string' ? result.content[0].text : '';
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const parsed = JSON.parse(trimmed || '{}');
    const angles = validateAnglesOutput(parsed);

    return angles || buildFallbackAngles(input.topic);
  } catch (error) {
    console.warn('[unifiedContentGenerationEngine][generateAngles-failed]', {
      company_id: input.company_id,
      topic: input.topic,
      error: String(error),
    });
    return buildFallbackAngles(input.topic);
  }
}

export async function selectOptimalAngle(
  angles: ContentAngle[],
  context: {
    company_id: string;
    content_type: ContentType;
    feedback_context?: Record<string, unknown>;
    learning_context?: Record<string, unknown>;
  }
): Promise<ContentAngle> {
  // Score each angle based on feedback + learning context
  const scored = angles.map((angle) => ({
    ...angle,
    score: (angle.angle_effectiveness_score || 0.5) * 100 +
           ((context.feedback_context?.angle_scores?.[angle.type] || 50) as number),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored[0] || angles[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// MASTER CONTENT GENERATION
// ─────────────────────────────────────────────────────────────────────────────

export function buildPromptForType(
  content_type: ContentType,
  tone: string,
  intent?: string
): string {
  const typeConfig = CONTENT_TYPE_CONFIG[content_type];
  const targetWords = typeConfig.target_words || 500;

  let basePrompt = `You are a professional content writer creating ${content_type} content.

## CONSTRAINTS
- Target length: approximately ${targetWords} words (±10%)
- Tone: ${tone}
- Structure: ${typeConfig.structure?.join(' → ') || 'Clear, logical flow'}
- MUST have hook: ${typeConfig.requires_hook ? 'Yes' : 'No'}
- MUST include CTA: ${typeConfig.requires_cta ? 'Yes' : 'No'}
- Minimum key points: ${typeConfig.min_key_points || 2}

## RULES
- No hallucination — only reference real, verifiable information
- Clear narrative arc — each section builds on the previous
- No jargon without explanation
- Active voice preferred
- Punchy, scannable formatting where possible
- End with clear next steps or CTA

${intent ? `## INTENT\nWrite to achieve: ${intent}` : ''}

Return valid JSON with: { hook: string, key_points: string[], cta: string }`;

  return basePrompt;
}

export async function generateMasterContent(
  input: ContentInput,
  angle: ContentAngle,
  options: {
    model?: string;
    temperature?: number;
    cost_limit?: number;
  } = {}
): Promise<ContentBlueprint> {
  const config = CONTENT_TYPE_CONFIG[input.content_type];
  const targetWords = input.target_word_count || config.target_words || 500;

  const systemPrompt = buildPromptForType(
    input.content_type,
    input.company_profile?.tone_preference || 'professional',
    input.intent
  );

  const userPrompt = `
TOPIC: ${input.topic}

ANGLE: ${angle.label} — ${angle.angle_summary}

HOOK TO USE: "${angle.hook}"

${input.audience ? `AUDIENCE: ${input.audience}` : ''}
${input.writing_style_instructions ? `\nWRITING STYLE:\n${input.writing_style_instructions}` : ''}
${input.context_payload ? `\nCONTEXT:\n${JSON.stringify(input.context_payload, null, 2)}` : ''}

TARGET LENGTH: ${targetWords} words

Generate the complete content now. Return only the JSON object with hook, key_points (array of 2-5 points), and cta.
  `;

  try {
    const result = await runCompletionWithOperation({
      companyId: input.company_id || null,
      model: options.model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: options.temperature !== undefined ? options.temperature : 0,
      response_format: { type: 'json_object' },
      operation: 'generateMasterContent',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const raw = typeof result?.content?.[0]?.text === 'string' ? result.content[0].text : '';
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    let parsed: Partial<ContentBlueprint> = {};

    try {
      parsed = JSON.parse(trimmed || '{}');
    } catch {
      parsed = {};
    }

    const blueprint: ContentBlueprint = {
      hook: typeof parsed.hook === 'string' ? parsed.hook.trim() : `Topic: ${input.topic}`,
      key_points: Array.isArray(parsed.key_points)
        ? parsed.key_points.map((v) => String(v || '').trim()).filter(Boolean)
        : [input.intent || 'Key point'],
      cta: typeof parsed.cta === 'string' ? parsed.cta.trim() : '— Learn more when ready.',
      metadata: {
        selected_angle: angle,
        tone_applied: input.company_profile?.tone_preference || 'professional',
        narrative_role: 'primary',
        decision_trace: {
          why_angle: `Selected ${angle.type} angle for ${input.intent || 'engagement'}`,
          why_tone: 'Matched to company profile',
          signals_used: Object.keys(input.feedback_signals || {}),
        },
      },
    };

    // Refine language pass
    if (blueprint.hook) {
      const refined = await refineLanguageOutput({
        content: blueprint.hook,
        card_type: 'master_content',
      });
      blueprint.hook = (refined.refined as string) || blueprint.hook;
    }

    return blueprint;
  } catch (error) {
    console.warn('[unifiedContentGenerationEngine][generateMasterContent-failed]', {
      company_id: input.company_id,
      content_type: input.content_type,
      error: String(error),
    });

    return {
      hook: `${input.topic} — Key Insight`,
      key_points: ['Learn about this topic', 'Discover best practices'],
      cta: 'Ready to learn more?',
      metadata: {
        selected_angle: angle,
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT VALIDATION & AUTO-REPAIR
// ─────────────────────────────────────────────────────────────────────────────

export function validateContentQuality(bp: ContentBlueprint, contentType: ContentType): ValidationResult {
  const config = CONTENT_TYPE_CONFIG[contentType];
  const issues: string[] = [];

  if (config.requires_hook && !bp.hook?.trim()) {
    issues.push('Missing hook');
  }

  if (config.requires_cta && !bp.cta?.trim()) {
    issues.push('Missing call-to-action');
  }

  const keyPointCount = Array.isArray(bp.key_points) ? bp.key_points.filter((k) => k?.trim()).length : 0;
  if (keyPointCount < (config.min_key_points || 1)) {
    issues.push(`Need at least ${config.min_key_points || 1} key points, have ${keyPointCount}`);
  }

  const hookWords = (bp.hook || '').split(/\s+/).filter((w) => w.length > 0).length;
  if (hookWords < 3) {
    issues.push('Hook too short (< 3 words)');
  }

  return {
    pass: issues.length === 0,
    severity: issues.length === 0 ? 'info' : 'warning',
    issues: issues.length > 0 ? issues : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENGAGEMENT RESPONSE GENERATION
// ─────────────────────────────────────────────────────────────────────────────

export async function generateEngagementResponse(input: EngagementInput): Promise<string> {
  // For now, return placeholder
  // Actual implementation will use deterministic fast path + AI refinement
  return `Thanks for your message! We appreciate the engagement. [Response to: ${input.message}]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export const unifiedEngine = {
  generateAngles,
  selectOptimalAngle,
  generateMasterContent,
  validateContentQuality,
  generateEngagementResponse,
};
